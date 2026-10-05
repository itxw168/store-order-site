-- =====================================================================
-- 005：清空旧测试数据 + 用新 SKU/分类编码规则重建
-- 用户需求：所有分类编码和商品编码按新规则（英文+数字组合，最长5位），
--           旧的 HS-PL-001 等格式全部删除重建，便于检验测试。
-- 部署：wrangler d1 migrations apply haven-db --remote
-- =====================================================================

-- ── 1. 先删除旧商品和旧分类（含 sales_logs 引用，需先清流水） ──
DELETE FROM sales_logs;
DELETE FROM products;
DELETE FROM categories;

-- ── 2. 重置 AUTOINCREMENT 序列，让 id 从 1 开始 ──
-- SQLite 用 `DELETE FROM sqlite_sequence WHERE name = '表名'` 重置
DELETE FROM sqlite_sequence WHERE name IN ('categories', 'products', 'sales_logs');

-- =====================================================================
-- 3. 新分类数据（编码规则：单字母 A-G，对应二次元谷子周边分类）
--    吧唧 / 色纸 / 立牌 / 徽章 / 同人谷 / 痛包 / 周边礼盒
-- =====================================================================
INSERT INTO categories (id, code, icon_emoji, name_es, name_zh, sort_order, is_active) VALUES
  (1, 'A', '📌', 'Botones',          '吧唧',     10, 1),
  (2, 'B', '🎨', 'Shikishi',         '色纸',     20, 1),
  (3, 'C', '🧍', 'Stands Acrílicos',  '立牌',     30, 1),
  (4, 'D', '🏅', 'Insignias',         '徽章',     40, 1),
  (5, 'E', '🛍️', 'Merch Doujin',     '同人谷',   50, 1),
  (6, 'F', '🎒', 'Ita-bags',          '痛包',     60, 1),
  (7, 'G', '🎁', 'Cajas de Regalo',   '周边礼盒', 70, 1);

-- =====================================================================
-- 4. 新商品数据（SKU 规则：分类字母 + 4位数字，如 A0001）
--    价格统一用 MXN 墨西哥比索；每分类 2-3 件，共 16 件
-- =====================================================================
INSERT INTO products (id, sku, category_id, name_es, name_zh, desc_es, desc_zh, price_mxn, cost_mxn, stock, image_key, gallery_keys, tags, sort_order, is_active) VALUES
  -- A: 吧唧 Botones
  (1,  'A0001', 1, 'Botón Anime Sakura',    '小樱花吧唧',     'Botón coleccionable de anime, 5.5 cm, edición especial.',           '5.5cm 动漫角色吧唧 限量特典',           35.00,  18.00, 120, '', '', 'new',         10, 1),
  (2,  'A0002', 1, 'Botón K-pop Idol',      '爱豆吧唧',       'Botón oficial de grupo K-pop, diseño brillante.',                   'K-pop 偶像团体官方吧唧 闪卡设计',       42.00,  22.00,  85, '', '', 'bestseller', 20, 1),
  (3,  'A0003', 1, 'Set Botones Pastel',    '马卡龙吧唧套装', 'Set de 6 botones en colores pastel estilo kawaii.',                 '6个装马卡龙色系可爱吧唧套装',           78.00,  40.00,  45, '', '', 'limited',    30, 1),

  -- B: 色纸 Shikishi
  (4,  'B0001', 2, 'Shikishi Anime',        '动漫色纸',       'Lámina shikishi oficial de personaje de anime japonés.',            '正版日漫角色色纸签绘板',                 89.00,  45.00,  30, '', '', 'new',         10, 1),
  (5,  'B0002', 2, 'Shikishi Ilustrado',    '插画色纸',       'Arte original ilustrado en shikishi, edición de colección.',       '原创插画色纸 收藏限定版',                 128.00, 65.00,  15, '', '', 'limited',     20, 1),

  -- C: 立牌 Stands Acrílicos
  (6,  'C0001', 3, 'Stand Acrílico Waifu',  '二次元立牌',     'Stand acrílico transparente de personaje de anime, 15 cm.',        '15cm 透明亚克力二次元角色立牌',         68.00,  35.00,  60, '', '', 'new',         10, 1),
  (7,  'C0002', 3, 'Stand K-pop',           'K-pop 立牌',     'Stand acrílico de grupo K-pop, diseño coleccionable.',             'K-pop 团体亚克力立牌 收藏款',            55.00,  28.00,  40, '', '', 'bestseller',  20, 1),
  (8,  'C0003', 3, 'Stand LED RGB',         'RGB 灯效立牌',   'Stand acrílico con base LED RGB, 7 colores intercambiables.',       'RGB 七彩灯效底座亚克力立牌',             95.00,  50.00,  20, '', '', 'limited',     30, 1),

  -- D: 徽章 Insignias
  (9,  'D0001', 4, 'Insignia Metal',        '金属徽章',       'Insignia de metal esmaltado, diseño de anime japonés.',            '硬珐琅金属徽章 日漫角色',                 48.00,  25.00, 100, '', '', 'new',         10, 1),
  (10, 'D0002', 4, 'Insignia Sanrio',       '三丽鸥徽章',     'Insignia oficial de Sanrio, personaje Cinnamoroll.',                '正版三丽鸥玉桂狗珐琅徽章',               52.00,  28.00,  75, '', '', '',            20, 1),

  -- E: 同人谷 Merch Doujin
  (11, 'E0001', 5, 'Doujin Anime Art',     '同人画集',       'Libro ilustrado doujin de anime japonés, 40 páginas a color.',     '40页全彩日漫同人插画集',                 158.00, 80.00,  25, '', '', 'limited',     10, 1),
  (12, 'E0002', 5, 'Llavero Doujin',        '同人挂件',       'Llavero de peluche doujin, diseño exclusivo.',                      '同人毛绒挂件 限定设计',                   38.00,  18.00,  90, '', '', 'new',         20, 1),
  (13, 'E0003', 5, 'Sticker Pack',          '贴纸包',         'Pack de 12 stickers kawaii estilo anime japonés.',                 '12张装 日漫风可爱贴纸包',                 25.00,  10.00, 150, '', '', 'bestseller',  30, 1),

  -- F: 痛包 Ita-bags
  (14, 'F0001', 6, 'Ita-bag Rosa',          '粉色痛包',       'Ita-bag transparente color rosa pastel, con compartimento.',       '马卡龙粉透明窗痛包 大容量',              185.00, 95.00,  18, '', '', 'new',         10, 1),
  (15, 'F0002', 6, 'Ita-bag Menta',         '薄荷痛包',       'Ita-bag transparente color menta, resistente al agua.',             '薄荷绿防水透明窗痛包',                    185.00, 95.00,  12, '', '', '',            20, 1),

  -- G: 周边礼盒 Cajas de Regalo
  (16, 'G0001', 7, 'Caja Regalo K-pop',     'K-pop 礼盒',     'Caja de regalo con merch variada de K-pop: botones, stickers, llavero.', 'K-pop 周边礼盒 含吧唧/贴纸/挂件',   268.00, 140.00,  10, '', '', 'limited',     10, 1);

-- =====================================================================
-- 5. 同步把 system_settings 的 currency 强制写为 MXN（双保险）
-- =====================================================================
INSERT INTO system_settings (skey, sval, note) VALUES
  ('currency', 'MXN', '全局唯一货币：墨西哥比索 MXN')
ON CONFLICT(skey) DO UPDATE SET sval=excluded.sval, note=excluded.note, updated_at=CURRENT_TIMESTAMP;
