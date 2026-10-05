/**
 * Haven Shop · Functions 通用工具库
 * 所有 API 都 import 这里的方法，保持响应结构完全一致
 * （Pages Functions 约定：文件名以 _ 开头的不会暴露成路由，纯工具模块）
 */

// ================================================================
// 一、统一 HTTP 响应构造器（所有接口必须走 jsonOk / jsonErr 输出）
// ================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Requested-With',
  'Access-Control-Max-Age':       '86400',
  'Content-Type':                 'application/json; charset=utf-8',
  'X-Content-Type-Options':       'nosniff',
  'Cache-Control':                'no-store, max-age=0',
};

/**
 * 成功响应（所有 API 成功时用这个）
 * 统一结构：{ ok: true,  data: any, message?: string }
 */
export function jsonOk(data, message = '', status = 200) {
  const body = { ok: true, data, message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS },
  });
}

/**
 * 失败响应（所有 API 出错时用这个）
 * 统一结构：{ ok: false, error: string, code?: number }
 */
export function jsonErr(error, status = 400, code) {
  const body = {
    ok: false,
    error: typeof error === 'string' ? error : (error?.message ?? '未知错误'),
    ...(code !== undefined ? { code } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS },
  });
}

/** 预检 OPTIONS 快速 204 响应 */
export function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Content-Length': '0',
    },
  });
}

// ================================================================
// 二、请求解析工具
// ================================================================

/** 读取请求的 JSON body，解析失败返回 null（不 throw，外层直接判断） */
export async function readJSON(req) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    const raw = await req.text();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** 从 URLSearchParams 安全取值 */
export function getQuery(url, key, def = '') {
  try {
    const u = new URL(url);
    const v = u.searchParams.get(key);
    return (v === null || v === undefined) ? def : v;
  } catch (e) {
    return def;
  }
}

// ================================================================
// 三、安全：时序不变字符串比较（防止密码/Token 时序攻击）
// 来源：Cloudflare 官方推荐实现
// ================================================================
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

// ================================================================
// 四、管理员鉴权：无状态 Token（JWT-lite，HMAC-SHA256，不依赖数据库/额外依赖）
// Token 格式：b64(header).b64(payload).b64(sig)
//   payload: { exp: 过期时间戳（秒） }
//   sig:     HMAC-SHA256("b64(h).b64(p)", secretBase)
// 为什么不用 jsonwebtoken？因为 Pages Functions 不装 npm 包最稳，纯 WebCrypto 零依赖。
//
// 关于 Base64：Cloudflare Workers Runtime **没有** btoa/atob 全局函数，
// 尽管已启用 nodejs_compat，但它只提供 Node Buffer，不提供浏览器的 btoa/atob。
// 所以这里统一用 Buffer 做 base64url 编解码（nodejs_compat 已在 wrangler.toml 声明）。
// ================================================================

/** 纯 JS Base64 编码字符表 */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 任意 Uint8Array / ArrayBuffer → 标准 base64 字符串（纯 JS 实现，无依赖） */
function u8ToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const len = u8.length;
  let out = '';
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out += B64_CHARS[(v >> 18) & 0x3f];
    out += B64_CHARS[(v >> 12) & 0x3f];
    out += B64_CHARS[(v >> 6) & 0x3f];
    out += B64_CHARS[v & 0x3f];
  }
  if (i < len) {
    const leftover = len - i; // 1 or 2
    const v = leftover === 2 ? (u8[i] << 16) | (u8[i + 1] << 8) : u8[i] << 16;
    out += B64_CHARS[(v >> 18) & 0x3f];
    out += B64_CHARS[(v >> 12) & 0x3f];
    out += leftover === 2 ? B64_CHARS[(v >> 6) & 0x3f] : '=';
    out += '=';
  }
  return out;
}

/** 标准 base64 字符串 → Uint8Array（纯 JS 实现，无依赖），失败返回 null */
function base64ToU8(s) {
  try {
    if (!s || typeof s !== 'string') return null;
    // 清理：去空格、去 = padding、转标准符号
    const clean = s.replace(/\s+/g, '').replace(/=+$/, '');
    const n = clean.length;
    // 字符表反查（ASCII range 0-127 放数组直接查）
    const table = new Uint8Array(128);
    for (let k = 0; k < 64; k++) table[B64_CHARS.charCodeAt(k)] = k;
    let pad = (4 - (n % 4)) % 4;
    const groups = Math.floor((n + pad) / 4);
    const out = new Uint8Array(groups * 3 - pad);
    let w = 0, acc = 0, bits = 0, p = 0;
    for (let i = 0; i < n; i++) {
      const code = clean.charCodeAt(i);
      if (code >= 128) return null;
      const val = table[code];
      // 字符不在 base64 表里，跳过非法
      if (val === undefined && !(clean[i] === '=')) continue;
      if (clean[i] === '=') continue;
      acc = (acc << 6) | val;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[w++] = (acc >> bits) & 0xff;
      }
    }
    return out.subarray(0, w);
  } catch (e) {
    return null;
  }
}

