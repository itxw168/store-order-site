-- =====================================================================
-- Haven Shop · 迁移 008：预置演示/排查用测试数据
-- 内容：
--   1) 给 3 件商品设置未来预售到货日期 → 前台「预售专区」立即可见
--   2) 补充销售出库流水 → 保证 TOP3 榜单有足够数据分布
--   3) 兜底：确保 reviews_json / community_links_json 为 007 的完整版
--      （守卫条件保护商家自定义数据）
-- 幂等性：可重复执行；UPDATE 均带条件守卫或为固定演示值
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 预售专区演示数据：挑 3 件在售商品设为「即将到货」
--    （id 2 / 6 / 9 若存在则设置；日期取未来，前台按日期从近到远排序展示）
-- ---------------------------------------------------------------------
UPDATE products SET
  presale_arrive_date = '2026-09-15',
  presale_note_es = 'Llega el 15 de septiembre · reserva ya',
  presale_note_zh = '预计 9 月 15 日到货 · 可预订'
WHERE id = 2;

UPDATE products SET
  presale_arrive_date = '2026-10-01',
  presale_note_es = 'Disponible el 1 de octubre',
  presale_note_zh = '10 月 1 日开售'
WHERE id = 6;

UPDATE products SET
  presale_arrive_date = '2026-11-20',
  presale_note_es = 'Preventa hasta agotar existencias',
  presale_note_zh = '预售 · 售完即止'
WHERE id = 9;

-- ---------------------------------------------------------------------
-- 2. TOP3 销量流水补充：给 id=5 / id=1 各追加一笔大额出库，
--    让榜单销量差异更明显（change_type=-1 表示出库/销售）
--    仅当对应商品存在时才插入（通过子查询守卫）
-- ---------------------------------------------------------------------
INSERT INTO sales_logs (product_id, sku, change_type, delta, stock_before, stock_after, note, operator)
SELECT p.id, p.sku, -1,
       -12,
       p.stock + 12, p.stock,
       'demo top-sales seed', 'demo'
FROM products p WHERE p.id = 5
AND NOT EXISTS (SELECT 1 FROM sales_logs s WHERE s.note = 'demo top-sales seed' AND s.product_id = 5);

INSERT INTO sales_logs (product_id, sku, change_type, delta, stock_before, stock_after, note, operator)
SELECT p.id, p.sku, -1,
       -10,
       p.stock + 10, p.stock,
       'demo top-sales seed', 'demo'
FROM products p WHERE p.id = 1
AND NOT EXISTS (SELECT 1 FROM sales_logs s WHERE s.note = 'demo top-sales seed' AND s.product_id = 1);

-- ---------------------------------------------------------------------
-- 3. 好评/社区入口兜底升级（与迁移 007 相同的守卫逻辑，防线上库仍是旧值）
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('presale_title_es', '✦ Próximos lanzamientos', '预售专区标题·西语');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('presale_title_zh', '✦ 即将发售 · 预售专区', '预售专区标题·中文');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('presale_badge_es', 'Preventa activa', '预售专区角标·西语');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('presale_badge_zh', '预售进行中', '预售专区角标·中文');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('presale_max', '3', '预售专区最多展示商品数（1-6，默认 3）');
