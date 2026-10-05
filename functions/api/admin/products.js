/**
 * POST /api/admin/products  · 商品后台管理（CRUD 合一）
 * body.action: 'list' | 'create' | 'update' | 'delete' | 'toggleActive' | 'get' | 'genSku'
 *   - 'genSku': { category_id?, category_code? } → 返回 { sku }（前端 🔄 生成按钮用）
 *   - create / update 中 sku 可空（留空自动生成），UNIQUE 冲突自动加后缀重试
 *   - 价格字段：price_mxn / cost_mxn（全站统一墨西哥比索 MXN）
 * 鉴权：_middleware 已处理
 */
import { jsonOk, jsonErr, readJSON, getQuery, buildPublicImgUrl, generateProductSku, execWithRetryOnUnique } from '../../_utils.js';

function numOr(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function round2(n) { return Math.max(0, Math.round(numOr(n, 0) * 100) / 100); }

/**
 * 按新规则生成顺序 SKU：所属分类完整编码 + '-' + 4位序号
 * 例：分类 code='A01-1'，该分类下已存在 max 序号 5 → 返回 'A01-1-0005'
 * 该分类下若没有任何匹配 SKU（或老格式 SKU 不匹配），序号从 1 开始
 */
async function genSequentialSkuFromDb(env, categoryId, categoryCode) {
  const prefix = String(categoryCode || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!prefix) return '';
  // 查该分类下所有 SKU，提取「前缀-序号」尾部的数字，取最大值
  const rows = await env.DB.prepare(
    `SELECT sku FROM products WHERE category_id = ?`
  ).bind(categoryId).all();
  const skus = rows?.results || [];
  let maxNum = 0;
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d{1,})$');
  for (const r of skus) {
    const sku = String(r.sku || '').toUpperCase();
    const m = sku.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
}

/** 递归获取分组节点下所有叶子节点ID */
async function getLeafIdsUnderGroup(env, groupId) {
  const all = await env.DB.prepare('SELECT id, parent_id, is_leaf FROM categories').all();
  const flat = all?.results || [];
  
  function collectLeafIds(parentId) {
    const ids = [];
    const children = flat.filter(c => c.parent_id === parentId);
    for (const child of children) {
      if (child.is_leaf === 1) {
        ids.push(child.id);
      } else {
        ids.push(...collectLeafIds(child.id));
      }
    }
    return ids;
  }
  
  return collectLeafIds(groupId);
}

/** 后台列表：支持分页、分类、关键词、上下架 */
async function actionList(env, body) {
  const page    = Math.max(1, numOr(body.page, 1));
  const perPage = Math.max(1, Math.min(200, numOr(body.perPage, 50)));
  const catId   = numOr(body.categoryId, 0);
  const kw      = String(body.keyword || '').trim();
  const active  = body.onlyActive === 1 ? 1 : (body.onlyActive === 0 ? 0 : 'all');

  const where = [];
  const args = [];
  
  if (catId > 0) {
    const cat = await env.DB.prepare('SELECT id, is_leaf FROM categories WHERE id = ?').bind(catId).first();
    if (cat) {
      if (cat.is_leaf === 1) {
        where.push('p.category_id = ?');
        args.push(catId);
      } else {
        const leafIds = await getLeafIdsUnderGroup(env, catId);
        if (leafIds.length > 0) {
          where.push(`p.category_id IN (${leafIds.map(() => '?').join(',')})`);
          args.push(...leafIds);
        } else {
          where.push('1 = 0');
        }
      }
    }
  }
  
  if (kw) {
    where.push('(p.sku LIKE ? OR p.name_es LIKE ? OR p.name_zh LIKE ? OR p.tags LIKE ?)');
    args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (active !== 'all') { where.push('p.is_active = ?'); args.push(active); }
  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const OFFSET = (page - 1) * perPage;
  const totalR = await env.DB.prepare(
    `SELECT COUNT(*) c FROM products p ${whereSQL}`
  ).bind(...args).first();
  const listR = await env.DB.prepare(`
    SELECT p.*, c.code AS category_code, c.icon_emoji AS category_icon,
           c.name_es AS cat_name_es, c.name_zh AS cat_name_zh
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${whereSQL}
    ORDER BY p.category_id ASC, p.sort_order ASC, p.id DESC
    LIMIT ? OFFSET ?
  `).bind(...args, perPage, OFFSET).all();

  const total = totalR?.c || 0;
  const items = (listR?.results || []).map(r => ({
    ...r,
    image_url:     buildPublicImgUrl(env.R2_PUBLIC_PREFIX || '', r.image_key),
    gallery_urls:  (r.gallery_keys || '').split(',').map(s => s.trim()).filter(Boolean)
                     .map(k => buildPublicImgUrl(env.R2_PUBLIC_PREFIX || '', k)),
    profit_mxn:    round2(numOr(r.price_mxn, 0) - numOr(r.cost_mxn, 0)),
  }));
  return jsonOk({
    page, perPage, total,
    totalPages: Math.ceil(total / perPage),
    items,
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.DB) return jsonErr('D1 数据库未绑定（env.DB 缺失）', 500, 9301);

  const body = await readJSON(context.request);
  if (!body || !body.action) return jsonErr('缺少参数 action', 400, 5001);
  const { action } = body;

  if (action === 'list') return actionList(env, body);

  // ===========================================
  // get：单条详情（后台编辑前取原值）
  // ===========================================
  if (action === 'get') {
    const id = numOr(body.id, 0);
    if (id <= 0) return jsonErr('缺少参数 id', 400, 5002);
    const r = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    if (!r) return jsonErr('商品不存在', 404, 5003);
    return jsonOk({
      ...r,
      image_url:    buildPublicImgUrl(env.R2_PUBLIC_PREFIX || '', r.image_key),
      gallery_urls: (r.gallery_keys || '').split(',').map(s => s.trim()).filter(Boolean)
                      .map(k => buildPublicImgUrl(env.R2_PUBLIC_PREFIX || '', k)),
      profit_mxn:   round2(numOr(r.price_mxn, 0) - numOr(r.cost_mxn, 0)),
    });
  }

  // ===========================================
  // genSku：前端 🔄「生成 SKU」按钮用
  // 新规则：所属分类完整编码 + '-' + 4位序号（如 A01-1-0001）
  // ===========================================
  if (action === 'genSku') {
    let catCode = String(body.category_code || body.catCode || '').trim();
    const catId = numOr(body.category_id || body.categoryId, 0);
    if (!catCode && catId > 0) {
      const c = await env.DB.prepare('SELECT code FROM categories WHERE id = ?').bind(catId).first();
      if (c) catCode = c.code;
    }
    if (catId > 0 && catCode) {
      // 查 DB 推算下一顺序号，确保唯一
      const sku = await genSequentialSkuFromDb(env, catId, catCode);
      return jsonOk({ sku });
    }
    // fallback：无分类信息时退老格式（不应发生）
    return jsonOk({ sku: generateProductSku(catCode) });
  }

  // ===========================================
  // create（SKU 留空自动生成「分类编码-4位序号」格式如 A01-1-0001；UNIQUE 冲突自动顺延序号重试）
  // ===========================================
  if (action === 'create') {
    const d = body;
    if (!d.category_id || !d.name_es || !d.name_zh) {
      return jsonErr('必填字段：category_id、name_es（西语名）、name_zh（中文名）；SKU 留空将自动生成', 400, 5101);
    }
    if (numOr(d.category_id, 0) <= 0) return jsonErr('category_id 必须是存在的分类 ID', 400, 5102);
    const catOK = await env.DB.prepare('SELECT id, code FROM categories WHERE id = ?').bind(numOr(d.category_id, 0)).first();
    if (!catOK) return jsonErr(`分类 ID=${d.category_id} 不存在，请先在分类管理中创建`, 400, 5103);

    // 新规则：用户留空 → 后端按「分类完整编码-4位序号」生成（如 A01-1-0001）
    // 用户填写：保留大写字母、数字和连字符，最长 20 位（如 A01-1-0007）
    const userSku = String(d.sku || '').trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')  // 仅保留大写字母、数字、连字符
      .replace(/-{2,}/g, '-')      // 连续连字符合并
      .replace(/^-+|-+$/g, '')     // 去首尾连字符
      .slice(0, 20);
    const sku0 = userSku || (await genSequentialSkuFromDb(env, catOK.id, catOK.code));

    const priceMxn = round2(d.price_mxn ?? d.price ?? 0);
    const costMxn  = round2(d.cost_mxn  ?? d.cost  ?? 0);

    const payload0 = {
      sku:          sku0,
      category_id:  numOr(d.category_id, 0),
      name_es:      String(d.name_es).trim(),
      name_zh:      String(d.name_zh).trim(),
      desc_es:      String(d.desc_es || ''),
      desc_zh:      String(d.desc_zh || ''),
      price_mxn:    priceMxn,
      cost_mxn:     costMxn,
      stock:        Math.max(0, Math.floor(numOr(d.stock, 0))),
      image_key:    String(d.image_key || '').trim(),
      gallery_keys: String(d.gallery_keys || '').trim(),
      tags:         String(d.tags || '').trim(),
      is_active:    d.is_active === 0 ? 0 : 1,
      sort_order:   numOr(d.sort_order, 100),
      presale_arrive_date: String(d.presale_arrive_date || '').trim(),
      presale_note_es:     String(d.presale_note_es || '').trim(),
      presale_note_zh:     String(d.presale_note_zh || '').trim(),
    };

    const runStmt = async (p) => {
      const sql = `INSERT INTO products (sku, category_id, name_es, name_zh, desc_es, desc_zh,
          price_mxn, cost_mxn,
          stock, image_key, gallery_keys, tags, is_active, sort_order,
          presale_arrive_date, presale_note_es, presale_note_zh)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      const binds = [
        p.sku, p.category_id, p.name_es, p.name_zh,
        p.desc_es, p.desc_zh, p.price_mxn, p.cost_mxn,
        p.stock, p.image_key, p.gallery_keys, p.tags,
        p.is_active, p.sort_order,
        p.presale_arrive_date, p.presale_note_es, p.presale_note_zh
      ];
      const info = await env.DB.prepare(sql).bind(...binds).run();
      return { id: info?.meta?.last_row_id, ...p };
    };
    // UNIQUE 冲突时：重新查 DB 拿最新 max+1（避免并发竞争），最多重试 8 次
    const mutate = async (p) => {
      const newSku = await genSequentialSkuFromDb(env, p.category_id, catOK.code);
      return { ...p, sku: newSku };
    };
    const r = await execWithRetryOnUnique(runStmt, mutate, payload0);
    if (!r.ok) {
      const errMsg = (r.error && r.error.message) || '创建商品失败，请重试';
      return jsonErr(errMsg, 500, 5104);
    }
    return jsonOk({
      id: r.result.id,
      sku: r.payload.sku,
      price_mxn: r.payload.price_mxn,
      cost_mxn: r.payload.cost_mxn,
    }, `已创建商品 ${r.payload.sku}`);
  }

  // ===========================================
  // update
  // ===========================================
  if (action === 'update') {
    const id = numOr(body.id, 0);
    if (id <= 0) return jsonErr('缺少参数 id', 400, 5201);
    const exist = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    if (!exist) return jsonErr('商品不存在', 404, 5202);

    const allowed = ['sku','category_id','name_es','name_zh','desc_es','desc_zh',
                     'price_mxn','cost_mxn',
                     'stock','image_key','gallery_keys','tags',
                     'is_active','sort_order',
                     'presale_arrive_date','presale_note_es','presale_note_zh'];
    const patch = {};
    for (const k of allowed) {
      if (body[k] === undefined) continue;
      if (k === 'category_id' || k === 'stock' || k === 'sort_order') patch[k] = Math.floor(numOr(body[k], exist[k]));
      else if (k === 'price_mxn' || k === 'cost_mxn') patch[k] = round2(body[k]);
      else if (k === 'is_active') patch[k] = body[k] === 0 ? 0 : 1;
      else if (k === 'sku') patch[k] = String(body[k]).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
      else if (k === 'presale_arrive_date') {
        // 预售日期：YYYY-MM-DD 或空（清空 = 取消预售）
        const v = String(body[k]).trim();
        patch[k] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
      }
      else patch[k] = String(body[k]).trim();
    }
    if (Object.keys(patch).length === 0) return jsonOk({ id }, '无变更');

    if (patch.sku && patch.sku !== exist.sku) {
      const run = async (s) => {
        await env.DB.prepare(`UPDATE products SET sku = ? WHERE id = ?`).bind(s, id).run();
        return s;
      };
      const mut = (s) => {
        const suffix = '-' + Math.random().toString(36).slice(2, 4).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
        return (s.replace(/-[A-Z0-9]{4}$/, '') + '-' + suffix.slice(-4)).slice(0, 32);
      };
      const r = await execWithRetryOnUnique(run, mut, patch.sku);
      if (!r.ok) return jsonErr((r.error && r.error.message) || '更新 SKU 失败，请重试', 500, 5203);
      patch.sku = r.result;
    }
    if (patch.category_id && patch.category_id !== exist.category_id) {
      const ok = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(patch.category_id).first();
      if (!ok) return jsonErr(`分类 ID=${patch.category_id} 不存在`, 400, 5204);
    }
    const sets = Object.keys(patch).map(k => `${k} = ?`).join(', ');
    const vals = Object.values(patch);
    await env.DB.prepare(`UPDATE products SET ${sets} WHERE id = ?`).bind(...vals, id).run();
    return jsonOk({ id, ...exist, ...patch }, `已更新商品 ID=${id}`);
  }

  // ===========================================
  // toggleActive（上架/下架切换，批量也可以 ids:[]）
  // ===========================================
  if (action === 'toggleActive') {
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(Number).filter(n => n > 0);
    if (ids.length === 0) return jsonErr('缺少 id 或 ids 数组', 400, 5301);
    const to = body.to === 0 ? 0 : 1;
    const qs = ids.map(() => '?').join(',');
    await env.DB.prepare(`UPDATE products SET is_active = ? WHERE id IN (${qs})`)
      .bind(to, ...ids).run();
    return jsonOk({ changed: ids.length, to }, `已将 ${ids.length} 件商品${to ? '上架' : '下架'}`);
  }

  // ===========================================
  // delete（批量也可以 ids:[]，物理删除；同步清理 R2 图片）
  // 用户要求：删除商品时同步删除 R2 关联图片，避免免费空间被占满
  // ===========================================
  if (action === 'delete') {
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(Number).filter(n => n > 0);
    if (ids.length === 0) return jsonErr('缺少 id 或 ids 数组', 400, 5401);
    const qs = ids.map(() => '?').join(',');

    // 先取出所有要删除商品的图片 key（主图 + 图集），删 DB 后再异步清理 R2
    const rows = await env.DB.prepare(
      `SELECT id, sku, image_key, gallery_keys FROM products WHERE id IN (${qs})`
    ).bind(...ids).all();
    const products = rows?.results || [];

    // 收集所有需要删除的 R2 key（去重、去空）
    const keysToDelete = new Set();
    for (const p of products) {
      const mainKey = String(p.image_key || '').trim();
      if (mainKey) keysToDelete.add(mainKey);
      const galStr = String(p.gallery_keys || '').trim();
      if (galStr) {
        for (const k of galStr.split(',').map(s => s.trim()).filter(Boolean)) {
          keysToDelete.add(k);
        }
      }
    }

    // 先删除关联的 sales_logs（避免外键约束阻止删除商品）
    try {
      await env.DB.prepare(`DELETE FROM sales_logs WHERE product_id IN (${qs})`).bind(...ids).run();
    } catch (_) { /* 忽略流水删除失败，继续删商品 */ }

    // 物理删除商品行
    try {
      await env.DB.prepare(`DELETE FROM products WHERE id IN (${qs})`).bind(...ids).run();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/FOREIGN KEY|constraint/i.test(msg)) {
        return jsonErr('删除失败：该商品存在关联数据无法清理。请稍后重试或联系管理员。', 409, 5402);
      }
      return jsonErr('删除失败：' + msg, 500, 5403);
    }

    // 同步删除 R2 图片（失败不阻塞 API 响应，仅记录失败数）
    let deletedR2 = 0, failedR2 = 0;
    if (env.BUCKET && keysToDelete.size > 0) {
      const allKeys = [...keysToDelete];
      const results = await Promise.allSettled(allKeys.map(k => env.BUCKET.delete(k)));
      for (const r of results) {
        if (r.status === 'ok') deletedR2++;
        else failedR2++;
      }
    }

    return jsonOk({
      deletedIds: ids,
      deleted: ids.length,
      r2KeysTotal: keysToDelete.size,
      r2Deleted: deletedR2,
      r2Failed: failedR2,
    }, `已删除 ${ids.length} 件商品，R2 清理 ${deletedR2}/${keysToDelete.size} 张图片`);
  }

  return jsonErr(`未知 action：${action}`, 400, 5999);
}
