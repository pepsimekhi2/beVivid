const DEFAULT_SUPABASE_URL = 'https://tpodkhgabmxqpcnasmat.supabase.co';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const { displayName, handle, email } = req.body || {};

    if (!displayName || !handle || !email) {
      res.status(400).json({ error: 'Display name, handle, and email are required.' });
      return;
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
    if (!emailOk) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      res.status(500).json({ error: 'Supabase is not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.' });
      return;
    }

    const displayNameColumn = process.env.SUPABASE_DISPLAY_NAME_COLUMN || 'Display Name';
    const handleColumn = process.env.SUPABASE_HANDLE_COLUMN || 'Handle';
    const emailColumn = process.env.SUPABASE_EMAIL_COLUMN || 'Email';
    const tableName = process.env.SUPABASE_USERS_TABLE || 'Users';

    const record = {
      [displayNameColumn]: String(displayName),
      [handleColumn]: String(handle),
      [emailColumn]: String(email)
    };

    const response = await fetch(`${process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      const errorText = await response.text();
      const message = errorText && errorText.includes('int8')
        ? 'Supabase rejected the signup because the Users table column types do not match text values.'
        : 'Supabase could not save this signup.';
      res.status(502).json({ error: message });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
};
