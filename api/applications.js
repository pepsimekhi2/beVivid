const { put } = require('./_firebaseAdmin');

const DEFAULT_BREVO_FORM_URL = 'https://cd7a2b82.sibforms.com/serve/MUIFAGgwe4qV-IxqspEyp3ljcxbiCrqT6KWUEv4FaZNKGdHzsP0jypvUup0xJk_qs857A1tlNt_cBCWcUzlZLoMxOGeu3UQp2ALppEqTSLSa7DWfc1FM_CFHy_-mfh2FZZUPwpA2NoCzbUX9v63NFB6Mf4-28K7Yp1rh_UgJuzlLJLtaIu5GtvKF20DuQ_0thprANV1qmNbphP4uBw==';
const DEFAULT_RECAPTCHA_SITE_KEY = '6LfyVJUsAAAAAFZ7eNAF8r2b58PUyZ_2hW56gKHh';

async function verifyEnterpriseCaptcha(token, expectedAction) {
  const apiKey = process.env.RECAPTCHA_ENTERPRISE_API_KEY;
  const projectId = process.env.RECAPTCHA_ENTERPRISE_PROJECT_ID;
  const siteKey = process.env.RECAPTCHA_ENTERPRISE_SITE_KEY || DEFAULT_RECAPTCHA_SITE_KEY;
  const minimumScore = Number(process.env.RECAPTCHA_ENTERPRISE_MIN_SCORE || 0.3);

  if (!apiKey || !projectId) {
    return null;
  }

  if (!token) {
    return { ok: false, error: 'Security verification was missing. Please try again.' };
  }

  const response = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/assessments?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: {
        token,
        siteKey,
        expectedAction: expectedAction || undefined
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  const tokenProperties = data && data.tokenProperties ? data.tokenProperties : {};
  const riskAnalysis = data && data.riskAnalysis ? data.riskAnalysis : {};
  const score = Number(riskAnalysis.score);

  if (!response.ok || tokenProperties.valid !== true) {
    return { ok: false, error: 'reCAPTCHA verification failed. Please try again.' };
  }

  if (expectedAction && tokenProperties.action && tokenProperties.action !== expectedAction) {
    return { ok: false, error: 'reCAPTCHA action mismatch. Please try again.' };
  }

  if (Number.isFinite(score) && score < minimumScore) {
    return { ok: false, error: 'reCAPTCHA flagged this application. Please try again.' };
  }

  return { ok: true };
}

async function verifyCaptcha(token, remoteIp, expectedAction) {
  const enterpriseResult = await verifyEnterpriseCaptcha(token, expectedAction);
  if (enterpriseResult) {
    return enterpriseResult;
  }

  const secret = process.env.RECAPTCHA_SECRET_KEY;

  if (!secret) {
    return { ok: true, skipped: true };
  }

  if (!token) {
    return { ok: false, error: 'Please complete the reCAPTCHA before submitting.' };
  }

  const body = new URLSearchParams({
    secret,
    response: token
  });

  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await response.json();
  if (!data.success) {
    return { ok: false, error: 'reCAPTCHA verification failed. Please try again.' };
  }

  return { ok: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const {
      type,
      firstName,
      lastName,
      email,
      phone,
      why,
      optIn,
      captchaToken,
      captchaAction
    } = req.body || {};

    if (!firstName || !email || !why) {
      res.status(400).json({ error: 'Please fill out the required application fields.' });
      return;
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
    if (!emailOk) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    if (!optIn) {
      res.status(400).json({ error: 'Please accept the opt-in before submitting.' });
      return;
    }

    const captchaCheck = await verifyCaptcha(
      captchaToken,
      req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      captchaAction
    );
    if (!captchaCheck.ok) {
      res.status(400).json({ error: captchaCheck.error });
      return;
    }

    const digits = String(phone || '').replace(/\D/g, '');
    const smsValue = digits.length === 10 ? `1${digits}` : digits;
    const formBody = new URLSearchParams({
      FIRSTNAME: String(firstName),
      LASTNAME: String(lastName || ''),
      EMAIL: String(email),
      SMS__COUNTRY_CODE: '+1',
      SMS: smsValue,
      JOB_TITLE: `[${String(type || 'application').toUpperCase()}] ${String(why)}`,
      OPT_IN: '1',
      email_address_check: '',
      locale: 'en'
    });

    const response = await fetch(process.env.BREVO_APPLICATION_FORM_URL || DEFAULT_BREVO_FORM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody
    });

    if (!response.ok) {
      res.status(502).json({ error: 'Brevo did not accept the application form.' });
      return;
    }

    try {
      const id = `application_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await put(`adminData/applications/${id}`, {
        id,
        type: String(type || 'application'),
        firstName: String(firstName),
        lastName: String(lastName || ''),
        email: String(email),
        phone: String(phone || ''),
        why: String(why),
        status: 'submitted',
        createdAt: Date.now()
      });
    } catch (_) {}

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Application submission failed. Please try again.' });
  }
};
