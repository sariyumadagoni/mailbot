const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKENS_PATH = path.join(__dirname, '..', 'tokens.json');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load tokens.json:', e.message);
  }
  return null;
}

function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error('Failed to save tokens.json:', e.message);
  }
}

// GET /auth/login — redirect user to Google OAuth consent screen
router.get('/login', (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  });
  res.redirect(url);
});

// GET /auth/callback — Google redirects here after user grants access
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/?auth=error&reason=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Persist tokens to file and session
    saveTokens(tokens);
    req.session.tokens = tokens;
    req.session.authenticated = true;

    console.log('✅ Auth successful, tokens saved');
    res.redirect('/?auth=success');
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.redirect('/?auth=error&reason=' + encodeURIComponent(err.message));
  }
});

// GET /auth/status — check if user is authenticated
router.get('/status', (req, res) => {
  const sessionTokens = req.session?.tokens;
  const fileTokens = loadTokens();
  const tokens = sessionTokens || fileTokens;

  if (!tokens) {
    return res.json({ authenticated: false });
  }

  // Check if access token is expired
  const isExpired = tokens.expiry_date && Date.now() > tokens.expiry_date;

  res.json({
    authenticated: true,
    expired: isExpired,
    hasRefreshToken: !!tokens.refresh_token,
    scope: tokens.scope,
  });
});

// GET /auth/refresh — manually refresh the access token
router.get('/refresh', async (req, res) => {
  const fileTokens = loadTokens();
  const tokens = req.session?.tokens || fileTokens;

  if (!tokens?.refresh_token) {
    return res.status(401).json({ error: 'No refresh token available. Please re-authenticate via /auth/login' });
  }

  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(tokens);

    const { credentials } = await oauth2Client.refreshAccessToken();
    saveTokens(credentials);
    req.session.tokens = credentials;

    console.log('✅ Token refreshed successfully');
    res.json({ success: true, expiry_date: credentials.expiry_date });
  } catch (err) {
    console.error('Token refresh failed:', err.message);
    res.status(500).json({ error: 'Failed to refresh token', details: err.message });
  }
});

// POST /auth/logout — clear session and optionally revoke token
router.post('/logout', async (req, res) => {
  const tokens = req.session?.tokens || loadTokens();

  // Optionally revoke the token with Google
  if (tokens?.access_token) {
    try {
      const oauth2Client = getOAuthClient();
      await oauth2Client.revokeToken(tokens.access_token);
      console.log('✅ Token revoked');
    } catch (err) {
      console.warn('Token revocation failed (may already be expired):', err.message);
    }
  }

  // Clear tokens file and session
  try { fs.writeFileSync(TOKENS_PATH, '{}'); } catch (_) {}
  req.session.destroy();

  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;