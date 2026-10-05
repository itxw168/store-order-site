/**
 * Haven Shop · Pages Functions 全局中间件
 *
 * Pages Functions 约定：functions/_middleware.js 会在【所有路由请求之前】执行
 * 在这里统一做三件事：
 *   1. CORS 头注入 + OPTIONS 预检快速响应
 *   2. 对 /api/admin/*（除 /api/admin/login）做管理员 Token 鉴权
 *   3. 全局 try/catch，把所有未处理异常变成统一 JSON 错误（而不是 Cloudflare 默认 HTML 500 页）
 */
import {
  jsonErr,
  preflight,
  extractBearerToken,
  verifyAdminToken,
} from './_utils.js';

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // ------------------------------------------------------------------
  // 1) CORS 预检：所有 OPTIONS 直接 204
  // ------------------------------------------------------------------
  if (request.method === 'OPTIONS') return preflight();

  // ------------------------------------------------------------------
  // 2) 管理员鉴权：路径以 /api/admin 开头，且排除 /api/admin/login
  // ------------------------------------------------------------------
  const isAdminApi = path.startsWith('/api/admin/') || path === '/api/admin';
  const isAdminLogin = path === '/api/admin/login';
  if (isAdminApi && !isAdminLogin) {
    const passwordSecret = env.ADMIN_PASSWORD || '';
    if (!passwordSecret) {
      return jsonErr('服务器未配置管理员密码（ADMIN_PASSWORD 环境变量缺失）', 500, 9101);
    }
    const token = extractBearerToken(request);
    if (!token) {
      return jsonErr('未登录：请先登录后台', 401, 4011);
    }
    // 签名密钥：优先 ADMIN_TOKEN_SECRET（可选 Secret），未设置则回退用 ADMIN_PASSWORD
    const signSecret = env.ADMIN_TOKEN_SECRET || passwordSecret;
    const check = await verifyAdminToken(token, signSecret);
    if (!check.valid) {
      const reason = check.reason === 'expired' ? '登录已过期，请重新登录' : '登录凭证无效';
      return jsonErr(reason, 401, 4012);
    }
  }

  // ------------------------------------------------------------------
  // 3) 全局异常捕获：未处理错误 → 统一 JSON 错误（附错误堆栈只有在环境非 production 或调试时保留？不，不暴露堆栈给前端安全）
  // ------------------------------------------------------------------
  try {
    const resp = await next();
    // 保险：如果下游 handler 没带 CORS 头，这里补一次（不覆盖已有的）
    const newResp = new Response(resp.body, resp);
    if (!newResp.headers.has('Access-Control-Allow-Origin')) {
      newResp.headers.set('Access-Control-Allow-Origin', '*');
    }
    if (!newResp.headers.has('Content-Type')) {
      // 下游没设 content-type，默认 application/json
      newResp.headers.set('Content-Type', 'application/json; charset=utf-8');
    }
    return newResp;
  } catch (err) {
    console.error('[HAVEN-SHOP] Uncaught error on path', path, err && err.stack ? err.stack : err);
    return jsonErr(
      // 不要把 err.message 原文暴露给前端（可能包含堆栈/数据库报错敏感信息）
      '服务器内部错误，请稍后重试。如果持续发生请联系管理员。',
      500,
      5000
    );
  }
}