/** 任意 Uint8Array / ArrayBuffer → base64url 字符串 */
function b64urlEncodeFromBytes(bytes) {
  return u8ToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** base64url 字符串 → Uint8Array，失败返回 null */
function b64urlDecodeToBytes(s) {
  if (!s || typeof s !== 'string') return null;
  const standard = s.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToU8(standard);
}

// 兼容命名：旧代码仍用 b64urlEncode / b64urlDecode 这两个名字
const b64urlEncode = b64urlEncodeFromBytes;
const b64urlDecode = b64urlDecodeToBytes;

/** 纯字符串 → base64url 字符串（给 login.js 解 token 第二段 payload 用） */
export function b64urlDecodeString(s) {
  try {
    const u8 = b64urlDecodeToBytes(s);
    if (!u8) return null;
    return new TextDecoder().decode(u8);
  } catch (e) {
    return null;
  }
}

const enc = new TextEncoder();

async function hmacSign(message, secretStr) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secretStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return b64urlEncode(sig);
}

async function hmacVerify(message, signatureB64u, secretStr) {
  const expected = await hmacSign(message, secretStr);
  return timingSafeEqual(expected, signatureB64u);
}

/** 生成管理员 Token（有效期 hours 小时，默认 7 天） */
export async function issueAdminToken(adminPasswordSecret, hours = 7 * 24) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const header = { alg: 'HS256', typ: 'HavenShopAdmin' };
  const payload = { exp };
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSign(`${h}.${p}`, adminPasswordSecret);
  return `${h}.${p}.${sig}`;
}

/** 校验管理员 Token（通过则返回 { valid, exp }，失败返回 { valid:false }） */
export async function verifyAdminToken(tokenStr, adminPasswordSecret) {
  try {
    if (!tokenStr || typeof tokenStr !== 'string') return { valid: false };
    const parts = tokenStr.split('.');
    if (parts.length !== 3) return { valid: false };
    const [h64, p64, s64] = parts;
    const ok = await hmacVerify(`${h64}.${p64}`, s64, adminPasswordSecret);
    if (!ok) return { valid: false };
    const pBytes = b64urlDecode(p64);
    if (!pBytes) return { valid: false };
    const payload = JSON.parse(new TextDecoder().decode(pBytes));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: 'expired' };
    }
    return { valid: true, exp: payload.exp };
  } catch (e) {
    return { valid: false };
  }
}

/** 从 request 里取 Authorization: Bearer xxx 中的 token，没传返回空串 */
export function extractBearerToken(req) {
  try {
    const h = req.headers.get('authorization') || '';
    const [typ, val] = h.trim().split(/\s+/);
    if (typ && typ.toLowerCase() === 'bearer' && val) return val;
    return '';
  } catch (e) { return ''; }
}

// ================================================================
// 五、图片工具：R2 public 前缀拼 key 成 URL（key 可能有前导 / 或空）
// ================================================================
export function buildPublicImgUrl(publicPrefix, key) {
  if (!key || typeof key !== 'string') return '';
  const cleanKey = key.replace(/^\/+/, '');
  if (!cleanKey) return '';
  const pre = (publicPrefix || '').replace(/\/+$/, '');
  return `${pre}/${cleanKey}`;
}

/** 生成商品主图在 R2 里存的 key（规范目录名，避免乱塞到根目录） */
export function makeProductImageKey(sku, ext = '.jpg') {
  const ts = Date.now().toString(36);
  const safeSku = (sku || 'no-sku').replace(/[^\w-]/g, '_').slice(0, 40);
  return `products/${safeSku}-${ts}${ext}`;
}

// ================================================================
// 六、唯一标识生成 + 冲突重试（D1 UNIQUE 约束已在 001_init.sql 中定义）
// ================================================================
/** 对任意文本生成 slug 缩写（去除西语重音，非字母数字变-）；中文 fallback 短随机 */
export function slugifyAny(text) {
  if (!text) return '';
  const s = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (s) return s;
  return Math.random().toString(36).slice(2, 10);
}
const RAND_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randChars(n) {
  let o = '';
  for (let i = 0; i < n; i++) o += RAND_CHARS.charAt(Math.floor(Math.random() * RAND_CHARS.length));
  return o;
}

