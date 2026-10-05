/**
 * POST /api/admin/settings  · 后台系统设置（写操作，必须管理员登录）
 * body.action:
 *   'get'     读取所有设置（或 body.keys 指定白名单）；返回同公开 /api/settings
 *   'set'     批量保存：body.pairs = { admin_default_lang:'zh', stock_low_threshold:'5' }
 *                - 仅支持预定义的 key 白名单，避免把任意键塞进系统设置
 *                - 货币已固定为 MXN，不再支持 EUR/USD 切换；rate_eur_to_usd 已废弃
 *
 * 另含三个工具型 action（系统信息页用）：
 *   'cleanupOrphanedImages'  扫描 R2 删除无主图片
 *   'backup'                  一键导出全库 JSON
 *   'storageStats'            统计 R2 存储占用
 */
import { jsonOk, jsonErr, readJSON } from '../../_utils.js';

// 货币已固定 MXN：currency / frontend_currency / rate_eur_to_usd 不再可写
const ALLOWED_KEYS = new Set([
  'admin_default_lang',    // zh | es（后台默认语言，登录后首次使用）
  'stock_low_threshold',   // 库存低位阈值（正整数，≤ 显示黄色）
  'shop_title_es',
  'shop_title_zh',
  // ---- 站点内容配置（首页 v3 改版配套）----
  'top_sales_mode',        // auto | manual：TOP3 榜单模式
  'top_sales_manual_ids',  // 手动模式商品 ID，逗号分隔
  // ---- 预售专区配置（迁移 007）----
  'presale_title_es',      // 预售专区标题·西语
  'presale_title_zh',      // 预售专区标题·中文
  'presale_badge_es',      // 预售专区角标·西语
  'presale_badge_zh',      // 预售专区角标·中文
  'presale_max',           // 预售区最多展示数（1-6）
  'reviews_json',          // 社区好评 JSON 数组 [{name,stars,text_es,text_zh}]
  'community_links_json',  // 加入社区入口 JSON 数组 [{icon,title_es,title_zh,url}]
  'cs_guarantee_es',       // 客服卡片1·品质保证 西语
  'cs_guarantee_zh',       // 客服卡片1·品质保证 中文
  'cs_shipping_es',        // 客服卡片2·配送说明 西语
  'cs_shipping_zh',        // 客服卡片2·配送说明 中文
  'cs_contact_whatsapp',   // WhatsApp 展示号码
  'cs_contact_url',        // WhatsApp 跳转链接
  'cs_contact_hours_es',   // 营业时间 西语
  'cs_contact_hours_zh',   // 营业时间 中文
  'cs_address_es',         // 门店地址 西语
  'cs_address_zh',         // 门店地址 中文
  'cs_maps_url',           // 谷歌地图链接
]);

// 需要 JSON 校验的键：写入前必须能被 JSON.parse，且必须是数组
const JSON_ARRAY_KEYS = new Set(['reviews_json', 'community_links_json']);

function numOr(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }

async function getAll(env, keysFilter) {
  const arr = keysFilter && keysFilter.length ? keysFilter : [...ALLOWED_KEYS];
  const sql = `SELECT skey, sval FROM system_settings WHERE skey IN (${arr.map(()=>'?').join(',')})`;
  const r = await env.DB.prepare(sql).bind(...arr).all();
  return (r?.results || []).map(x => ({ k: x.skey, v: x.sval }));
}
async function put(env, k, v, note = '') {
  await env.DB.prepare(`
    INSERT INTO system_settings (skey, sval, note) VALUES (?,?,?)
    ON CONFLICT(skey) DO UPDATE SET sval=excluded.sval, note=excluded.note, updated_at=CURRENT_TIMESTAMP
  `).bind(String(k), String(v ?? ''), String(note || '')).run();
  return true;
}

const DEFAULTS = {
  currency: 'MXN',
  frontend_currency: '',
  admin_default_lang: 'zh',
  rate_eur_to_usd: '1',
  stock_low_threshold: '5',
  shop_title_es: 'Haven Shop',
  shop_title_zh: 'Haven Shop',
};

