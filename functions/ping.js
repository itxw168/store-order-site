/**
 * GET /ping  · 快速检查绑定状态
 * 部署完立刻访问：https://你的项目.pages.dev/ping
 * 用来确认 env.DB / env.BUCKET / env.R2_PUBLIC_PREFIX / env.ADMIN_PASSWORD 四个绑定全部正确注入
 */
import { jsonOk } from './_utils.js';

export async function onRequest(context) {
  const { env } = context;
  const checks = {
    dbBound:     !!env.DB,
    bucketBound: !!env.BUCKET,
    r2Prefix:    (env.R2_PUBLIC_PREFIX || '').trim(),
    hasAdminPwd: !!env.ADMIN_PASSWORD,
    timezone:    env.TZ || 'UTC',
    nodeVersion: 'Pages Functions V8 隔离环境',
  };
  // 如果 D1 绑定了，顺手 ping 一下（不会返回实际数据，只是验证连接是否 OK）
  let d1PingOk = false;
  if (checks.dbBound) {
    try {
      const r = await env.DB.prepare('SELECT 1 + 1 AS ok').first();
      d1PingOk = r && r.ok === 2;
    } catch (e) { /* ignore */ }
  }
  return jsonOk({
    service: 'Haven Shop Admin Backend · Running ✅',
    timestamp: Date.now(),
    checks,
    d1Query: checks.dbBound ? (d1PingOk ? '✅ D1 可读写' : '❌ D1 绑定存在但查询失败（可能未跑迁移）') : '⚠️ D1 未绑定（env.DB 缺失）',
    tips: [
      '如果 dbBound=false 或 bucketBound=false：检查 Pages 项目设置 → Bindings 里变量名必须是严格大写 DB / BUCKET',
      '如果 r2Prefix 为空：添加环境变量 R2_PUBLIC_PREFIX（例如 https://img.example.com，结尾不要斜杠）',
      '如果 hasAdminPwd=false：添加 Secret 变量 ADMIN_PASSWORD（加密存管理员密码）',
      'd1Query 提示未跑迁移：执行 wrangler d1 migrations apply haven-db --remote',
    ],
  });
}
