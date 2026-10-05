import fs from 'node:fs';
import { parse } from 'acorn';

const files = ['index.html', 'admin/index.html'];

let fail = false;
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  // 抽取所有 <script>（无 src 属性）内联块
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, idx = 0;
  while ((m = re.exec(html)) !== null) {
    idx++;
    try {
      parse(m[1], { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
      console.log(`OK   ${f} #inline-${idx} (${m[1].length} chars)`);
    } catch (e) {
      fail = true;
      console.error(`FAIL ${f} #inline-${idx}: ${e.message}`);
      // 定位出错行
      const before = m[1].slice(0, e.pos);
      const line = before.split('\n').length;
      console.error(`     at inline script line ${line}`);
    }
  }
}
process.exit(fail ? 1 : 0);
