cat > routes/email.js << 'EOF'
const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

router.post('/send', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not logged in' });

  const { to, subject, body } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'Missing to, subject, or body' });

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.REDIRECT_URI || 'https://mailbot-production-78f1.up.railway.app/auth/callback'
    );
    oauth2Client.setCredentials(req.session.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n');
    const encoded = Buffer.from(message).toString('base64url');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
EOF