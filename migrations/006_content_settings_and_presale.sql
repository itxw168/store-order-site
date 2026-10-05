-- =====================================================================
-- Haven Shop · 内容配置扩展：商品预售字段 + 站点内容设置键
-- 配套需求：
--   1) 前台首页改版（v3）：预售专区 / 本周销量 TOP3 / 社区好评 /
--      加入社区 / 客服与售后 全部改为后台可配置
--   2) 商品可单独设置"预计到货日期"与双语预售说明
-- 部署命令：wrangler d1 migrations apply haven-db --remote
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 商品表新增预售字段（幂等性说明：D1 的 ALTER 不支持 IF NOT EXISTS，
--    若重复执行报 duplicate column 属正常，跳过即可）
-- ---------------------------------------------------------------------
ALTER TABLE products ADD COLUMN presale_arrive_date TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN presale_note_es     TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN presale_note_zh     TEXT NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------
-- 2. system_settings 新增站点内容配置键
--    INSERT OR IGNORE：已存在的键不会被覆盖，方便重复执行
-- ---------------------------------------------------------------------

-- 销量榜单模式：auto=按 sales_logs 近7天出库自动统计；manual=手动指定商品ID
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('top_sales_mode', 'auto', 'TOP3 榜单模式：auto 自动统计 / manual 手动指定');

-- 手动模式下指定的商品 ID 列表（逗号分隔，最多取前3个）
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('top_sales_manual_ids', '', '手动榜单商品ID，逗号分隔，如 12,5,8');

-- 社区好评（JSON 数组：[{name, stars, text_es, text_zh}]）
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES (
'reviews_json',
'[{"name":"María G.","stars":5,"text_es":"Excelente calidad, llegó rápido y muy bien empacado. ¡Volveré a comprar!","text_zh":"质量非常好，发货很快包装也很仔细，下次还会回购！"},{"name":"Carlos R.","stars":5,"text_es":"Atención por WhatsApp muy amable, resolvieron todas mis dudas antes de comprar.","text_zh":"WhatsApp 客服很耐心，下单前把所有疑问都解答了。"},{"name":"Ana L.","stars":4,"text_es":"Muy bonitos productos, precios accesibles y la tienda está bien ubicada.","text_zh":"商品很漂亮，价格实惠，店面位置也很好找。"}]',
'社区好评列表 JSON：[{name,stars,text_es,text_zh}]'
);

-- 加入社区链接（JSON 数组：[{icon,title_es,title_zh,url}]）
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES (
'community_links_json',
'[{"icon":"fab fa-whatsapp","title_es":"Catálogo de WhatsApp","title_zh":"WhatsApp 商品目录","url":"https://wa.me/5215500000000"}]',
'加入社区入口 JSON：[{icon,title_es,title_zh,url}]'
);

-- 客服与售后：品质保证
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_guarantee_es', 'Revisamos cada producto antes de entregarlo. Si hay algún detalle, lo cambiamos sin problema.', '客服卡片1·西语标题文案');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_guarantee_zh', '每件商品发货前均经人工检查，如有问题无忧更换。', '客服卡片1·中文文案');

-- 客服与售后：配送说明
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_shipping_es', 'Envíos a todo México. Compra segura en tienda o por WhatsApp.', '客服卡片2·西语文案');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_shipping_zh', '全墨西哥可发货，门店自提或 WhatsApp 下单均可。', '客服卡片2·中文文案');

-- 客服与售后：WhatsApp 联系方式（号码展示 + 跳转链接）
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_contact_whatsapp', '55 0000 0000', '客服 WhatsApp 展示号码');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_contact_url', 'https://wa.me/5215500000000', '客服 WhatsApp 跳转链接');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_contact_hours_es', 'Lun-Sáb 10:00-19:00', '营业时间·西语');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_contact_hours_zh', '周一至周六 10:00-19:00', '营业时间·中文');

-- 客服与售后：门店地址 + 地图链接
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_address_es', 'Av. Ejemplo 123, Col. Centro, 06000 Ciudad de México, CDMX', '门店地址·西语');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_address_zh', 'Av. Ejemplo 123（墨西哥城示例地址）', '门店地址·中文');
INSERT OR IGNORE INTO system_settings (skey, sval, note) VALUES
('cs_maps_url', 'https://www.google.com/maps/search/?api=1&query=Av.+Ejemplo+123+Ciudad+de+M%C3%A9xico', '谷歌地图链接');

-- ---------------------------------------------------------------------
-- 3. 辅助索引：TOP3 周榜按 change_type=-1 聚合 created_at 已有索引覆盖，
--    这里补一个商品维度的聚合索引加速 GROUP BY product_id
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sales_logs_ct_out_pid ON sales_logs(change_type, product_id, created_at);
