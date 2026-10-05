/**
 * PUT  /api/admin/upload/:key  · 中转上传：Functions 接收浏览器二进制 → 写入 env.BUCKET
 * DELETE /api/admin/upload/:key · 删除 R2 里的一张图（管理端调用）
 *
 * ⚠️ 中转上传只适合 ≤ ~8MB 图片，受 Pages Functions Body 限制（默认 10MB，留余量）
 *    大图片推荐走 createSignedUrl 预签名直传（upload-sign 返回 mode=direct 时）
 *
 * 鉴权：_middleware.js 已对 /api/admin/* 要求 Bearer Admin Token，此处无需重复校验。
 */
import { jsonOk, jsonErr } from '../../../_utils.js';

// 允许的图片 MIME 类型（与 upload-sign.js 保持一致，避免中转上传绕过类型限制）
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export async function onRequestPut(context) {
  const { env, request, params } = context;
  const key = decodeURIComponent(String(params?.key || '')).replace(/^\/+/, '');
  if (!key) return jsonErr('缺少路径参数 key（R2 对象键）', 400, 6101);
  if (!env.BUCKET) return jsonErr('R2 存储桶未绑定（env.BUCKET 缺失）', 500, 9402);

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!contentType || !ALLOWED_MIME.has(contentType)) {
    return jsonErr(`不支持的 Content-Type「${contentType || '空'}」。仅允许 jpg/png/webp/gif/avif`, 400, 6102);
  }
  const clHeader = request.headers.get('Content-Length');
  const contentLength = clHeader ? Number(clHeader) : NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return jsonErr(`文件过大：${contentLength} 字节 > 限制 ${MAX_BYTES} 字节（约 8MB）`, 413, 6103);
  }

  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) {
      return jsonErr(`文件过大：${body.byteLength} 字节 > 限制 ${MAX_BYTES} 字节（约 8MB）`, 413, 6104);
    }
    const httpMetadata = { contentType };
    // 可选：加 Cache-Control，公开访问图片可以长缓存
    const cacheable = /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(key);
    if (cacheable) httpMetadata.cacheControl = 'public, max-age=31536000, immutable';

    await env.BUCKET.put(key, body, { httpMetadata });

    const prefix = (env.R2_PUBLIC_PREFIX || '').replace(/\/+$/, '');
    const publicUrl = prefix ? `${prefix}/${key}` : '';
    return jsonOk({
      key,
      bytes: body.byteLength,
      contentType,
      publicUrl,
      ok: true,
    }, '上传成功 ✅');
  } catch (err) {
    console.error('[UPLOAD] R2 put error:', err && err.stack ? err.stack : err);
    return jsonErr('写入 R2 失败：' + (err?.message || String(err)), 500, 6105);
  }
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const key = decodeURIComponent(String(params?.key || '')).replace(/^\/+/, '');
  if (!key) return jsonErr('缺少路径参数 key（R2 对象键）', 400, 6111);
  if (!env.BUCKET) return jsonErr('R2 存储桶未绑定（env.BUCKET 缺失）', 500, 9403);
  try {
    await env.BUCKET.delete(key);
    return jsonOk({ deletedKey: key }, '已删除');
  } catch (err) {
    console.error('[UPLOAD-DELETE] error:', err && err.stack ? err.stack : err);
    return jsonErr('删除 R2 失败：' + (err?.message || String(err)), 500, 6112);
  }
}
