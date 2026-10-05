import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

// 遍历 miniflare 管理的全部 D1 库文件（wrangler 实际读哪个由内部哈希决定，双写保证一致）
const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files = fs.readdirSync(dir).filter(x => x.endsWith('.sqlite') && !x.startsWith('metadata'));

for (const f of files) {
  const db = new DatabaseSync(dir + '/' + f);
  let hasProducts = false;
  try { db.prepare('SELECT 1 FROM products LIMIT 1').get(); hasProducts = true; } catch {}
  if (!hasProducts) { console.log(`${f.slice(0, 12)}… skip (no products table)`); db.close(); continue; }

  // ① 给 2 件商品设置预售到货日期（未来日期 → 前台预售专区应显示）
  db.prepare(`UPDATE products SET presale_arrive_date='2026-12-31',
    presale_note_es='Llega el 31 de diciembre', presale_note_zh='预计 12 月 31 日到货'
    WHERE id IN (1, 3)`).run();

  // ② 补销售流水：product 2 卖 8 件、product 4 卖 5 件（change_type=-1, delta 为负）
  const hasLog = db.prepare(`SELECT COUNT(*) c FROM sales_logs`).get().c;
  if (hasLog === 0) {
    const ins = db.prepare(`INSERT INTO sales_logs (product_id,sku,change_type,delta,stock_before,stock_after,note,operator)
                            VALUES (?,?,?,?,?,?,?,?)`);
    ins.run(2, 'A0002', -1, -8, 85, 77, 'test sale', 'tester');
    ins.run(4, 'B0001', -1, -5, 30, 25, 'test sale', 'tester');
    console.log(`${f.slice(0, 12)}… sales logs inserted`);
  }

  // ③ 写入好评 JSON 配置
  db.prepare(`INSERT INTO system_settings (skey,sval,note) VALUES (?,?,?)
              ON CONFLICT(skey) DO UPDATE SET sval=excluded.sval`)
    .run('reviews_json', JSON.stringify([
      { name: 'María G.', stars: 5, text_es: 'Muy lindo, llegó rápido y bien empacado', text_zh: '很可爱，发货快包装好' },
      { name: 'Carlos', stars: 5, text_es: 'Excelente calidad, volveré a comprar', text_zh: '质量超好，还会回购' },
    ], null, 0), 'test seed');

  console.log(`${f.slice(0, 12)}… seeded`);
  db.close();
}
console.log('all done');