function buildMap(rows) {
  const map = { ...DEFAULTS };
  for (const r of rows) if (r && r.k !== undefined) map[r.k] = r.v;
  // 强制规范：货币恒为 MXN，前台跟随，汇率已废弃
  map.currency = 'MXN';
  map.frontend_currency = '';
  map.rate_eur_to_usd = '1';
  if (map.admin_default_lang !== 'es') map.admin_default_lang = 'zh';
  return map;
}

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.DB) return jsonErr('D1 数据库未绑定', 500, 9501);
  const body = await readJSON(context.request);
  if (!body || !body.action) return jsonErr('缺少参数 action', 400, 7001);
  const { action } = body;

  if (action === 'get') {
    let keys = Array.isArray(body.keys) ? body.keys : null;
    if (keys) keys = keys.filter(k => ALLOWED_KEYS.has(k));
    const rows = await getAll(env, keys);
    const map = buildMap(rows);
    return jsonOk({ items: Object.entries(map).map(([k, v]) => ({ k, v })), map });
  }

  if (action === 'set') {
    const pairs = body.pairs && typeof body.pairs === 'object' ? body.pairs : {};
    const saved = [];
    for (const [k, rawV] of Object.entries(pairs)) {
      if (!ALLOWED_KEYS.has(k)) continue;
      let v = String(rawV ?? '').trim();
      if (k === 'admin_default_lang') { if (v !== 'es') v = 'zh'; }
      if (k === 'stock_low_threshold') {
        const n = Math.max(1, Math.floor(numOr(v, 5)));
        v = String(n);
      }
      // JSON 数组类键：校验合法性，非法则报错并中断保存
      if (JSON_ARRAY_KEYS.has(k)) {
        let ok = false;
        try {
          const parsed = JSON.parse(v || '[]');
          ok = Array.isArray(parsed);
        } catch (_) { ok = false; }
        if (!ok) return jsonErr(`「${k}」内容格式不正确：必须是合法的 JSON 数组`, 400, 7012);
      }
      if (k === 'top_sales_mode') { if (v !== 'manual') v = 'auto'; }
      // 预售区展示数量：钳制在 1-6，非法输入回退 3
      if (k === 'presale_max') {
        let n = Math.floor(numOr(v, 3));
        n = Math.min(6, Math.max(1, n));
        v = String(n);
      }
      await put(env, k, v, `后台写入：${k} = ${v}`);
      saved.push({ k, v });
    }
    const rows = await getAll(env, null);
    return jsonOk({ saved, map: buildMap(rows) }, `已保存 ${saved.length} 项设置`);
  }

  // setRate 已废弃：全站统一 MXN，不再需要 EUR↔USD 汇率
  if (action === 'setRate') {
    return jsonErr('汇率配置已废弃：全站统一使用墨西哥比索（MXN），不再需要 EUR↔USD 汇率', 400, 7011);
  }

  // ====================================================================
  // cleanupOrphanedImages：扫描 R2 中所有图片 key，比对 DB 引用，删除无主图片
  // 用户需求：清理 Cloudflare R2 中已删除商品遗留的无效图片，释放免费空间
  //   - step1: 取出 DB 中所有 image_key + gallery_keys，构造 referenced Set
  //   - step2: list R2 bucket 中所有 products/ 前缀对象
  //   - step3: 不在 referenced Set 中的 → orphan，删除
  //   - body.dryRun = true 时只返回统计不删
  // ====================================================================
  if (action === 'cleanupOrphanedImages') {
    if (!env.BUCKET) return jsonErr('R2 存储桶未绑定（env.BUCKET 缺失）', 500, 9404);
    if (!env.DB)     return jsonErr('D1 数据库未绑定', 500, 9501);

    // 收集 DB 中所有被引用的图片 key
    const refRows = await env.DB.prepare(
      `SELECT image_key, gallery_keys FROM products`
    ).all();
    const referenced = new Set();
    for (const r of (refRows?.results || [])) {
      const mk = String(r.image_key || '').trim();
      if (mk) referenced.add(mk);
      const gk = String(r.gallery_keys || '').trim();
      if (gk) {
        for (const k of gk.split(',').map(s => s.trim()).filter(Boolean)) {
          referenced.add(k);
        }
      }
    }

    // 扫描 R2 中 products/ 前缀下所有对象（分页 list，R2 单次最多 1000 条）
    const orphaned = [];
    const allR2Keys = [];
    let cursor;
    let listPages = 0;
    const MAX_LIST_PAGES = 50; // 安全上限，避免无限循环（50 * 1000 = 5万张图已足够）
    while (listPages < MAX_LIST_PAGES) {
      const opt = { limit: 1000, prefix: 'products/' };
      if (cursor) opt.cursor = cursor;
      const listing = await env.BUCKET.list(opt);
      const objs = listing?.objects || [];
      for (const o of objs) {
        const k = String(o.key || '');
        if (!k) continue;
        allR2Keys.push(k);
        if (!referenced.has(k)) orphaned.push(k);
      }
      if (!listing?.more && !listing?.cursor) break;
      cursor = listing.cursor;
      listPages++;
    }

    const dryRun = body.dryRun === true;
    let deletedCount = 0;
    let failedCount = 0;
    if (!dryRun && orphaned.length > 0) {
      // 批量删除，每批 100 个并发（R2 delete 轻量，但避免单批过大）
      const BATCH = 100;
      for (let i = 0; i < orphaned.length; i += BATCH) {
        const slice = orphaned.slice(i, i + BATCH);
        const results = await Promise.allSettled(slice.map(k => env.BUCKET.delete(k)));
        for (const r of results) {
          if (r.status === 'ok') deletedCount++;
          else failedCount++;
        }
      }
    }

    return jsonOk({
      dryRun,
      r2TotalKeys: allR2Keys.length,
      referencedCount: referenced.size,
      orphanedTotal: orphaned.length,
      deletedCount,
      failedCount,
      orphanedSample: orphaned.slice(0, 20), // 前 20 个预览，避免响应过大
    }, dryRun
      ? `扫描完成：R2 共 ${allR2Keys.length} 张图，其中 ${orphaned.length} 张孤立（dryRun 未删除）`
      : `清理完成：删除 ${deletedCount}/${orphaned.length} 张孤立图片，失败 ${failedCount} 张`
    );
  }

  // ====================================================================
  // backup：一键导出全库 JSON（categories / products / sales_logs / system_settings）
  // 用户需求：系统信息页增加一键备份功能，避免数据丢失
  //   - 返回 JSON 格式：{ meta: {...}, data: { categories, products, sales_logs, system_settings } }
  //   - 前端可保存为 haven-shop-backup-YYYYMMDD.json
  // ====================================================================
  if (action === 'backup') {
    if (!env.DB) return jsonErr('D1 数据库未绑定', 500, 9502);

    const [cats, prods, logs, settings] = await Promise.all([
      env.DB.prepare(`SELECT * FROM categories ORDER BY id ASC`).all(),
      env.DB.prepare(`SELECT * FROM products ORDER BY id ASC`).all(),
      env.DB.prepare(`SELECT * FROM sales_logs ORDER BY id ASC LIMIT 10000`).all(),
      env.DB.prepare(`SELECT * FROM system_settings ORDER BY skey ASC`).all(),
    ]);

    const now = new Date();
    const ts = now.toISOString();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;

    const payload = {
      meta: {
        version: '1.0',
        exportedAt: ts,
        generator: 'Haven Shop · itxwTeam (https://itxw.cc/)',
        dateCode: dateStr,
        counts: {
          categories: (cats?.results || []).length,
          products:   (prods?.results || []).length,
          sales_logs: (logs?.results || []).length,
          settings:   (settings?.results || []).length,
        },
      },
      data: {
        categories:      cats?.results || [],
        products:        prods?.results || [],
        sales_logs:      logs?.results || [],
        system_settings: (settings?.results || []).map(s => ({ skey: s.skey, sval: s.sval, note: s.note })),
      },
    };

    return jsonOk(payload, `已生成备份：分类 ${payload.meta.counts.categories} / 商品 ${payload.meta.counts.products} / 流水 ${payload.meta.counts.sales_logs} / 设置 ${payload.meta.counts.settings}`);
  }

  // ====================================================================
  // storageStats：统计 R2 存储占用（对象数 + 总字节数，估算）
  // 系统信息页展示用，避免用户盲猜免费额度还剩多少
  // ====================================================================
  if (action === 'storageStats') {
    if (!env.BUCKET) return jsonErr('R2 存储桶未绑定（env.BUCKET 缺失）', 500, 9405);

    let totalObjects = 0;
    let totalBytes = 0;
    let cursor;
    let pages = 0;
    const MAX_PAGES = 50;
    while (pages < MAX_PAGES) {
      const opt = { limit: 1000 };
      if (cursor) opt.cursor = cursor;
      const listing = await env.BUCKET.list(opt);
      const objs = listing?.objects || [];
      for (const o of objs) {
        totalObjects++;
        totalBytes += Number(o.size || 0);
      }
      if (!listing?.more && !listing?.cursor) break;
      cursor = listing.cursor;
      pages++;
    }

    const KB = 1024, MB = KB * 1024, GB = MB * 1024;
    const fmt = (b) => {
      if (b >= GB) return (b / GB).toFixed(2) + ' GB';
      if (b >= MB) return (b / MB).toFixed(2) + ' MB';
      if (b >= KB) return (b / KB).toFixed(1) + ' KB';
      return b + ' B';
    };

    // 同时统计 DB 中引用的图片数，方便对比
    let dbRefCount = 0;
    if (env.DB) {
      const r = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM products WHERE image_key != '' OR gallery_keys != ''`
      ).first();
      dbRefCount = r?.c || 0;
    }

    return jsonOk({
      r2Objects: totalObjects,
      r2TotalBytes: totalBytes,
      r2TotalHuman: fmt(totalBytes),
      dbImageRefProducts: dbRefCount,
    }, `R2 共 ${totalObjects} 个对象，占用 ${fmt(totalBytes)}`);
  }

  return jsonErr(`未知 action：${action}`, 400, 7999);
}
