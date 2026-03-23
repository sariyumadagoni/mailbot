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

// GET /auth/google — alias for /auth/login (frontend compatibility)
router.get('/google', (req, res) => {
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
    return res.status(400).json({ error, authenticated: false });
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    // Save tokens to file as fallback
    try {
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
      console.log('✅ Tokens saved to file');
    } catch (fileErr) {
      console.warn('Could not save tokens to file:', fileErr.message);
    }

    // Save tokens in session
    req.session.tokens = tokens;
    req.session.authenticated = true;

    // Force session save before responding
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err.message);
        return res.status(500).json({ error: 'Session could not be saved' });
      }
      console.log('✅ Auth successful, tokens stored in session');
      res.redirect(process.env.FRONTEND_URL || 'https://mailbot-alpha.vercel.app');
    });
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.status(500).json({ error: 'Token exchange failed', details: err.message });
  }
});

// GET /auth/status — check if the current session is authenticated
router.get('/status', async (req, res) => {
  const tokens = req.session?.tokens;

  if (!tokens?.access_token && !tokens?.refresh_token) {
    return res.json({ authenticated: false });
  }

  const isExpired = tokens.expiry_date && Date.now() > tokens.expiry_date;

  // Auto-refresh if expired and refresh token is available
  if (isExpired && tokens.refresh_token) {
    try {
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials(tokens);
      const { credentials } = await oauth2Client.refreshAccessToken();
      req.session.tokens = credentials;
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(credentials, null, 2));
      console.log('🔄 Token auto-refreshed on status check');
      return res.json({
        authenticated: true,
        expired: false,
        refreshed: true,
        hasRefreshToken: !!credentials.refresh_token,
      });
    } catch (err) {
      console.error('Auto-refresh failed:', err.message);
      return res.json({ authenticated: false, reason: 'Token expired and refresh failed' });
    }
  }

  res.json({
    authenticated: true,
    expired: isExpired,
    hasRefreshToken: !!tokens.refresh_token,
    scope: tokens.scope,
  });
});

// GET /auth/refresh — manually force a token refresh
router.get('/refresh', async (req, res) => {
  const tokens = req.session?.tokens;

  if (!tokens?.refresh_token) {
    return res.status(401).json({
      error: 'No refresh token in session. Please re-authenticate via /auth/login',
    });
  }

  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(tokens);
    const { credentials } = await oauth2Client.refreshAccessToken();
    req.session.tokens = credentials;
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(credentials, null, 2));

    console.log('✅ Token refreshed successfully');
    res.json({ success: true, expiry_date: credentials.expiry_date });
  } catch (err) {
    console.error('Token refresh failed:', err.message);
    res.status(500).json({ error: 'Failed to refresh token', details: err.message });
  }
});

// POST /auth/logout — revoke token and destroy session
router.post('/logout', async (req, res) => {
  const tokens = req.session?.tokens;

  if (tokens?.access_token) {
    try {
      const oauth2Client = getOAuthClient();
      await oauth2Client.revokeToken(tokens.access_token);
      console.log('✅ Token revoked');
    } catch (err) {
      console.warn('Token revocation failed (may already be expired):', err.message);
    }
  }

  // Delete tokens file
  try {
    if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
  } catch (e) {
    console.warn('Could not delete tokens file:', e.message);
  }

  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err.message);
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

module.exports = router;