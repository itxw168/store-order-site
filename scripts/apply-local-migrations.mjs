import fs from 'node:fs';
import path from 'node:path';

// 本地 D1 是 miniflare 管理的 SQLite。优先用 better-sqlite3（wrangler 自带依赖），否则提示。
const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite') && !f.includes('metadata'));

// 找出哪个库文件包含/需要 products 表：直接对每个空库应用全部迁移
const candidates = ['better-sqlite3', '@miniflare/shared', 'node:sqlite'];

let applied = false;

// Node 22+ 内置 node:sqlite
let Database;
try {
  const sq = await import('node:sqlite');
  Database = sq.DatabaseSync;
  console.log('using node:sqlite');
} catch (e) {
  try {
    const mod = await import('better-sqlite3');
    Database = mod.default;
    console.log('using better-sqlite3');
  } catch (e2) {
    console.error('NO_SQLITE_DRIVER');
    process.exit(2);
  }
}

const migrations = fs.readdirSync('migrations').filter(f => f.endsWith('.sql')).sort();
for (const file of files) {
  const dbPath = path.join(dir, file);
  console.log(`--- db: ${file}`);
  // 跳过已有表的库（可能是其他绑定），只对空库建表
  let db;
  try { db = new Database(dbPath); } catch (e) { console.log(`skip (locked/open): ${e.message}`); continue; }
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    if (tables.length > 0) { console.log(`skip, existing tables: ${tables.join(',')}`); continue; }
    for (const m of migrations) {
      const sql = fs.readFileSync(path.join('migrations', m), 'utf8');
      try {
        db.exec(sql);
        console.log(`applied ${m}`);
      } catch (err) {
        console.log(`WARN ${m}: ${String(err.message).slice(0, 120)}`);
      }
    }
    const after = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    console.log(`tables now: ${after.join(',')}`);
    applied = true;
  } finally { db.close(); }
}
console.log(applied ? 'DONE' : 'NOTHING_APPLIED');
