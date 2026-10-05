/**
 * POST /api/admin/upload-sign  · 生成 R2 预签名 URL（前端浏览器直传图片到 R2）
 *
 * 为什么用「预签名 URL 直传」而不是 API 再转发二进制？
 *   - 转发大文件会占用 Functions 10MB Body 限制，而且冷启动慢
 *   - 直传：前端 → PUT 到 R2 预签名 URL（最大 5GB，速度快不走 Functions）
 *   - 后端只管签发「允许上传哪个 key、有效期多久」，文件实际存储直接落地 R2
 *
 * Body:
 *   filename:  "abc.jpg"（原文件名，用来取扩展名）
 *   sku:       "A0001"（可选，用于生成规范化 key，不传则用 uploads/{ts}）
 *   expiresIn: 600（可选，秒，默认 600 = 10 分钟有效）
 *   sizeHint:  可选，暂不做严格校验，前端自己知道多大
 *
 * Response:
 *   { ok: true, data: { key, uploadUrl, contentType, expiresIn, publicUrl } }
 *     key        → 前端成功 PUT 后需要把这个 key 写回 product.image_key / gallery_keys
 *     uploadUrl  → 前端直接 PUT（Body=File Blob）到这个 URL，成功就是上传完成
 *     publicUrl  → 预拼好的公网访问 URL，前端可以立刻预览
 */
import { jsonOk, jsonErr, readJSON, makeProductImageKey } from '../../_utils.js';

// 允许的 MIME 类型 + 扩展名 → 对应 Content-Type
const ALLOWED = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.avif': 'image/avif',
};

function getExt(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? '.' + m[1] : '';
}

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.BUCKET) return jsonErr('R2 存储桶未绑定（env.BUCKET 缺失）', 500, 9401);

  const body = await readJSON(context.request);
  if (!body || !body.filename) return jsonErr('缺少参数 filename（原文件名，带扩展名）', 400, 6001);

  const ext = getExt(body.filename);
  if (!ALLOWED[ext]) {
    return jsonErr(
      `不支持的文件类型「${ext}」。仅允许：${Object.keys(ALLOWED).join('、')}`,
      400,
      6002
    );
  }
  const contentType = ALLOWED[ext];
  const sku = String(body.sku || '').trim();
  const expiresIn = Math.min(24 * 3600, Math.max(60, Number(body.expiresIn) || 600));
  const key = makeProductImageKey(sku || `upload-${Date.now().toString(36)}`, ext);
  const prefix = (env.R2_PUBLIC_PREFIX || '').replace(/\/+$/, '');
  const publicUrl = prefix ? `${prefix}/${key}` : '';

  // ============ 方案 A：优先 R2 createSignedUrl 直传（浏览器→R2，省带宽、不限大小） ============
  if (typeof env.BUCKET.createSignedUrl === 'function') {
    try {
      const uploadUrl = await env.BUCKET.createSignedUrl('PUT', key, {
        expiresIn,
        contentType,
      });
      return jsonOk({
        mode: 'direct',
        key,
        uploadUrl,
        contentType,
        expiresIn,
        publicUrl,
        hint: '前端拿到 uploadUrl 之后：axios/fetch 直接 PUT(File blob) 到 uploadUrl，body 就是文件本身，不要加 JSON 包装；成功 200/204 就是传到 R2 了，然后把 key 回传给商品保存接口的 image_key / gallery_keys 字段即可',
      });
    } catch (err) {
      console.warn('[UPLOAD-SIGN] createSignedUrl 失败，回退到中转上传模式：', err && err.message);
      // 继续走到 fallback
    }
  }

  // ============ 方案 B：Fallback — Pages Functions createSignedUrl 不存在时，后端中转上传 ============
  // Pages Functions 的 R2 binding 可能没暴露 createSignedUrl（兼容性差异）
  // 这里返回中转上传地址：PUT /api/admin/upload/{key}，body 直接是二进制 File，Content-Type 就是 contentType
  return jsonOk({
    mode: 'proxy',
    key,
    uploadUrl: `/api/admin/upload/${encodeURIComponent(key)}`,
    contentType,
    expiresIn,
    publicUrl,
    hint: '中转上传模式：fetch(`/api/admin/upload/${key}`, { method: "PUT", headers:{ "Content-Type": contentType, "Authorization": "Bearer <adminToken>" }, body: fileBlob })。成功后把 key 回传给商品的 image_key / gallery_keys 保存。注：中转模式受 Functions 10MB Body 限制，只适合小图；如果需要大图，请在 Cloudflare 后台升级 compatibility_date 并确认 R2 启用 createSignedUrl。',
  });
}
