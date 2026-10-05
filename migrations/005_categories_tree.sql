-- =====================================================================
-- Haven Shop · 分类表升级为无限级树形结构
-- 新增字段：parent_id, level, is_leaf
-- =====================================================================

-- 1. 添加新字段
ALTER TABLE categories ADD COLUMN parent_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN is_leaf INTEGER NOT NULL DEFAULT 1;

-- 2. 为存量数据设置默认值（所有现有分类转为一级叶子节点）
UPDATE categories SET 
  parent_id = 0,
  level = 1,
  is_leaf = 1
WHERE parent_id = 0;

-- 3. 添加索引
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_level ON categories(level);
CREATE INDEX IF NOT EXISTS idx_categories_leaf ON categories(is_leaf);

-- 4. 添加外键约束（引用自身）
-- 注意：SQLite中添加外键需要重建表，这里暂时不添加，通过应用层校验
