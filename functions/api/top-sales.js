/**
 * GET /api/top-sales  · 首页「本周销量 TOP3」榜单（公开）
 *
 * 模式由 system_settings.top_sales_mode 控制：
 *   - auto   ：按 sales_logs 近 7 天出库（change_type=-1）聚合；若近 7 天无数据，
 *              自动回退到全部历史出库量；仍为空则返回空列表（前端隐藏区块）
 *   - manual ：按 top_sales_manual_ids（逗号分隔商品ID）顺序取前 3 个
 *
 * 返回：{ ok:true, data:{ mode:'auto'|'manual', items:[{id,sku,name_es,name_zh,image_url,price,sold}] } }
 */
import { jsonOk, buildPublicImgUrl } from '../_utils.js';

async function getSetting(env, key, def = '') {
  if (!env.DB) return def;
  try {
    const r = await env.DB.prepare('SELECT sval FROM system_settings WHERE skey = ?').bind(key).first();
    return (r && r.sval != null) ? String(r.sval) : def;
  } catch (_) { return def; }
}

/* auto 模式：优先近 7 天出库聚合，空则回退全量历史
   说明：sales_logs 中销售流水 change_type=-1 且 delta 为负数，销量 = -SUM(delta) */
async function aggregateAuto(env) {
  const baseSelect = `
    SELECT l.product_id AS pid, SUM(-l.delta) AS sold
    FROM sales_logs l
    WHERE l.change_type = -1`;
  const groupBy = ' GROUP BY l.product_id HAVING sold > 0 ORDER BY sold DESC LIMIT 3';

  // 近 7 天
  let rows = [];
  try {
    const res = await env.DB.prepare(`${baseSelect} AND l.created_at >= datetime('now', '-7 days')${groupBy}`).all();
    rows = (res && res.results) || [];
  } catch (_) { rows = []; }

  // 回退：全部历史
  if (!rows.length) {
    try {
      const res = await env.DB.prepare(`${baseSelect}${groupBy}`).all();
      rows = (res && res.results) || [];
    } catch (_) { rows = []; }
  }

  return rows.map(r => ({ id: Number(r.pid), sold: Math.max(0, Math.round(Number(r.sold) || 0)) }));
}

/* manual 模式：按配置的 ID 顺序取前 3 */
async function loadManual(env) {
  const raw = await getSetting(env, 'top_sales_manual_ids', '');
  const ids = String(raw).split(',').map(s => Number(String(s).trim())).filter(n => Number.isFinite(n) && n > 0);
  return ids.slice(0, 3).map(id => ({ id, sold: null }));
}

/* 按 ID 列表补齐商品信息，保持传入顺序 */
async function hydrateItems(env, R2_PREFIX, ranked) {
  if (!ranked.length) return [];
  const placeholders = ranked.map(() => '?').join(',');
  const sql = `
    SELECT p.id, p.sku, p.name_es, p.name_zh, p.image_key, p.price_mxn
    FROM products p
    WHERE p.id IN (${placeholders}) AND p.is_active = 1`;
  let rows = [];
  try {
    const res = await env.DB.prepare(sql).bind(...ranked.map(r => r.id)).all();
    rows = (res && res.results) || [];
  } catch (_) { rows = []; }

  const byIdMap = new Map(rows.map(r => [Number(r.id), r]));
  const out = [];
  for (const r of ranked) {
    const p = byIdMap.get(r.id);
    if (!p) continue; // 商品已下架/删除 → 跳过
    out.push({
      id: Number(p.id),
      sku: p.sku || '',
      name_es: p.name_es || '',
      name_zh: p.name_zh || '',
      image_url: buildPublicImgUrl(R2_PREFIX, p.image_key),
      price: Number(p.price_mxn) || 0,
      sold: r.sold,
    });
  }
  return out.slice(0, 3);
}

export async function onRequestGet(context) {
  const { env } = context;
  const R2_PREFIX = (env.R2_PUBLIC_PREFIX || '').trim();

  if (!env.DB) return jsonOk({ mode: 'auto', items: [] }, '未绑定 D1，返回空榜单');

  const modeRaw = await getSetting(env, 'top_sales_mode', 'auto');
  const mode = (modeRaw === 'manual') ? 'manual' : 'auto';

  const ranked = (mode === 'manual') ? await loadManual(env) : await aggregateAuto(env);
  const items = await hydrateItems(env, R2_PREFIX, ranked);

  return jsonOk({ mode, items });
}
