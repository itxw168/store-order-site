-- =====================================================================
-- Haven Shop · 迁移 007：首页预售专区后台配置 + 好评内容扩充 + 社区入口补充
-- 内容：
--   1) 新增预售专区配置键：标题/角标（双语）+ 展示数量上限
--   2) 社区好评默认数据扩充到 12 条（仅当现有条数 ≤ 4 时才覆盖，
--      保护商家已在后台自定义过的数据）
--   3) 加入社区入口补充为「WhatsApp 商品目录 + 门店导航」两条
--      （仅当现有条数 ≤ 1 时才升级）
--   ※ 客服与售后的全部文案键已在迁移 006 写入完整默认值，无需变更
-- 幂等性：INSERT OR IGNORE 可重复执行；两个 UPDATE 带条件守卫
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 预售专区配置键（前台渲染时为空值自动回退到内置文案）
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

-- ---------------------------------------------------------------------
-- 2. 社区好评扩充至 12 条
--    守卫条件：当前数组长度 ≤ 4（即仍是 006 初始 3 条或本地测试 2 条）
-- ---------------------------------------------------------------------
UPDATE system_settings SET
  sval = '[{"name":"María G.","stars":5,"text_es":"Excelente calidad, llegó rápido y muy bien empacado. ¡Volveré a comprar!","text_zh":"质量非常好，发货很快包装也很仔细，下次还会回购！"},{"name":"Carlos R.","stars":5,"text_es":"Atención por WhatsApp muy amable, resolvieron todas mis dudas antes de comprar.","text_zh":"WhatsApp 客服很耐心，下单前把所有疑问都解答了。"},{"name":"Ana L.","stars":4,"text_es":"Muy bonitos productos, precios accesibles y la tienda está bien ubicada.","text_zh":"商品很漂亮，价格实惠，店面位置也很好找。"},{"name":"Diego M.","stars":5,"text_es":"Los badges son hermosos, tal cual la foto. Mi hija feliz con su colección.","text_zh":"吧唧超可爱，和图片一模一样，女儿收到特别开心。"},{"name":"Fernanda S.","stars":5,"text_es":"Súper recomendado, pedí un lote para regalo y todos encantados.","text_zh":"超推荐！买了一批当礼物，大家都特别喜欢。"},{"name":"Luis A.","stars":4,"text_es":"Buen empaque, llegaron en fecha. Volveré por más series.","text_zh":"包装很好，按时到货，还会来回购其他系列。"},{"name":"Sofía T.","stars":5,"text_es":"Me encantó el shikishi, el color es igual al original.","text_zh":"色纸太爱了，颜色跟原版一样鲜艳。"},{"name":"Ricardo P.","stars":5,"text_es":"Excelente servicio, me avisaron cuando llegó nuevo stock.","text_zh":"服务超好，补货了还主动通知我。"},{"name":"Valeria C.","stars":4,"text_es":"Precios justos y atención rápida por WhatsApp.","text_zh":"价格公道，WhatsApp 回复很快很贴心。"},{"name":"Jorge H.","stars":5,"text_es":"La tienda está cerca del Centro Histórico, fácil de encontrar.","text_zh":"店就在历史中心附近，很好找，现场挑货更开心。"},{"name":"Paola N.","stars":5,"text_es":"Todo llegó perfecto y con detalles bonitos en el empaque.","text_zh":"包裹里还有小贴纸装饰，细节满分，全部完好。"},{"name":"Emmanuel D.","stars":5,"text_es":"Gran variedad de anime, siempre hay algo nuevo cada semana.","text_zh":"动漫周边种类很多，每周都有新品上架。"}]',
  note = '社区好评列表 JSON：[{name,stars,text_es,text_zh}]（迁移 007 扩充 12 条）',
  updated_at = CURRENT_TIMESTAMP
WHERE skey = 'reviews_json' AND json_array_length(sval) <= 4;

-- ---------------------------------------------------------------------
-- 3. 加入社区入口：WhatsApp 商品目录 + 门店地图导航
--    守卫条件：当前数组长度 ≤ 1（即仍是初始单条）
-- ---------------------------------------------------------------------
UPDATE system_settings SET
  sval = '[{"icon":"fab fa-whatsapp","title_es":"Catálogo de WhatsApp","title_zh":"WhatsApp 商品目录","url":"https://wa.me/5215500000000"},{"icon":"📍","title_es":"Cómo llegar a la tienda","title_zh":"门店位置 · 一键导航","url":"https://www.google.com/maps/search/?api=1&query=Av.+Ejemplo+123+Ciudad+de+M%C3%A9xico"}]',
  note = '加入社区入口 JSON：[{icon,title_es,title_zh,url}]（迁移 007 补充导航入口）',
  updated_at = CURRENT_TIMESTAMP
WHERE skey = 'community_links_json' AND json_array_length(sval) <= 1;
