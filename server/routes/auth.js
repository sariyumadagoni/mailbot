const router = require('express').Router();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '../tokens.json');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Load saved tokens on startup
if (fs.existsSync(TOKEN_PATH)) {
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oauth2Client.setCredentials(tokens);
  console.log('✅ Gmail tokens loaded from file!');
}

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

router.get('/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  req.session.tokens = tokens;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log('✅ Gmail tokens saved to file!');
res.redirect('https://mailbot-alpha.vercel.app?connected=true');
});

router.get('/status', async (req, res) => {
  const hasTokens = fs.existsSync(TOKEN_PATH) || !!req.session.tokens;
  if (!hasTokens) return res.json({ connected: false, email: null });
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    res.json({ connected: true, email: profile.data.emailAddress });
  } catch (e) {
    res.json({ connected: hasTokens, email: null });
  }
});

router.get('/logout', (req, res) => {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
  req.session.destroy();
  res.json({ success: true });
});

module.exports = router;
module.exports.oauth2Client = oauth2Client;