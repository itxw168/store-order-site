/**
 * 全局系统设置（前后台都能用的只读公开接口；写入走 /api/admin/settings）
 *
 * GET  /api/settings?keys=currency,rate_eur_to_usd,admin_default_lang   → 返回 { items:[{k,v}], map:{k:v} }
 * POST /api/settings（仅内部调用，无需鉴权但写入会被 _middleware 拦截在 /api/admin 之外，所以这里公开接口只做读取）
 */
import { jsonOk, getQuery } from '../_utils.js';

async function getAll(env, keysFilter) {
  const sql = keysFilter && keysFilter.length
    ? `SELECT skey, sval FROM system_settings WHERE skey IN (${keysFilter.map(() => '?').join(',')})`
    : `SELECT skey, sval FROM system_settings`;
  const r = await env.DB.prepare(sql).bind(...(keysFilter || [])).all();
  return (r?.results || []).map(x => ({ k: x.skey, v: x.sval }));
}

const DEFAULTS = {
  currency: 'MXN',
  admin_default_lang: 'zh',
  rate_eur_to_usd: '1',
  stock_low_threshold: '5',
  shop_title_es: 'Haven Shop',
  shop_title_zh: 'Haven Shop',
  // ---- 站点内容配置默认值（与迁移 006 保持一致）----
  top_sales_mode: 'auto',
  top_sales_manual_ids: '',
  // ---- 预售专区配置默认值（与迁移 007 保持一致）----
  presale_title_es: '✦ Próximos lanzamientos',
  presale_title_zh: '✦ 即将发售 · 预售专区',
  presale_badge_es: 'Preventa activa',
  presale_badge_zh: '预售进行中',
  presale_max: '3',
  reviews_json: '[]',
  community_links_json: '[{"icon":"fab fa-whatsapp","title_es":"Catálogo de WhatsApp","title_zh":"WhatsApp 商品目录","url":"https://wa.me/5215500000000"}]',
  cs_guarantee_es: 'Revisamos cada producto antes de entregarlo. Si hay algún detalle, lo cambiamos sin problema.',
  cs_guarantee_zh: '每件商品发货前均经人工检查，如有问题无忧更换。',
  cs_shipping_es: 'Envíos a todo México. Compra segura en tienda o por WhatsApp.',
  cs_shipping_zh: '全墨西哥可发货，门店自提或 WhatsApp 下单均可。',
  cs_contact_whatsapp: '55 0000 0000',
  cs_contact_url: 'https://wa.me/5215500000000',
  cs_contact_hours_es: 'Lun-Sáb 10:00-19:00',
  cs_contact_hours_zh: '周一至周六 10:00-19:00',
  cs_address_es: 'Av. Ejemplo 123, Col. Centro, 06000 Ciudad de México, CDMX',
  cs_address_zh: 'Av. Ejemplo 123（墨西哥城示例地址）',
  cs_maps_url: 'https://www.google.com/maps/search/?api=1&query=Av.+Ejemplo+123+Ciudad+de+M%C3%A9xico',
};

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) {
    return jsonOk({
      items: Object.entries(DEFAULTS).map(([k, v]) => ({ k, v })),
      map: { ...DEFAULTS },
      fallback: true,
    }, '未绑定 D1，返回开发默认值（不会写入）');
  }
  const rawKeys = getQuery(request.url, 'keys', '').trim();
  const keysFilter = rawKeys ? rawKeys.split(',').map(s => s.trim()).filter(Boolean) : null;
  let rows = [];
  try { rows = await getAll(env, keysFilter); } catch (_) {}
  const map = { ...DEFAULTS };
  for (const r of rows) if (r.v !== undefined) map[r.k] = r.v;
  // 强制规范：货币恒为 MXN，汇率已废弃
  map.currency = 'MXN';
  map.rate_eur_to_usd = '1';
  const items = Object.entries(map).map(([k, v]) => ({ k, v }));
  return jsonOk({ items, map });
}
