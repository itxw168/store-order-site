/**
 * POST /api/admin/stock  · 库存盘点 / 销售登记 / 流水查询 / 统计 / 导出
 * body.action:
 *   'search'    按 SKU/关键词快速搜商品（库存盘点专用，items 含 stock/image_url）
 *   'adjust'    增减库存并写流水：{ product_id, delta, change_type, note, set_stock }
 *                 - change_type: 1=入库(+) / -1=销售(-delta) / 2=校正(±任意)
 *                 - 若传 set_stock=N，则 delta = N - stock_before（覆盖式校正）
 *   'logs'      查询流水分页：{ page, perPage, kw, days }
 *   'stats'     今日/本周/本月/7日/30日销量&销售额&利润 + 库存概览
 *   'exportCsv' 导出 CSV：{ kind: 'stock' | 'sales', days?:N }
 *   'setRate'   调整汇率并写 system_settings：{ eur_to_usd: 1.08 } （可选）
 */
import { jsonOk, jsonErr, readJSON, buildPublicImgUrl } from '../../_utils.js';

function numOr(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function round2(n) { return Math.round(numOr(n, 0) * 100) / 100; }
function escCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[\",\r\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}

/** 读 system_settings 的单个值（字符串），不存在给默认 */
async function getSetting(env, skey, def = '') {
  try {
    const r = await env.DB.prepare('SELECT sval FROM system_settings WHERE skey = ?').bind(String(skey)).first();
    return r && r.sval !== undefined ? String(r.sval) : def;
  } catch (_) { return def; }
}
/** 写 system_settings 的单个值 */
async function putSetting(env, skey, sval, note = '') {
  sval = String(sval == null ? '' : sval);
  await env.DB.prepare(`
    INSERT INTO system_settings (skey, sval, note) VALUES (?,?,?)
    ON CONFLICT(skey) DO UPDATE SET sval=excluded.sval, note=excluded.note, updated_at=CURRENT_TIMESTAMP
  `).bind(String(skey), sval, note || '').run();
  return true;
}

// ---------- search ----------
async function actionSearch(env, body) {
  const kw = String(body.keyword || body.kw || '').trim();
  const limit = Math.max(1, Math.min(100, numOr(body.limit, 30)));
  let rows;
  if (kw) {
    rows = (await env.DB.prepare(`
      SELECT p.*, c.code AS cat_code, c.name_es AS cat_es, c.name_zh AS cat_zh
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.sku LIKE ? OR p.name_es LIKE ? OR p.name_zh LIKE ?
      ORDER BY (p.sku LIKE ?) DESC, p.sku ASC, p.id DESC
      LIMIT ?
    `).bind(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, limit).all())?.results || [];
  } else {
    rows = (await env.DB.prepare(`
      SELECT p.*, c.code AS cat_code, c.name_es AS cat_es, c.name_zh AS cat_zh
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      ORDER BY p.stock ASC, p.category_id ASC, p.id DESC
      LIMIT ?
    `).bind(limit).all())?.results || [];
  }
  const items = rows.map(r => ({
    ...r,
    image_url: buildPublicImgUrl(env.R2_PUBLIC_PREFIX||'', r.image_key),
    profit_mxn: round2(numOr(r.price_mxn,0) - numOr(r.cost_mxn,0)),
  }));
  return jsonOk({ items });
}

// ---------- adjust ----------
async function actionAdjust(env, body) {
  const product_id = numOr(body.product_id, 0);
  if (product_id <= 0) return jsonErr('缺少 product_id', 400, 6101);
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(product_id).first();
  if (!row) return jsonErr('商品不存在', 404, 6102);
  const stock_before = Math.max(0, Math.floor(numOr(row.stock, 0)));
  let change_type = numOr(body.change_type, -1);
  if (![-1,1,2].includes(change_type)) change_type = -1;

  let delta;
  if (body.set_stock !== undefined) {
    const target = Math.max(0, Math.floor(numOr(body.set_stock, 0)));
    delta = target - stock_before;
    if (delta !== 0) change_type = 2;
  } else {
    delta = Math.floor(numOr(body.delta, 0));
    if (change_type === -1 && delta > 0) delta = -delta;  // 销售必须为负
    if (change_type === 1 && delta < 0) delta = -delta;   // 入库必须为正
  }
  if (delta === 0 && body.set_stock === undefined) return jsonOk({ id: row.id, sku: row.sku, stock_before, stock_after: stock_before, changed: 0 }, '库存变动为 0，未作变更');
  if (change_type === -1 && Math.abs(delta) > stock_before) {
    return jsonErr(`库存不足：当前库存 ${stock_before} 件，本次要出库 ${Math.abs(delta)} 件，请先校正再登记`, 409, 6105);
  }
  const stock_after = Math.max(0, stock_before + delta);
  const note = String(body.note || '').slice(0, 500);
  const operator = String(body.operator || 'admin').slice(0, 64);

  const snap = {
    price_mxn: round2(numOr(row.price_mxn, 0)),
    cost_mxn:  round2(numOr(row.cost_mxn,  0)),
  };

  // UPDATE 与 INSERT 分离：若 INSERT 失败，把真实错误透传给前端（不再被全局中间件吞成「内部错误」）
  try {
    await env.DB.prepare('UPDATE products SET stock = ? WHERE id = ?').bind(stock_after, product_id).run();
  } catch (ue) {
    return jsonErr('更新库存失败：' + (ue && ue.message ? ue.message : String(ue)), 500, 6103);
  }
  let info;
  try {
    info = await env.DB.prepare(`
      INSERT INTO sales_logs (product_id, sku, change_type, delta, stock_before, stock_after,
        price_mxn_snap, cost_mxn_snap, note, operator)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      product_id, row.sku, change_type, delta, stock_before, stock_after,
      snap.price_mxn, snap.cost_mxn, note, operator
    ).run();
  } catch (ie) {
    // 库存已更新成功，但流水写入失败：返回部分成功 + 真实错误，前端可据此提示并触发 Dashboard 刷新
    return jsonOk({
      product_id, sku: row.sku,
      stock_before, stock_after,
      changed: Math.abs(delta),
      log_written: false,
      log_error: ie && ie.message ? ie.message : String(ie),
    }, `库存已更新为 ${stock_after} 件，但流水记录写入失败：${ie && ie.message ? ie.message : String(ie)}（请联系管理员排查 sales_logs 表）`);
  }

  const qty = change_type === -1 ? Math.abs(delta) : 0;
  return jsonOk({
    id: info?.meta?.last_row_id,
    product_id, sku: row.sku,
    change_type, delta,
    stock_before, stock_after,
    changed: Math.abs(delta),
    // 附带本次登记贡献的销售额/利润（前端可直接累加 Dashboard，统一 MXN）
    revenue: { mxn: round2(qty * snap.price_mxn) },
    profit:  { mxn: round2(qty * (snap.price_mxn - snap.cost_mxn)) },
  }, change_type === -1 ? `已登记销售：${row.sku} -${Math.abs(delta)} 件，剩余 ${stock_after} 件`
    : change_type === 1 ? `已入库：${row.sku} +${delta} 件，共 ${stock_after} 件`
    : `已校正库存：${row.sku} → ${stock_after} 件（变动 ${delta>=0?'+':''}${delta}）`);
}

// ---------- logs ----------
async function actionLogs(env, body) {
  const page    = Math.max(1, numOr(body.page, 1));
  const perPage = Math.max(1, Math.min(500, numOr(body.perPage, 50)));
  const kw      = String(body.kw || body.keyword || '').trim();
  const days    = numOr(body.days, 0);
  const where = [], args = [];
  if (kw) { where.push('(sl.sku LIKE ? OR sl.note LIKE ?)'); args.push(`%${kw}%`, `%${kw}%`); }
  if (days > 0) { where.push(`DATE(sl.created_at) >= DATE('now', '-${days} days')`); }
  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const OFFSET = (page - 1) * perPage;
  try {
    const countSQL = `SELECT COUNT(*) c FROM sales_logs sl ${whereSQL}`;
    const listSQL  = `SELECT sl.*, p.name_es, p.name_zh FROM sales_logs sl LEFT JOIN products p ON p.id=sl.product_id ${whereSQL} ORDER BY sl.id DESC LIMIT ? OFFSET ?`;
    const totalR = args.length
      ? await env.DB.prepare(countSQL).bind(...args).first()
      : await env.DB.prepare(countSQL).first();
    const list = args.length
      ? await env.DB.prepare(listSQL).bind(...args, perPage, OFFSET).all()
      : await env.DB.prepare(listSQL).bind(perPage, OFFSET).all();
    const items = (list?.results || []).map(x => ({
      ...x,
      revenue_mxn:  round2((x.change_type === -1 ? (-x.delta) : 0) * numOr(x.price_mxn_snap, 0)),
      profit_mxn:   round2((x.change_type === -1 ? (-x.delta) : 0) * (numOr(x.price_mxn_snap, 0) - numOr(x.cost_mxn_snap, 0))),
    }));
    return jsonOk({
      total: totalR?.c || 0,
      page, perPage,
      totalPages: Math.ceil((totalR?.c||0) / perPage),
      items,
    });
  } catch (e) {
    return jsonErr('logs 查询失败：' + (e && e.message ? e.message : String(e)) + ' | whereSQL=' + whereSQL + ' | args=' + JSON.stringify(args), 500, 6104);
  }
}

/** 给定 SQLite 支持的区间起点条件（SQL 片段 + args），返回聚合结果 */
async function sumRange(env, whereSQL, args) {
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN change_type=-1 THEN -delta ELSE 0 END),0) AS sold_units,
      COALESCE(SUM(CASE WHEN change_type= 1 THEN  delta ELSE 0 END),0) AS in_units,
      COALESCE(SUM(CASE WHEN change_type= 2 THEN  ABS(delta) ELSE 0 END),0) AS adj_units,

      COALESCE(SUM(CASE WHEN change_type=-1 THEN (-delta) * COALESCE(price_mxn_snap,0) ELSE 0 END),0) AS revenue_mxn,

      COALESCE(SUM(CASE WHEN change_type=-1 THEN (-delta) * (COALESCE(price_mxn_snap,0)-COALESCE(cost_mxn_snap,0)) ELSE 0 END),0) AS profit_mxn,

      COUNT(*) AS ops
    FROM sales_logs
    ${whereSQL ? 'WHERE ' + whereSQL : ''}
  `;
  const r = await env.DB.prepare(sql).bind(...args).first();
  return {
    sold_units:  Number(r?.sold_units||0),
    in_units:    Number(r?.in_units||0),
    adj_units:   Number(r?.adj_units||0),
    out_units:   Number(r?.sold_units||0), // 兼容旧调用：出库=销售
    revenue_mxn: round2(r?.revenue_mxn),
    profit_mxn:  round2(r?.profit_mxn),
    ops:         Number(r?.ops||0),
  };
}

// ---------- stats ----------
async function actionStats(env) {
  // 1) 按天区间聚合
  const todayRange = ["DATE(created_at) = DATE('now')", []];
  const weekRange  = ["strftime('%Y-%W', created_at) = strftime('%Y-%W', 'now')", []]; // 自然周（周一为一周首日在 SQLite 里 %W 是周一开始）
  const monthRange = ["strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')", []];
  const d7Range    = ["DATE(created_at) >= DATE('now', '-6 days')", []];
  const d30Range   = ["DATE(created_at) >= DATE('now', '-29 days')", []];

  const [today, week, month, d7, d30] = await Promise.all([
    sumRange(env, ...todayRange),
    sumRange(env, ...weekRange),
    sumRange(env, ...monthRange),
    sumRange(env, ...d7Range),
    sumRange(env, ...d30Range),
  ]);

  // 2) 库存概览：总数 / 0 库存商品数 / 低位阈值（从 system_settings 读，默认 5）
  const low = Math.max(1, Math.floor(numOr(await getSetting(env, 'stock_low_threshold', '5'), 5)));
  const stockSnap = await env.DB.prepare(`
    SELECT
      SUM(stock) total_units,
      COUNT(*) sku_cnt,
      SUM(CASE WHEN stock<=0 THEN 1 ELSE 0 END) out_cnt,
      SUM(CASE WHEN stock BETWEEN 1 AND ? THEN 1 ELSE 0 END) low_cnt,
      COALESCE(SUM(stock * price_mxn),0) stock_value_mxn,
      COALESCE(SUM(stock * cost_mxn),0)  stock_cost_mxn
    FROM products
  `).bind(low).first();

  // 全站统一 MXN，不再有汇率
  return jsonOk({
    today, week, month, d7, d30,
    stock: {
      low_threshold: low,
      total_units:   Number(stockSnap?.total_units||0),
      sku_cnt:       Number(stockSnap?.sku_cnt||0),
      out_cnt:       Number(stockSnap?.out_cnt||0),
      low_cnt:       Number(stockSnap?.low_cnt||0),
      stock_value_mxn: round2(stockSnap?.stock_value_mxn),
      stock_cost_mxn:  round2(stockSnap?.stock_cost_mxn),
    },
  });
}

// ---------- exportCsv ----------
async function actionExport(env, body) {
  const kind = String(body.kind || 'sales');
  const days = numOr(body.days, 30);
  if (kind === 'stock') {
    const r = await env.DB.prepare(`
      SELECT p.id, p.sku, p.name_es, p.name_zh, c.name_es AS cat_es, c.name_zh AS cat_zh,
             p.stock, p.price_mxn, p.cost_mxn,
             (p.price_mxn - p.cost_mxn) AS profit_mxn,
             p.is_active, p.sort_order, p.updated_at
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      ORDER BY p.category_id ASC, p.sort_order ASC, p.id DESC
    `).all();
    const head = ['ID','SKU','西语名','中文名','分类西','分类中','库存',
                  '比索售价(MXN)','比索成本(MXN)','利润(MXN)',
                  '上架','排序','更新时间'];
    const rows = (r?.results || []).map(x => [x.id,x.sku,x.name_es,x.name_zh,x.cat_es,x.cat_zh,x.stock,
      x.price_mxn,x.cost_mxn,x.profit_mxn,
      x.is_active,x.sort_order,x.updated_at].map(escCsv).join(','));
    const csv = '﻿' + [head.join(','), ...rows].join('\n');
    return new Response(csv, { status:200, headers: { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="haven-stock.csv"' } });
  }
  // sales
  const where = days>0 ? [`DATE(sl.created_at) >= DATE('now', '-${days} days')`] : [];
  const args  = [];
  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const listSQL = `
    SELECT sl.id, sl.created_at, sl.sku, p.name_es, p.name_zh,
           CASE sl.change_type WHEN -1 THEN '销售出库' WHEN 1 THEN '入库' ELSE '校正' END AS ct,
           sl.delta, sl.stock_before, sl.stock_after,
           COALESCE(sl.price_mxn_snap,0) pm, COALESCE(sl.cost_mxn_snap,0) cm,
           sl.note, sl.operator
    FROM sales_logs sl LEFT JOIN products p ON p.id=sl.product_id
    ${whereSQL}
    ORDER BY sl.id DESC
    LIMIT 20000
  `;
  const r = args.length
    ? await env.DB.prepare(listSQL).bind(...args).all()
    : await env.DB.prepare(listSQL).all();
  const head = ['流水号','时间','SKU','西语名','中文名','类型','变动','操作前','操作后',
                '比索价(MXN)','比索成本(MXN)','利润(MXN)','备注','操作人'];
  const rows = (r?.results || []).map(x => {
    const qty = x.ct === '销售出库' ? Math.abs(Number(x.delta||0)) : 0;
    return [x.id,x.created_at,x.sku,x.name_es,x.name_zh,x.ct,x.delta,x.stock_before,x.stock_after,
      x.pm, x.cm, round2(qty*(x.pm-x.cm)),
      x.note, x.operator].map(escCsv).join(',');
  });
  const csv = '﻿' + [head.join(','), ...rows].join('\n');
  return new Response(csv, { status:200, headers: { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="haven-sales.csv"' } });
}

// ---------- deleteLogs：删除指定流水记录（支持批量） ----------
async function actionDeleteLogs(env, body) {
  const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(Number).filter(n => n > 0);
  if (ids.length === 0) return jsonErr('缺少 id 或 ids 数组', 400, 6106);
  const qs = ids.map(() => '?').join(',');
  try {
    await env.DB.prepare(`DELETE FROM sales_logs WHERE id IN (${qs})`).bind(...ids).run();
  } catch (e) {
    return jsonErr('删除流水失败：' + (e && e.message ? e.message : String(e)), 500, 6107);
  }
  return jsonOk({ deleted: ids.length, ids }, `已删除 ${ids.length} 条流水记录`);
}

// ---------- setRate 已废弃：全站统一 MXN，不再需要 EUR↔USD 汇率 ----------
async function actionSetRate(env, body) {
  return jsonErr('汇率配置已废弃：全站统一使用墨西哥比索（MXN），不再需要 EUR↔USD 汇率', 400, 6601);
}

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.DB) return jsonErr('D1 数据库未绑定', 500, 9601);
  const body = await readJSON(context.request);
  if (!body || !body.action) return jsonErr('缺少参数 action', 400, 6001);
  const { action } = body;
  if (action === 'search') return actionSearch(env, body);
  if (action === 'adjust') return actionAdjust(env, body);
  if (action === 'logs')   return actionLogs(env, body);
  if (action === 'deleteLogs') return actionDeleteLogs(env, body);
  if (action === 'stats')  return actionStats(env);
  if (action === 'setRate') return actionSetRate(env, body);
  if (action === 'exportCsv') return actionExport(env, body);
  return jsonErr(`未知 action：${action}`, 400, 6999);
}
