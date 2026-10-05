-- =====================================================================
-- Haven Shop · D1 库存盘点 & 销售流水表（SQLite 语法，兼容 Cloudflare D1）
-- 部署命令：wrangler d1 migrations apply haven-db --remote
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sales_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku           TEXT    NOT NULL,
  change_type   INTEGER NOT NULL,
  delta         INTEGER NOT NULL,
  stock_before  INTEGER NOT NULL,
  stock_after   INTEGER NOT NULL,
  price_usd_snap REAL,
  price_cny_snap REAL,
  note          TEXT    NOT NULL DEFAULT '',
  operator      TEXT    NOT NULL DEFAULT 'admin',
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sales_logs_pid    ON sales_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_logs_sku    ON sales_logs(sku);
CREATE INDEX IF NOT EXISTS idx_sales_logs_ctime  ON sales_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_logs_ct_out ON sales_logs(change_type, created_at);
