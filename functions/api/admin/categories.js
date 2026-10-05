import { jsonOk, jsonErr, readJSON, generateCategoryCode, generateSequentialCategoryCode, execWithRetryOnUnique } from '../../_utils.js';

function pick(obj, keys) {
  const r = {};
  for (const k of keys) if (obj[k] !== undefined) r[k] = obj[k];
  return r;
}

// 编码归一化：三级「A / A01 / A01-1」（1-2 位字母 + 两位数字 + 序号）
// 宽松接受：A1→A01（补零）、A01-01→A01-1（序号去零）；序号必须 ≥1
function normalizeCatCode(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  let m = s.match(/^([A-Z]{1,2})$/);
  if (m) return m[1];
  m = s.match(/^([A-Z]{1,2})0*(\d{1,2})$/);
  if (m && Number(m[2]) >= 1) return m[1] + String(Number(m[2])).padStart(2, '0');
  m = s.match(/^([A-Z]{1,2}\d{2})-0*(\d{1,3})$/);
  if (m && Number(m[2]) >= 1) return `${m[1]}-${Number(m[2])}`;
  return '';
}

// 层级判断：一级=A / 二级=A01 / 三级=A01-1
function isRootCode(c) { return /^[A-Z]{1,2}$/.test(String(c || '')); }
function isL2Code(c) { return /^[A-Z]{1,2}\d{2}$/.test(String(c || '')); }
function isL3Code(c) { return /^[A-Z]{1,2}\d{2}-\d{1,3}$/.test(String(c || '')); }

// 顶级编码：A..Z → AA..ZZ，跳过所有已占用编码（与总数无关，删过也不会乱）
function letterCode(i0) {
  let s = '', x = i0 + 1;
  while (x > 0) { x--; s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26); }
  return s;
}
async function loadUsedCodes(env) {
  const rows = await env.DB.prepare('SELECT code FROM categories').all();
  return new Set((rows?.results || []).map(r => String(r.code || '').trim().toUpperCase()).filter(Boolean));
}
async function nextRootCode(env) {
  const used = await loadUsedCodes(env);
  for (let i = 0; i < 702; i++) {
    const s = letterCode(i);
    if (!used.has(s)) return s;
  }
  return '';
}
// 下级编码：一级下=A01、A02...（两位数字，最大 99）；二级下=A01-1、A01-2...（最大 999），取最小未占用序号
async function nextChildCode(env, parentCode) {
  const p = normalizeCatCode(parentCode);
  if (!p) return '';
  const rows = await env.DB.prepare('SELECT code FROM categories').all();
  const used = new Set((rows?.results || []).map(r => String(r.code || '').trim().toUpperCase()).filter(Boolean));
  if (isRootCode(p)) {
    for (let n = 1; n <= 99; n++) {
      const c = `${p}${String(n).padStart(2, '0')}`;
      if (!used.has(c)) return c;
    }
    return '';
  }
  if (isL2Code(p)) {
    for (let n = 1; n <= 999; n++) {
      const c = `${p}-${n}`;
      if (!used.has(c)) return c;
    }
  }
  return '';
}

function buildTree(flat, parentId = 0) {
  const result = [];
  const map = {};
  for (const item of flat) {
    map[item.id] = { ...item, children: [] };
  }
  for (const item of flat) {
    if (item.parent_id === parentId) {
      result.push(map[item.id]);
    } else if (map[item.parent_id]) {
      map[item.parent_id].children.push(map[item.id]);
    }
  }
  return result;
}

