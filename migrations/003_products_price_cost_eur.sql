-- =====================================================================
-- 003：products 新增欧元价/成本价字段，sales_logs 加成本快照；system_settings 存全局偏好
-- 部署：wrangler d1 migrations apply haven-db --remote
-- =====================================================================

-- ── products：价格/成本扩展（兼容老数据，默认用 price_usd 回填 price_eur） ──
ALTER TABLE products ADD COLUMN price_eur REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN cost_usd  REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN cost_eur  REAL NOT NULL DEFAULT 0;

-- 把已有 price_usd 作为回退，第一次部署时把 price_eur = price_usd（等比，避免空值）
UPDATE products SET price_eur = price_usd WHERE price_eur IS NULL OR price_eur = 0;

CREATE INDEX IF NOT EXISTS idx_products_eur_price ON products(price_eur);

-- ── sales_logs：增加 EUR/USD 成本价快照 + EUR 售价快照，方便利润统计 ──
ALTER TABLE sales_logs ADD COLUMN price_eur_snap REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_logs ADD COLUMN cost_usd_snap  REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_logs ADD COLUMN cost_eur_snap  REAL NOT NULL DEFAULT 0;

-- 兼容回填：price_eur_snap 先取历史 price_usd_snap 作为近似（汇率可后续通过校正订单重算）
UPDATE sales_logs SET price_eur_snap = COALESCE(price_usd_snap,0) WHERE price_eur_snap IS NULL OR price_eur_snap = 0;

-- ── system_settings：站点/后台偏好（货币、默认语言、EUR↔USD 汇率、自定义前台配置等） ──
CREATE TABLE IF NOT EXISTS system_settings (
  skey       TEXT PRIMARY KEY,           -- 例如 'currency' / 'admin_default_lang' / 'rate_eur_to_usd'
  sval       TEXT    NOT NULL,           -- 值（文本，数字/JSON 都转字符串存）
  note       TEXT    NOT NULL DEFAULT '',
  updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
  ('currency',              'EUR',  '全局显示货币：EUR | USD（后台切换后写入此处，前台+后台读取）'),
  ('admin_default_lang',    'zh',   '后台默认显示语言：zh | es（登录后首次访问使用）'),
  ('rate_eur_to_usd',       '1.08', '1 EUR 可换多少 USD（用于录入价时的自动换算，后台可调整）'),
  ('stock_low_threshold',   '5',    '库存低位阈值（≤ 该值标记黄色低位卡）'),
  ('shop_title_es',         'Haven Shop', '前台默认标题西语'),
  ('shop_title_zh',         'Haven Shop', '前台默认标题中文');
