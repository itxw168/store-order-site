-- =====================================================================
-- 004：全站货币统一为墨西哥比索（MXN），移除 EUR/USD/CNY 多币种与汇率
-- 用户需求：后台+前端商品卡片价格货币单位统一默认"比索"，只用这一种，
--           其他全部删掉，不需要汇率。
-- 部署：wrangler d1 migrations apply haven-db --remote
-- =====================================================================

-- ── products：新增 MXN 销售价 / 成本价字段 ──
ALTER TABLE products ADD COLUMN price_mxn REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN cost_mxn  REAL NOT NULL DEFAULT 0;

-- 兼容回填：把已有 price_eur（或 price_usd）作为 price_mxn 初始值，避免历史商品价格为 0
UPDATE products SET price_mxn = price_eur WHERE price_mxn = 0 AND price_eur > 0;
UPDATE products SET price_mxn = price_usd WHERE price_mxn = 0 AND price_usd > 0;
UPDATE products SET cost_mxn  = cost_eur  WHERE cost_mxn  = 0 AND cost_eur  > 0;
UPDATE products SET cost_mxn  = cost_usd  WHERE cost_mxn  = 0 AND cost_usd  > 0;

CREATE INDEX IF NOT EXISTS idx_products_mxn_price ON products(price_mxn);

-- ── sales_logs：增加 MXN 售价/成本快照，用于利润统计 ──
ALTER TABLE sales_logs ADD COLUMN price_mxn_snap REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_logs ADD COLUMN cost_mxn_snap  REAL NOT NULL DEFAULT 0;

-- 兼容回填：历史流水用 price_eur_snap / price_usd_snap 近似填充
UPDATE sales_logs SET price_mxn_snap = price_eur_snap WHERE price_mxn_snap = 0 AND price_eur_snap > 0;
UPDATE sales_logs SET price_mxn_snap = price_usd_snap  WHERE price_mxn_snap = 0 AND price_usd_snap  > 0;
UPDATE sales_logs SET cost_mxn_snap  = cost_eur_snap   WHERE cost_mxn_snap  = 0 AND cost_eur_snap   > 0;
UPDATE sales_logs SET cost_mxn_snap  = cost_usd_snap   WHERE cost_mxn_snap  = 0 AND cost_usd_snap    > 0;

-- ── system_settings：全局货币固定为 MXN，移除汇率配置 ──
-- 用 INSERT OR REPLACE 强制覆盖：currency=MXN，清空 frontend_currency（不再需要前台强制货币）
INSERT INTO system_settings (skey, sval, note) VALUES
  ('currency', 'MXN', '全局唯一货币：墨西哥比索 MXN（前后台统一，不再支持 EUR/USD/CNY 切换）')
ON CONFLICT(skey) DO UPDATE SET sval=excluded.sval, note=excluded.note, updated_at=CURRENT_TIMESTAMP;

-- 移除 frontend_currency（设为空，表示前台跟随 currency=MXN）
INSERT INTO system_settings (skey, sval, note) VALUES
  ('frontend_currency', '', '已废弃：全站统一 MXN，不再有前台独立货币')
ON CONFLICT(skey) DO UPDATE SET sval='', note=excluded.note, updated_at=CURRENT_TIMESTAMP;

-- rate_eur_to_usd 保留但标记废弃（后台不再展示该配置项）
INSERT INTO system_settings (skey, sval, note) VALUES
  ('rate_eur_to_usd', '1', '已废弃：全站统一 MXN，不再需要 EUR↔USD 汇率')
ON CONFLICT(skey) DO UPDATE SET sval='1', note=excluded.note, updated_at=CURRENT_TIMESTAMP;