/**
 * 数字 → Excel 风格字母编码（A/B/C...Z/AA/AB...AZ/BA...）
 * 0  → A      （第 1 个分类）
 * 1  → B
 * 25 → Z
 * 26 → AA     （第 27 个分类，单字母用完后进入双字母）
 * 27 → AB
 * 52 → BA
 * 702 → AAA   （第 703 个，理论极限，足够用）
 */
export function numberToLetterCode(n) {
  if (!Number.isFinite(n) || n < 0) n = 0;
  let result = '';
  let x = n + 1; // 算法要求 1-indexed
  while (x > 0) {
    x--;
    result = String.fromCharCode(65 + (x % 26)) + result;
    x = Math.floor(x / 26);
  }
  return result;
}

/**
 * 生成顺序分类编码：A/B/C...Z/AA/AB...
 * @param {number} existingCount 现有分类数量（用于推算下一个字母）
 * @returns {string} 字母编码（大写）
 */
export function generateSequentialCategoryCode(existingCount = 0) {
  return numberToLetterCode(Math.max(0, Math.floor(existingCount)));
}

/**
 * 生成顺序商品 SKU：分类字母 + 顺序数字，总长 ≤ 5，无分隔符
 *   字母 1 位（A-Z）  → 数字 4 位：A0001 ~ A9999（每分类上限 9999 件）
 *   字母 2 位（AA-AZ）→ 数字 3 位：AA001 ~ AA999
 *   字母 3 位（AAA+） → 数字 2 位：AAA01 ~ AAA99
 * @param {string} categoryCode 分类编码（如 'A' / 'AA'）
 * @param {number} nextNum 该分类下下一个顺序号（从 1 开始）
 * @returns {string} 5 位以内的 SKU（如 'A1034'）
 */
export function generateSequentialProductSku(categoryCode, nextNum = 1) {
  const prefix = String(categoryCode || 'A')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')      // 仅保留大写字母
    .slice(0, 3) || 'A';
  const prefixLen = prefix.length;
  // 总长 ≤ 5：字母位数决定数字位数
  const numLen = Math.max(1, 5 - prefixLen);
  const n = Math.max(1, Math.floor(nextNum) || 1);
  const numStr = String(n).padStart(numLen, '0').slice(0, numLen);
  return (prefix + numStr).slice(0, 5);
}

/** 生成分类 code（旧版兼容：slug 前缀 + 2 位小写短随机，新代码改用 generateSequentialCategoryCode） */
export function generateCategoryCode(prefixText) {
  const prefix = slugifyAny(prefixText);
  if (prefix) return (prefix + '-' + randChars(2).toLowerCase()).slice(0, 32);
  return 'cat-' + randChars(6).toLowerCase();
}
/** 生成商品 SKU（旧版兼容：[分类code大写]-[YYMMDD]-[4位随机]，新代码改用 generateSequentialProductSku） */
export function generateProductSku(categoryCode, ymd) {
  const cc = String(categoryCode || 'HS').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'HS';
  const d = ymd || (() => {
    const x = new Date();
    const p = n => String(n).padStart(2, '0');
    return p(x.getFullYear() % 100) + p(x.getMonth() + 1) + p(x.getDate());
  })();
  return `${cc}-${d}-${randChars(4)}`;
}
/**
 * 执行 SQL DML，并在 UNIQUE 冲突时调用 mutate 变体函数自动重试（最多 maxTries 次）。
 * D1 UNIQUE 冲突错误关键字：SQLITE_CONSTRAINT_UNIQUE / UNIQUE constraint failed
 * 注：mutatePayload 支持同步或异步函数（async）；异步时会自动 await
 */
export async function execWithRetryOnUnique(runStmtFn, mutatePayload, payload0, maxTries = 8) {
  let payload = payload0;
  let lastErr = null;
  for (let i = 0; i < maxTries; i++) {
    try {
      return { ok: true, result: await runStmtFn(payload), payload };
    } catch (e) {
      lastErr = e;
      const msg = (e && e.message) ? e.message : String(e || '');
      const isUnique = /SQLITE_CONSTRAINT_UNIQUE/i.test(msg) || /UNIQUE constraint failed/i.test(msg);
      if (!isUnique) return { ok: false, error: e, payload };
      const next = mutatePayload(payload, i + 1);
      payload = (next && typeof next.then === 'function') ? await next : next;
    }
  }
  return { ok: false, error: lastErr, payload };
}
