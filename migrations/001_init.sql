-- =====================================================================
-- Haven Shop · D1 数据库初始化脚本（SQLite 语法，兼容 Cloudflare D1）
-- 部署命令：wrangler d1 migrations apply haven-db --remote
-- 本地调试：wrangler d1 migrations apply haven-db --local
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────
-- 表 1：categories（商品分类）
-- 注：「全部 / Todos / Todo」是前台 UI 虚拟分类，数据库里不存
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,        -- 分类英文编码，路由用 plush/doll/cards/bags/kpop/anime/accessories
  icon_emoji  TEXT    NOT NULL DEFAULT '🎁',  -- 分类图标 emoji
  name_es     TEXT    NOT NULL,               -- 西班牙语名称（默认首语言）
  name_zh     TEXT    NOT NULL,               -- 中文名称
  sort_order  INTEGER NOT NULL DEFAULT 100,   -- 排序：越小越靠前，建议 10/20/30..
  is_active   INTEGER NOT NULL DEFAULT 1,     -- 1=启用 0=禁用（禁用前台不显示）
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_active_sort ON categories(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_code        ON categories(code);

-- ─────────────────────────────────────────────────────────────────────
-- 表 2：products（商品）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT    NOT NULL UNIQUE,              -- 内部 SKU，唯一（例：HS-PL-001）
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name_es      TEXT    NOT NULL,                     -- 西语商品名
  name_zh      TEXT    NOT NULL,                     -- 中文商品名
  desc_es      TEXT    NOT NULL DEFAULT '',          -- 西语详情长文本（多行）
  desc_zh      TEXT    NOT NULL DEFAULT '',          -- 中文详情长文本（多行）
  price_usd    REAL    NOT NULL DEFAULT 0,           -- 美元价格（保留 2 位小数）
  price_cny    REAL    NOT NULL DEFAULT 0,           -- 人民币价格（可选，展示用）
  stock        INTEGER NOT NULL DEFAULT 0,           -- 库存：0=售罄，前台可标「缺货」
  image_key    TEXT    NOT NULL DEFAULT '',          -- 主图 R2 key：如 products/HS-PL-001-main.jpg
  gallery_keys TEXT    NOT NULL DEFAULT '',          -- 附加图集：逗号分隔（key1,key2,key3）
  tags         TEXT    NOT NULL DEFAULT '',          -- 标签：逗号分隔（new,bestseller,limited）
  is_active    INTEGER NOT NULL DEFAULT 1,           -- 1=上架 0=下架（下架前台不显示）
  sort_order   INTEGER NOT NULL DEFAULT 100,         -- 分类内排序
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_sku            ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category       ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active         ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_cat_sort       ON products(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_active_cat     ON products(is_active, category_id);

-- ─────────────────────────────────────────────────────────────────────
-- 触发器：updated_at 自动刷新（UPDATE 时自动写当前时间）
-- ─────────────────────────────────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_categories_updated_at
AFTER UPDATE ON categories
FOR EACH ROW
BEGIN
  UPDATE categories SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_products_updated_at
AFTER UPDATE ON products
FOR EACH ROW
BEGIN
  UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- =====================================================================
-- 默认数据 · 7 个真实分类（sort_order 建议 10 一格，方便后续插入）
-- =====================================================================
INSERT OR IGNORE INTO categories (code, icon_emoji, name_es, name_zh, sort_order) VALUES
  ('plush',       '🧸', 'Peluches',          '毛绒挂件',   10),
  ('doll',        '🎎', 'Muñecas',           '娃娃玩偶',   20),
  ('cards',       '🃏', 'Tarjetas',          '收藏卡牌',   30),
  ('bags',        '👜', 'Bolsos',            '潮包周边',   40),
  ('kpop',        '💖', 'Merch K-Pop',       'Kpop 周边',  50),
  ('anime',       '📚', 'Mercancía Anime',   '日漫周边',   60),
  ('accessories', '🔮', 'Accesorios Lindos', '可爱配件',   70);

-- =====================================================================
-- 默认数据 · 16 个示例商品（对应原前台 mock 数据）
-- image_key 暂时留空，后台上传后会覆盖；id 手动指定以便关联，实际可自增
-- =====================================================================
INSERT OR IGNORE INTO products (id, sku, category_id, name_es, name_zh, desc_es, desc_zh, price_usd, price_cny, stock, image_key, tags, sort_order) VALUES
  -- 分类 1: Peluches (毛绒)
  (1,  'HS-PL-001', 1, 'Oso de Peluche Morado',  '紫色抱抱熊',     'Oso de peluche suave de 30 cm, ideal para regalo.',                '30cm 超柔软毛绒熊，送礼首选',                  25.90, 168,  58, '', 'new',         10),
  (2,  'HS-PL-002', 1, 'Conejo Orejas Largas',   '长耳小兔公仔',   'Conejo blanco con orejas largas, 25 cm.',                          '25cm 白色长耳垂耳兔',                            18.50, 128,  32, '', 'bestseller',  20),
  (3,  'HS-PL-003', 1, 'Gatito Mochi Arcoíris',  '彩虹麻薯猫',     'Gatito super esponjoso con colores pastel.',                       '彩虹色马卡龙超软团子猫',                         29.90, 198,  45, '', 'limited',     30),
  (4,  'HS-PL-004', 1, 'Cinnamoroll Llavero',    '玉桂狗挂饰',     'Llavero de peluche de Cinnamoroll Sanrio original.',               '正版三丽鸥玉桂狗毛绒钥匙扣',                     15.90, 98,   120, '', 'new',        40),

  -- 分类 2: Muñecas (娃娃)
  (5,  'HS-DO-001', 2, 'Muñeca Lolita Dream',    '洛丽塔梦境娃娃', 'Muñeca articulada 1/6 con vestido lolita rosa pastel.',            '1/6 可动人偶马卡龙粉洛丽塔裙装',                 89.00, 598,  12,  '', 'limited',     10),
  (6,  'HS-DO-002', 2, 'Nendoroid Sakura',       '小樱粘土人',     'Nendoroid de Sakura Kinomoto (CCS), Good Smile original.',         '正版 GSC 魔卡少女樱 木之本樱 粘土人',            68.50, 458,  8,   '', 'bestseller',  20),
  (7,  'HS-DO-003', 2, 'Figura Bunny Girl',      '兔女郎手办',     'Figura escala 1/7 Bunny Girl 24 cm, detalles premium.',            '1/7 比例 24cm 兔女郎高品质手办',                 128.00,888,   3,   '', 'limited',     30),
  (8,  'HS-DO-004', 2, 'Muñeca Cotton Dress',    '棉花娃连衣裙',   'Ropa de vestido de algodón para muñeca de 20 cm.',                 '20cm 棉花娃通用 纯棉公主裙套装',                 28.00, 188,  60,  '', 'new',         40),

  -- 分类 3: Tarjetas (卡牌)
  (9,  'HS-CA-001', 3, 'Caja Booster BTS',       'BTS 实体专卡盒',  'Caja de 20 sobres de tarjetas fotográficas oficiales de BTS.',     'BTS 官方周边小卡 20 包整盒未拆封',               98.00, 658,  15,  '', 'bestseller',  10),
  (10, 'HS-CA-002', 3, 'Tarjetas Holo Pokémon',  '宝可梦闪卡包',    'Pack de 10 tarjetas holográficas Pokémon edición 151.',            '宝可梦卡牌 151 版本 10 张装闪卡包',              39.90, 258,  80,  '', 'new',         20),
  (11, 'HS-CA-003', 3, 'Set Cartas Waifu',       '二次元老婆卡册',  'Álbum con 240 tarjetas coleccionables de personajes de anime.',    '240 张动漫人气角色收藏卡册',                     58.00, 388,  28,  '', '',            30),
  (12, 'HS-CA-004', 3, 'Caja Cartas Genshin',    '原神卡牌盲盒',    'Caja misteriosa con 12 tarjetas raras + 1 firmada aleatoria.',     '原神主题盲盒卡牌 12 张稀有+1 张随机签名卡',      88.00, 588,  20,  '', 'limited',     40),

  -- 分类 4: Bolsos (包包)
  (13, 'HS-BA-001', 4, 'Bolso Tote Macaron',     '马卡龙托特包',    'Bolso tote mediano color menta, resistente al agua.',              '薄荷绿马卡龙中号托特包，防水面料',               45.90, 298,  35,  '', 'new',         10),
  (14, 'HS-BA-002', 4, 'Mochila Hello Kitty',    'Hello Kitty 背包', 'Mochila escolar de Hello Kitty Sanrio con compartimento laptop.',  '正版三丽鸥 Hello Kitty 学生书包带电脑隔层',      78.00, 518,  22,  '', 'bestseller',  20),
  (15, 'HS-BA-003', 4, 'Bandolera Cute Bunny',   '可爱兔兔斜挎包',  'Bandolera de peluche con orejas de conejo, ajustable.',            '毛绒兔耳朵造型可调节肩带斜挎包',                 32.90, 218,  45,  '', 'new',         30),
  (16, 'HS-BA-004', 4, 'Monedero Kuromi',        '库洛米零钱包',    'Monedero pequeño de silicona de Kuromi con cierre.',               '正版三丽鸥库洛米硅胶零钱包带搭扣',               18.90, 128,  90,  '', '',            40);
