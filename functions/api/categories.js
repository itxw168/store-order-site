/**
 * GET /api/categories  · 公开分类列表（前台展示用）
 *
 * 返回：[{ id, code, icon_emoji, name_es, name_zh, sort_order }, ...]
 * 只返回 is_active=1 的分类，按 sort_order 升序排序
 *
 * 可选查询参数：
 *   ?includeStats=1  → 附加每个分类下已上架的商品数量（products.is_active=1）
 */
import { jsonOk, getQuery } from '../_utils.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) {
    return jsonOk([], '（未绑定 D1 数据库，返回空）', 200);
  }
  const withStats = (getQuery(request.url, 'includeStats', '0') === '1');

  // 先取所有启用分类（含树形字段）
  const rows = await env.DB.prepare(`
    SELECT id, code, icon_emoji, name_es, name_zh, sort_order, parent_id, level, is_leaf
    FROM categories
    WHERE is_active = 1
    ORDER BY sort_order ASC, id ASC
  `).all();

  const list = (rows && rows.results) ? rows.results : [];

  if (!withStats) return jsonOk(list);

  // 统计每个分类下已上架商品数量
  const statsRows = await env.DB.prepare(`
    SELECT category_id, COUNT(*) AS cnt
    FROM products
    WHERE is_active = 1
    GROUP BY category_id
  `).all();
  const map = new Map();
  if (statsRows && statsRows.results) {
    for (const r of statsRows.results) map.set(r.category_id, r.cnt);
  }
  const withCount = list.map(c => ({
    ...c,
    product_count: map.get(c.id) || 0,
  }));
  return jsonOk(withCount);
}
