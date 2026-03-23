const DEFAULT_BREVO_FORM_URL = 'https://cd7a2b82.sibforms.com/serve/MUIFAGgwe4qV-IxqspEyp3ljcxbiCrqT6KWUEv4FaZNKGdHzsP0jypvUup0xJk_qs857A1tlNt_cBCWcUzlZLoMxOGeu3UQp2ALppEqTSLSa7DWfc1FM_CFHy_-mfh2FZZUPwpA2NoCzbUX9v63NFB6Mf4-28K7Yp1rh_UgJuzlLJLtaIu5GtvKF20DuQ_0thprANV1qmNbphP4uBw==';

async function verifyCaptcha(token, remoteIp) {
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
      captchaToken
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
      req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
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

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Application submission failed. Please try again.' });
  }
};
