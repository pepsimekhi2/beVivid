const crypto = require('crypto');
const {
  clearAdminSession,
  getPasswordHash,
  isAdminAuthorized,
  safeCompare,
  setAdminSession
} = require('./_adminAuth');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ authenticated: isAdminAuthorized(req) });
    return;
  }

  if (req.method === 'DELETE') {
    clearAdminSession(req, res);
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const expectedHash = getPasswordHash();

  const password = String((req.body && req.body.password) || '');
  if (!password) {
    res.status(400).json({ error: 'Password is required.' });
    return;
  }

  const candidateHash = crypto.createHash('sha256').update(password).digest('hex');
  if (!safeCompare(candidateHash, expectedHash)) {
    res.status(401).json({ error: 'That password is not valid.' });
    return;
  }

  setAdminSession(req, res);
  res.status(200).json({ ok: true });
};
