/**
 * POST /api/admin/login  · 管理员登录
 * Body { password: "明文密码" }
 * → 成功 { ok: true, data: { token, expiresAtSec } }
 * → 失败 { ok: false, error: "...", code: 4010 }
 */
import { jsonOk, jsonErr, readJSON, timingSafeEqual, issueAdminToken, b64urlDecodeString } from '../../_utils.js';

export async function onRequestPost(context) {
  const { env } = context;
  const EXPECTED = env.ADMIN_PASSWORD || '';
  if (!EXPECTED) {
    return jsonErr('服务器未配置管理员密码（ADMIN_PASSWORD 环境变量缺失）', 500, 9102);
  }

  const body = await readJSON(context.request);
  if (!body || typeof body.password !== 'string') {
    return jsonErr('缺少参数 password', 400, 4001);
  }
  const provided = body.password;

  // 时序安全比较，避免暴力枚举时通过响应时间猜密码长度
  const match = timingSafeEqual(provided, EXPECTED);
  // Pages Functions 环境无 SharedArrayBuffer/Atomics.wait，固定非阻塞 sleep 近似防时序攻击
  await new Promise(r => setTimeout(r, 180));
  if (!match) {
    return jsonErr('密码错误，请重试', 401, 4010);
  }

  // 签发 7 天有效 Token（签名密钥：优先 ADMIN_TOKEN_SECRET，未设置则回退 ADMIN_PASSWORD）
  const signSecret = env.ADMIN_TOKEN_SECRET || EXPECTED;
  const token = await issueAdminToken(signSecret, 7 * 24);
  const parts = token.split('.');
  let expiresAtSec = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  if (parts.length === 3) {
    const payloadStr = b64urlDecodeString(parts[1]);
    if (payloadStr) {
      try { expiresAtSec = JSON.parse(payloadStr).exp || expiresAtSec; } catch (e) { /* ignore */ }
    }
  }
  return jsonOk({
    token,
    expiresAtSec,
    issuedAtMs:   Date.now(),
    expiresAtStr: new Date(expiresAtSec * 1000).toISOString(),
  }, '登录成功，欢迎回到 Haven Shop 管理后台 ✨');
}
