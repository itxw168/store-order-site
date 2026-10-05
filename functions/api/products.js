/**
 * GET /api/products  · 公开商品列表（前台展示 + 搜索/筛选用）
 *
 * 查询参数：
 *   categoryId, categoryCode, skuOrKeyword, onlyActive（1 默认只上架）
 *   limit / offset
 *
 * 返回：
 * { ok:true, data:{ total, items:[{id,sku,...,price,cost,image_url,image_key}] , settings:{currency:'MXN'} } }
 *
 * 用户需求：全站货币统一为墨西哥比索（MXN），移除 EUR/USD/CNY 与汇率换算。
 */
import { jsonOk, getQuery, buildPublicImgUrl } from '../_utils.js';

function parseIntSafe(s, def = 0) {
  const n = Number(s);
  if (!Number.isFinite(n)) return def;
  return Math.floor(n);
}
function numOr(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function round2(n) { return Math.round(numOr(n, 0) * 100) / 100; }

async function getSiteSettings(env) {
  const want = ['currency', 'stock_low_threshold', 'shop_title_es', 'shop_title_zh'];
  const DEFS = { currency:'MXN', stock_low_threshold:'5', shop_title_es:'Haven Shop', shop_title_zh:'Haven Shop' };
  if (!env.DB) return DEFS;
  const sql = `SELECT skey, sval FROM system_settings WHERE skey IN (${want.map(()=>'?').join(',')})`;
  let rows = [];
  try { rows = (await env.DB.prepare(sql).bind(...want).all())?.results || []; } catch (_) {}
  const o = { ...DEFS };
  for (const r of rows) o[r.skey] = r.sval;
  o.currency = 'MXN';
  return o;
}

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

export async function onRequestGet(context) {
  const { env, request } = context;
  const R2_PREFIX = (env.R2_PUBLIC_PREFIX || '').trim();

  const categoryId   = parseIntSafe(getQuery(request.url, 'categoryId',   '0'), 0);
  const categoryCode = getQuery(request.url, 'categoryCode', '').trim();
  const keyword      = getQuery(request.url, 'skuOrKeyword', '').trim();
  const onlyActive   = getQuery(request.url, 'onlyActive', '1') !== '0';
  const limit        = Math.max(1, Math.min(500, parseIntSafe(getQuery(request.url, 'limit',  '200'), 200)));
  const offset       = Math.max(0, parseIntSafe(getQuery(request.url, 'offset', '0'), 0));

  const settings = await getSiteSettings(env);

  // 本地无 D1 预览时 → 返回空数组（前台会 fallback 到 mock）
  if (!env.DB) return jsonOk({ total: 0, items: [], settings: { currency: 'MXN' } }, '（未绑定 D1，返回空）');

  const where = [];
  const args = [];

  if (onlyActive) where.push('p.is_active = 1');
  
  if (categoryId > 0) {
    const cat = await env.DB.prepare('SELECT id, is_leaf FROM categories WHERE id = ?').bind(categoryId).first();
    if (cat) {
      if (cat.is_leaf === 1) {
        where.push('p.category_id = ?');
        args.push(categoryId);
      } else {
        const leafIds = await getLeafIdsUnderGroup(env, categoryId);
        if (leafIds.length > 0) {
          where.push(`p.category_id IN (${leafIds.map(() => '?').join(',')})`);
          args.push(...leafIds);
        } else {
          where.push('1 = 0');
        }
      }
    }
  }
  
  if (categoryCode) { where.push('c.code = ?'); args.push(categoryCode); }
  if (keyword) {
    const k = `%${keyword}%`;
    where.push('(p.sku LIKE ? OR p.name_es LIKE ? OR p.name_zh LIKE ?)');
    args.push(k, k, k);
  }
  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countSQL = `SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON c.id = p.category_id ${whereSQL}`;
  const listSQL = `
    SELECT p.id, p.sku, p.category_id, p.name_es, p.name_zh, p.desc_es, p.desc_zh,
           p.price_mxn, p.cost_mxn, p.stock, p.image_key, p.gallery_keys, p.tags,
           p.sort_order, p.is_active,
           p.presale_arrive_date, p.presale_note_es, p.presale_note_zh,
           c.code AS category_code,
           c.icon_emoji AS category_icon, c.name_es AS category_name_es, c.name_zh AS category_name_zh
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSQL}
    ORDER BY c.sort_order ASC, p.sort_order ASC, p.id ASC
    LIMIT ? OFFSET ?
  `;

  const [countRes, listRes] = await Promise.all([
    env.DB.prepare(countSQL).bind(...args).first(),
    env.DB.prepare(listSQL).bind(...args, limit, offset).all(),
  ]);

  const total = (countRes && countRes.total) ? Number(countRes.total) : 0;
  const rows = (listRes && listRes.results) ? listRes.results : [];

  const items = rows.map(r => {
    const price = round2(numOr(r.price_mxn, 0));
    const cost  = round2(numOr(r.cost_mxn, 0));
    return {
      ...r,
      price_mxn: price,
      cost_mxn:  cost,
      // 主货币（前台只显示这个）：amount + currency
      price: { amount: price, currency: 'MXN' },
      cost:  { amount: cost,  currency: 'MXN' },
      profit:{ amount: round2(price - cost), currency: 'MXN' },
      image_url:    buildPublicImgUrl(R2_PREFIX, r.image_key),
      gallery_urls: (r.gallery_keys || '')
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(k => buildPublicImgUrl(R2_PREFIX, k)),
    };
  });

  return jsonOk({
    total, items,
    settings: {
      currency: 'MXN',
      stock_low_threshold: parseIntSafe(settings.stock_low_threshold, 5),
      title_es: String(settings.shop_title_es || 'Haven Shop'),
      title_zh: String(settings.shop_title_zh || 'Haven Shop'),
    },
  });
}
