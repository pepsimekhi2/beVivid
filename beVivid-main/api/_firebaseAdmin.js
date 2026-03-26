const DEFAULT_FIREBASE_DB_URL = 'https://bevivid-73a69-default-rtdb.firebaseio.com';

function getBaseUrl() {
  return String(process.env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL).replace(/\/+$/, '');
}

function normalizePath(path) {
  return String(path || '').replace(/^\/+/, '').replace(/\.json$/, '');
}

function buildUrl(path) {
  const url = `${getBaseUrl()}/${normalizePath(path)}.json`;
  const auth = String(process.env.FIREBASE_ADMIN_AUTH || '').trim();
  if (!auth) return url;
  return `${url}?auth=${encodeURIComponent(auth)}`;
}

async function request(path, options = {}) {
  const response = await fetch(buildUrl(path), options);
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || `Firebase request failed for ${path}.`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function get(path) {
  return request(path);
}

function put(path, payload) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload === undefined ? null : payload)
  });
}

function patch(path, payload) {
  return request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload === undefined ? null : payload)
  });
}

function del(path) {
  return request(path, { method: 'DELETE' });
}

module.exports = {
  buildUrl,
  del,
  get,
  patch,
  put
};