function getAllDescendantIds(flat, parentId) {
  const ids = [];
  const children = flat.filter(c => c.parent_id === parentId);
  for (const child of children) {
    ids.push(child.id);
    ids.push(...getAllDescendantIds(flat, child.id));
  }
  return ids;
}

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.DB) return jsonErr('D1 数据库未绑定（env.DB 缺失）', 500, 9201);

  const body = await readJSON(context.request);
  if (!body || !body.action) return jsonErr('缺少参数 action', 400, 4002);

  const { action } = body;

  if (action === 'list') {
    const rows = await env.DB.prepare(`
      SELECT id, code, icon_emoji, name_es, name_zh, sort_order, is_active, parent_id, level, is_leaf, created_at, updated_at
      FROM categories ORDER BY sort_order ASC, id ASC
    `).all();
    const items = rows?.results || [];
    const stat = await env.DB.prepare(`
      SELECT category_id, COUNT(*) c FROM products GROUP BY category_id
    `).all();
    const m = new Map();
    for (const r of (stat?.results || [])) m.set(r.category_id, r.c);
    const withCount = items.map(c => ({ ...c, product_count: m.get(c.id) || 0 }));
    const tree = buildTree(withCount);
    return jsonOk({ flat: withCount, tree });
  }

  if (action === 'listFlat') {
    const rows = await env.DB.prepare(`
      SELECT id, code, icon_emoji, name_es, name_zh, sort_order, is_active, parent_id, level, is_leaf, created_at, updated_at
      FROM categories ORDER BY sort_order ASC, id ASC
    `).all();
    const items = rows?.results || [];
    const stat = await env.DB.prepare(`
      SELECT category_id, COUNT(*) c FROM products GROUP BY category_id
    `).all();
    const m = new Map();
    for (const r of (stat?.results || [])) m.set(r.category_id, r.c);
    return jsonOk(items.map(c => ({ ...c, product_count: m.get(c.id) || 0 })));
  }

  if (action === 'listLeafOnly') {
    const rows = await env.DB.prepare(`
      SELECT id, code, icon_emoji, name_es, name_zh, sort_order, is_active, parent_id, level, is_leaf, created_at, updated_at
      FROM categories WHERE is_leaf = 1 ORDER BY sort_order ASC, id ASC
    `).all();
    const items = rows?.results || [];
    const stat = await env.DB.prepare(`
      SELECT category_id, COUNT(*) c FROM products GROUP BY category_id
    `).all();
    const m = new Map();
    for (const r of (stat?.results || [])) m.set(r.category_id, r.c);
    return jsonOk(items.map(c => ({ ...c, product_count: m.get(c.id) || 0 })));
  }

  if (action === 'genCode') {
    const parentId = Number(body.parent_id) || 0;
    if (parentId > 0) {
      const pr = await env.DB.prepare('SELECT code FROM categories WHERE id = ?').bind(parentId).first();
      const code = await nextChildCode(env, pr?.code);
      if (!code) return jsonErr('该父分类下子分类编码已满（最大 999）', 400, 4105);
      return jsonOk({ code });
    }
    const code = await nextRootCode(env);
    if (!code) return jsonErr('顶级分类编码已用尽（A-ZZ）', 400, 4106);
    return jsonOk({ code });
  }

  if (action === 'create') {
    const data = body;
    if (!data.name_es || !data.name_zh) {
      return jsonErr('必填字段：name_es（西语名）、name_zh（中文名）；code 留空将自动生成', 400, 4101);
    }
    const userCode = normalizeCatCode(data.code);
    const parent_id = Number(data.parent_id) || 0;
    let level = 1;
    let is_leaf = data.is_leaf !== undefined ? (data.is_leaf ? 1 : 0) : 1;
    let parentCode = '';

    if (parent_id > 0) {
      const parent = await env.DB.prepare('SELECT code, level, is_leaf FROM categories WHERE id = ?').bind(parent_id).first();
      if (!parent) {
        return jsonErr('指定的父级分类不存在', 400, 4102);
      }
      if (parent.is_leaf === 1) {
        return jsonErr('不能将子分类挂载到叶子节点下，叶子节点不能有子分类', 400, 4103);
      }
      if (parent.level + 1 > 3) {
        return jsonErr('最多支持三级分类（如 A → A01 → A01-1），不能再往下细分', 400, 4107);
      }
      parentCode = parent.code;
      level = parent.level + 1;
    }

    // 自动编码：顶级=第一个未占用字母；子分类=父码-最小未占用序号
    const autoCode = parent_id > 0 ? await nextChildCode(env, parentCode) : await nextRootCode(env);
    if (!userCode && !autoCode) {
      return jsonErr(parent_id > 0 ? '该父分类下子分类编码已满（二级最大 99 个）' : '顶级分类编码已用尽（A-ZZ）', 400, 4106);
    }

    const payload0 = {
      code:        userCode || autoCode,
      icon_emoji:  String(data.icon_emoji || '').slice(0, 16),
      name_es:     String(data.name_es).trim(),
      name_zh:     String(data.name_zh).trim(),
      sort_order:  Number.isFinite(Number(data.sort_order)) ? Number(data.sort_order) : 100,
      is_active:   data.is_active === 0 ? 0 : 1,
      parent_id,
      level,
      is_leaf,
    };
    if (!payload0.code) payload0.code = autoCode;

    const runStmt = async (p) => {
      const info = await env.DB.prepare(`
        INSERT INTO categories (code, icon_emoji, name_es, name_zh, sort_order, is_active, parent_id, level, is_leaf)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(p.code, p.icon_emoji, p.name_es, p.name_zh, p.sort_order, p.is_active, p.parent_id, p.level, p.is_leaf).run();
      return { id: info?.meta?.last_row_id, ...p };
    };
    // UNIQUE 冲突重试：二级 A01→A02（末两位数字+1）；三级 A01-1→A01-2（序号+1）；顶级取字典序之后下一个未占用字母
    const mutate = async (p) => {
      const c = String(p.code || '').toUpperCase();
      if (isL3Code(c)) {
        const [base, n] = c.split('-');
        return { ...p, code: `${base}-${Number(n) + 1}` };
      }
      if (isL2Code(c)) {
        const letters = c.replace(/\d{2}$/, '');
        const n = Number(c.slice(letters.length)) + 1;
        return { ...p, code: `${letters}${String(n).padStart(2, '0')}` };
      }
      const used = await loadUsedCodes(env);
      for (let i = 0; i < 702; i++) {
        const s = letterCode(i);
        if (s > String(p.code || '') && !used.has(s)) return { ...p, code: s };
      }
      return { ...p, code: `${p.code}X` };
    };
    const r = await execWithRetryOnUnique(runStmt, mutate, payload0);
    if (!r.ok) return jsonErr((r.error && r.error.message) || '创建分类失败，请重试', 500, 4104);
    
    if (parent_id > 0) {
      await env.DB.prepare('UPDATE categories SET is_leaf = 0 WHERE id = ?').bind(parent_id).run();
    }
    
    return jsonOk(r.result, `已创建分类「${r.payload.name_es} / ${r.payload.name_zh}」编码=${r.payload.code}`);
  }

  if (action === 'update') {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) return jsonErr('缺少参数 id（分类数字 ID）', 400, 4201);
    const exist = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!exist) return jsonErr('分类不存在', 404, 4202);

    const patch = {};
    const allowed = ['code', 'icon_emoji', 'name_es', 'name_zh', 'sort_order', 'is_active', 'parent_id', 'is_leaf'];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        patch[k] = k === 'sort_order' ? Number(body[k])
                  : k === 'is_active'  ? (body[k] === 0 ? 0 : 1)
                  : k === 'parent_id' ? Number(body[k]) || 0
                  : k === 'is_leaf'    ? (body[k] ? 1 : 0)
                  : k === 'code'       ? normalizeCatCode(body[k])
                  : String(body[k]).trim();
      }
    }
    if (Object.keys(patch).length === 0) return jsonOk({ id }, '无变更');
    
    if (patch.parent_id !== undefined && patch.parent_id === id) {
      return jsonErr('不能将父级设置为自己', 400, 4203);
    }
    
    if (patch.parent_id !== undefined) {
      if (patch.parent_id > 0) {
        const parent = await env.DB.prepare('SELECT level, is_leaf FROM categories WHERE id = ?').bind(patch.parent_id).first();
        if (!parent) {
          return jsonErr('指定的父级分类不存在', 400, 4204);
        }
        if (parent.is_leaf === 1) {
          return jsonErr('不能将分类挂载到叶子节点下', 400, 4205);
        }
        if (parent.level + 1 > 3) {
          return jsonErr('最多支持三级分类（如 A → A01 → A01-1），不能再往下细分', 400, 4208);
        }
        patch.level = parent.level + 1;
      } else {
        patch.level = 1;
      }
    }
    
    if (patch.is_leaf !== undefined) {
      if (patch.is_leaf === 1) {
        const hasChildren = await env.DB.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ?').bind(id).first();
        if (hasChildren && hasChildren.c > 0) {
          return jsonErr('该分类下存在子分类，不能改为叶子节点', 400, 4206);
        }
      }
    }
    
    if (patch.code && patch.code !== exist.code) {
      const run = async (c) => {
        await env.DB.prepare(`UPDATE categories SET code = ? WHERE id = ?`).bind(c, id).run();
        return c;
      };
      // UNIQUE 冲突重试：二级 A01→A02（末两位数字+1）；三级 A01-1→A01-2（序号+1）；顶级取字典序之后下一个未占用字母
      const mut = async (c) => {
        const s = String(c || '').toUpperCase();
        if (isL3Code(s)) {
          const [base, n] = s.split('-');
          return `${base}-${Number(n) + 1}`;
        }
        if (isL2Code(s)) {
          const letters = s.replace(/\d{2}$/, '');
          const n = Number(s.slice(letters.length)) + 1;
          return `${letters}${String(n).padStart(2, '0')}`;
        }
        const used = await loadUsedCodes(env);
        for (let i = 0; i < 702; i++) {
          const t = letterCode(i);
          if (t > String(c || '') && !used.has(t)) return t;
        }
        return `${c}X`;
      };
      const r = await execWithRetryOnUnique(run, mut, patch.code);
      if (!r.ok) return jsonErr((r.error && r.error.message) || '分类编码更新失败，请重试', 500, 4207);
      patch.code = r.result;
    }
    
    const sets = Object.keys(patch).map(k => `${k} = ?`).join(', ');
    const vals = Object.values(patch);
    await env.DB.prepare(`UPDATE categories SET ${sets} WHERE id = ?`).bind(...vals, id).run();
    
    if (patch.parent_id !== undefined && patch.parent_id > 0) {
      await env.DB.prepare('UPDATE categories SET is_leaf = 0 WHERE id = ?').bind(patch.parent_id).run();
    }
    
    if (patch.parent_id !== undefined && exist.parent_id > 0 && exist.parent_id !== patch.parent_id) {
      const oldSiblings = await env.DB.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ?').bind(exist.parent_id).first();
      if (oldSiblings && oldSiblings.c === 0) {
        await env.DB.prepare('UPDATE categories SET is_leaf = 1 WHERE id = ?').bind(exist.parent_id).run();
      }
    }
    
    return jsonOk({ id, ...exist, ...patch }, `已更新分类 ID=${id}`);
  }

  if (action === 'delete') {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) return jsonErr('缺少参数 id', 400, 4301);
    const exist = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!exist) return jsonOk(null, '分类不存在或已删除');
    
    const hasChildren = await env.DB.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ?').bind(id).first();
    if (hasChildren && hasChildren.c > 0) {
      return jsonErr(
        '当前分类下存在子分类，请先迁移/删除全部子分类后再删除',
        409, 4091
      );
    }
    
    const inUse = await env.DB.prepare('SELECT COUNT(*) c FROM products WHERE category_id = ?').bind(id).first();
    if (inUse && inUse.c > 0) {
      return jsonErr(
        `该叶子分类下已绑定 ${inUse.c} 件商品，请先迁移商品绑定关系再删除`,
        409, 4090
      );
    }
    
    if (exist.parent_id > 0) {
      const siblings = await env.DB.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ?').bind(exist.parent_id).first();
      if (siblings && siblings.c === 1) {
        await env.DB.prepare('UPDATE categories SET is_leaf = 1 WHERE id = ?').bind(exist.parent_id).run();
      }
    }
    
    await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
    return jsonOk({ deletedId: id }, `已删除分类「${exist.name_es} / ${exist.name_zh}」`);
  }

  if (action === 'reorder') {
    const order = Array.isArray(body.order) ? body.order.map(Number).filter(Number.isFinite) : [];
    if (order.length === 0) return jsonErr('缺少参数 order（数字数组）', 400, 4401);
    const stmts = order.map((id, i) =>
      env.DB.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').bind((i + 1) * 10, id)
    );
    await env.DB.batch(stmts);
    return jsonOk({ reordered: order.length }, `已重排 ${order.length} 个分类`);
  }

  if (action === 'moveNode') {
    const id = Number(body.id);
    const targetParentId = Number(body.targetParentId) || 0;
    if (!Number.isFinite(id) || id <= 0) return jsonErr('缺少参数 id', 400, 4501);
    if (id === targetParentId) return jsonErr('不能移动到自己下面', 400, 4502);
    
    const exist = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!exist) return jsonErr('分类不存在', 404, 4503);
    
    if (targetParentId > 0) {
      const targetParent = await env.DB.prepare('SELECT level, is_leaf FROM categories WHERE id = ?').bind(targetParentId).first();
      if (!targetParent) {
        return jsonErr('目标父级分类不存在', 400, 4504);
      }
      if (targetParent.is_leaf === 1) {
        return jsonErr('不能移动到叶子节点下', 400, 4505);
      }
      const newLevel = targetParent.level + 1;
      await env.DB.prepare('UPDATE categories SET parent_id = ?, level = ? WHERE id = ?').bind(targetParentId, newLevel, id).run();
      await env.DB.prepare('UPDATE categories SET is_leaf = 0 WHERE id = ?').bind(targetParentId).run();
      
      const oldSiblings = await env.DB.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ?').bind(exist.parent_id).first();
      if (oldSiblings && oldSiblings.c === 1) {
        await env.DB.prepare('UPDATE categories SET is_leaf = 1 WHERE id = ?').bind(exist.parent_id).run();
      }
      
      return jsonOk({ movedId: id, newParentId: targetParentId, newLevel }, `已移动分类到父级 ID=${targetParentId}`);
    } else {
      await env.DB.prepare('UPDATE categories SET parent_id = 0, level = 1 WHERE id = ?').bind(id).run();
      
      const oldSiblings = await env.DB.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ?').bind(exist.parent_id).first();
      if (oldSiblings && oldSiblings.c === 1) {
        await env.DB.prepare('UPDATE categories SET is_leaf = 1 WHERE id = ?').bind(exist.parent_id).run();
      }
      
      return jsonOk({ movedId: id, newParentId: 0, newLevel: 1 }, '已移动到顶级分类');
    }
  }

  if (action === 'getChildrenIds') {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) return jsonErr('缺少参数 id', 400, 4601);
    
    const all = await env.DB.prepare('SELECT id, parent_id FROM categories').all();
    const flat = all?.results || [];
    const descendantIds = getAllDescendantIds(flat, id);
    return jsonOk({ categoryId: id, descendantIds });
  }

  if (action === 'getBreadcrumbs') {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) return jsonErr('缺少参数 id', 400, 4701);
    
    const breadcrumbs = [];
    let current = await env.DB.prepare('SELECT id, code, name_es, name_zh, icon_emoji, parent_id, level FROM categories WHERE id = ?').bind(id).first();
    while (current) {
      breadcrumbs.unshift(current);
      if (current.parent_id === 0) break;
      current = await env.DB.prepare('SELECT id, code, name_es, name_zh, icon_emoji, parent_id, level FROM categories WHERE id = ?').bind(current.parent_id).first();
    }
    return jsonOk({ categoryId: id, breadcrumbs });
  }

  return jsonErr(`未知 action：${action}`, 400, 4999);
}