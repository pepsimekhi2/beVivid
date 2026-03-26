const crypto = require('crypto');

const ADMIN_COOKIE_NAME = 'bevivid_admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const DEFAULT_ADMIN_PASSWORD_HASH = '2d2370db2447ff8cf4f3accd68c85aa119a9c893effd200a9b69176e9fc5eb98';

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  return raw.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function getPasswordHash() {
  if (process.env.ADMIN_DASH_PASSWORD_HASH) {
    return String(process.env.ADMIN_DASH_PASSWORD_HASH).trim().toLowerCase();
  }
  if (process.env.ADMIN_DASH_PASSWORD) {
    return crypto.createHash('sha256').update(String(process.env.ADMIN_DASH_PASSWORD)).digest('hex');
  }
  return DEFAULT_ADMIN_PASSWORD_HASH;
}

function getSessionSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_DASH_PASSWORD_HASH || process.env.ADMIN_DASH_PASSWORD || 'bevivid-admin-secret');
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function getCookieFlags(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const secure = forwardedProto === 'https' || Boolean(process.env.VERCEL);
  return `${secure ? '; Secure' : ''}; HttpOnly; SameSite=Strict; Path=/`;
}

function verifyToken(token) {
  if (!token || !String(token).includes('.')) return null;
  const [encoded, signature] = String(token).split('.');
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  if (!safeCompare(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || Number(payload.exp || 0) < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function setAdminSession(req, res) {
  const now = Date.now();
  const token = signPayload({
    role: 'owner',
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS * 1000
  });
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_MAX_AGE_SECONDS}${getCookieFlags(req)}`
  );
}

function clearAdminSession(req, res) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=; Max-Age=0${getCookieFlags(req)}`
  );
}

function isAdminAuthorized(req) {
  const cookies = parseCookies(req);
  return Boolean(verifyToken(cookies[ADMIN_COOKIE_NAME]));
}

function requireAdmin(req, res) {
  if (!isAdminAuthorized(req)) {
    res.status(401).json({ error: 'Admin session required.' });
    return false;
  }
  return true;
}

module.exports = {
  ADMIN_COOKIE_NAME,
  clearAdminSession,
  getPasswordHash,
  isAdminAuthorized,
  requireAdmin,
  safeCompare,
  setAdminSession
};
