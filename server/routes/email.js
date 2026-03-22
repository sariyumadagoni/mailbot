const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');
const path = require('path');

const TOKENS_PATH = path.join(__dirname, '..', 'tokens.json');
const SCHEDULED_PATH = path.join(__dirname, '..', 'scheduled.json');
const FEEDBACK_PATH = path.join(__dirname, '..', 'feedback.json');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
    const tokens = JSON.parse(raw);
    if (!tokens?.access_token && !tokens?.refresh_token) return null;
    return tokens;
  } catch (e) {
    return null;
  }
}

function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error('Failed to save tokens:', e.message);
  }
}

function loadJSON(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function getAuthenticatedGmail(req) {
  const tokens = req.session?.tokens || loadTokens();
  if (!tokens) throw new Error('Not authenticated. Visit /auth/login first.');

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials(tokens);

  // Auto-refresh if expired
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      saveTokens(credentials);
      req.session.tokens = credentials;
      oauth2Client.setCredentials(credentials);
      console.log('🔄 Token auto-refreshed');
    } catch (err) {
      throw new Error('Token expired and refresh failed. Visit /auth/login to re-authenticate.');
    }
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function buildRawEmail({ to, subject, body, replyToMessageId, threadId }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];
  if (replyToMessageId) {
    headers.push(`In-Reply-To: ${replyToMessageId}`);
    headers.push(`References: ${replyToMessageId}`);
  }
  const raw = headers.join('\r\n') + '\r\n\r\n' + body;
  return Buffer.from(raw).toString('base64url');
}

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /email/send — send an email via Gmail
router.post('/send', async (req, res) => {
  const { to, subject, body, replyToMessageId, threadId } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  try {
    const gmail = await getAuthenticatedGmail(req);
    const raw = buildRawEmail({ to, subject, body, replyToMessageId, threadId });

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(threadId ? { threadId } : {}),
      },
    });

    console.log(`✅ Email sent to ${to}, message ID: ${result.data.id}`);
    res.json({ success: true, messageId: result.data.id, threadId: result.data.threadId });
  } catch (err) {
    console.error('Send failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /email/inbox — fetch recent inbox messages
router.get('/inbox', async (req, res) => {
  const maxResults = parseInt(req.query.limit) || 20;
  const pageToken = req.query.pageToken || undefined;

  try {
    const gmail = await getAuthenticatedGmail(req);

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults,
      pageToken,
    });

    const messages = listRes.data.messages || [];

    // Fetch metadata for each message in parallel
    const detailed = await Promise.all(
      messages.map((m) =>
        gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        })
      )
    );

    const emails = detailed.map((d) => {
      const headers = d.data.payload?.headers || [];
      const get = (name) => headers.find((h) => h.name === name)?.value || '';
      return {
        id: d.data.id,
        threadId: d.data.threadId,
        from: get('From'),
        subject: get('Subject'),
        date: get('Date'),
        snippet: d.data.snippet,
        labelIds: d.data.labelIds,
      };
    });

    res.json({ emails, nextPageToken: listRes.data.nextPageToken || null });
  } catch (err) {
    console.error('Inbox fetch failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /email/:id — fetch full email content
router.get('/:id', async (req, res) => {
  try {
    const gmail = await getAuthenticatedGmail(req);
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.id,
      format: 'full',
    });

    const headers = msg.data.payload?.headers || [];
    const get = (name) => headers.find((h) => h.name === name)?.value || '';

    // Extract plain text body
    let body = '';
    const parts = msg.data.payload?.parts || [];
    const textPart = parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
    } else if (msg.data.payload?.body?.data) {
      body = Buffer.from(msg.data.payload.body.data, 'base64').toString('utf8');
    }

    res.json({
      id: msg.data.id,
      threadId: msg.data.threadId,
      from: get('From'),
      to: get('To'),
      subject: get('Subject'),
      date: get('Date'),
      body,
      snippet: msg.data.snippet,
    });
  } catch (err) {
    console.error('Fetch message failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /email/compose — AI-powered email composition via Claude
router.post('/compose', async (req, res) => {
  const { prompt, context, tone = 'professional' } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    const systemPrompt = `You are an expert email writer. Write clear, ${tone} emails.
Always respond with a JSON object in this exact format (no markdown, no backticks):
{
  "subject": "email subject line",
  "body": "full email body text"
}`;

    const userMessage = context
      ? `Context: ${context}\n\nWrite an email for: ${prompt}`
      : `Write an email for: ${prompt}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0]?.text || '';
    const parsed = JSON.parse(text);
    res.json({ subject: parsed.subject, body: parsed.body });
  } catch (err) {
    console.error('Compose failed:', err.message);
    res.status(500).json({ error: 'Failed to compose email: ' + err.message });
  }
});

// POST /email/schedule — save an email to be sent later
router.post('/schedule', (req, res) => {
  const { to, subject, body, sendAt } = req.body;

  if (!to || !subject || !body || !sendAt) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body, sendAt' });
  }

  const scheduled = loadJSON(SCHEDULED_PATH, []);
  const entry = {
    id: Date.now().toString(),
    to,
    subject,
    body,
    sendAt,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  scheduled.push(entry);
  saveJSON(SCHEDULED_PATH, scheduled);

  console.log(`📅 Email scheduled for ${sendAt} to ${to}`);
  res.json({ success: true, scheduled: entry });
});

// GET /email/scheduled/list — list all scheduled emails
router.get('/scheduled/list', (req, res) => {
  const scheduled = loadJSON(SCHEDULED_PATH, []);
  res.json({ scheduled });
});

// DELETE /email/schedule/:id — cancel a scheduled email
router.delete('/schedule/:id', (req, res) => {
  let scheduled = loadJSON(SCHEDULED_PATH, []);
  const before = scheduled.length;
  scheduled = scheduled.filter((e) => e.id !== req.params.id);

  if (scheduled.length === before) {
    return res.status(404).json({ error: 'Scheduled email not found' });
  }

  saveJSON(SCHEDULED_PATH, scheduled);
  res.json({ success: true });
});

// POST /email/feedback — save user feedback
router.post('/feedback', (req, res) => {
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  const feedback = loadJSON(FEEDBACK_PATH, []);
  const entry = {
    id: Date.now().toString(),
    rating,
    comment: comment || '',
    createdAt: new Date().toISOString(),
  };

  feedback.push(entry);
  saveJSON(FEEDBACK_PATH, feedback);

  res.json({ success: true, feedback: entry });
});

// GET /email/feedback/all — get all feedback
router.get('/feedback/all', (req, res) => {
  const feedback = loadJSON(FEEDBACK_PATH, []);
  const avg = feedback.length
    ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(2)
    : null;
  res.json({ feedback, averageRating: avg, total: feedback.length });
});

module.exports = router;