const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk').default;
const { google } = require('googleapis');
const { oauth2Client } = require('./auth');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SCHEDULED_PATH = path.join(__dirname, '../scheduled.json');
const FEEDBACK_PATH = path.join(__dirname, '../feedback.json');

// Load scheduled emails
let scheduledEmails = [];
if (fs.existsSync(SCHEDULED_PATH)) {
  scheduledEmails = JSON.parse(fs.readFileSync(SCHEDULED_PATH));
  console.log(`📅 Loaded ${scheduledEmails.length} scheduled emails`);
}

// Save scheduled emails to file
const saveScheduled = () => {
  fs.writeFileSync(SCHEDULED_PATH, JSON.stringify(scheduledEmails, null, 2));
};

// Send email helper
const sendGmail = async (to, subject, body) => {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
  ];
  const encodedEmail = Buffer.from(emailLines.join('\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedEmail }
  });
};

// Check and send scheduled emails every minute
setInterval(async () => {
  const now = new Date();
  const due = scheduledEmails.filter(e => new Date(e.sendAt) <= now);

  for (const email of due) {
    try {
      // Send the actual scheduled email
      await sendGmail(email.to, email.subject, email.body);
      console.log(`✅ Sent scheduled email to ${email.to}`);

      // Send confirmation email back to the sender
      try {
        const confirmTo = email.createdBy || email.to;
        await sendGmail(
          confirmTo,
          `✅ Scheduled email sent to ${email.to}`,
          `Hi!\n\nYour scheduled email has been sent successfully.\n\nDetails:\n- To: ${email.to}\n- Subject: ${email.subject}\n- Sent at: ${new Date().toLocaleString()}\n\nMailBot 🤖`
        );
        console.log(`📧 Confirmation email sent to ${confirmTo}`);
      } catch (confirmErr) {
        console.log('⚠️ Could not send confirmation email:', confirmErr.message);
      }

    } catch (err) {
      console.error(`❌ Failed to send scheduled email to ${email.to}:`, err.message);
    }
  }

  if (due.length > 0) {
    scheduledEmails = scheduledEmails.filter(e => new Date(e.sendAt) > now);
    saveScheduled();
  }
}, 60000);

// Draft email using Claude AI
router.post('/draft', async (req, res) => {
  const { userMessage } = req.body;
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are an AI email assistant. Based on the user's request, generate a professional email draft.

User's request: "${userMessage}"

Respond ONLY with a valid JSON object, no markdown, no backticks:
{
  "to": "recipient@example.com",
  "subject": "Email subject line",
  "body": "Full email body here"
}`
      }]
    });
    const raw = message.content[0].text.trim();
    const draft = JSON.parse(raw);
    res.json({ success: true, draft });
  } catch (err) {
    console.error('❌ Draft error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send email now
router.post('/send', async (req, res) => {
  const { to, subject, body } = req.body;

  // Server side validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!to || !emailRegex.test(to.trim())) {
    return res.status(400).json({ success: false, error: `Invalid email address: ${to}` });
  }

  try {
    await sendGmail(to, subject, body);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Send error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Schedule email
router.post('/schedule', (req, res) => {
  const { to, subject, body, sendAt, createdBy } = req.body;
  if (!to || !subject || !body || !sendAt) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }
  const scheduled = {
    id: Date.now().toString(),
    to, subject, body,
    sendAt: new Date(sendAt).toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null
  };
  scheduledEmails.push(scheduled);
  saveScheduled();
  console.log(`📅 Scheduled email to ${to} at ${sendAt}`);
  res.json({ success: true, scheduled });
});

// Get scheduled emails
router.get('/scheduled', (req, res) => {
  res.json({ scheduled: scheduledEmails });
});

// Delete scheduled email
router.delete('/scheduled/:id', (req, res) => {
  scheduledEmails = scheduledEmails.filter(e => e.id !== req.params.id);
  saveScheduled();
  res.json({ success: true });
});

// Save feedback
router.post('/feedback', (req, res) => {
  const { rating, comment } = req.body;
  let feedback = [];
  if (fs.existsSync(FEEDBACK_PATH)) {
    feedback = JSON.parse(fs.readFileSync(FEEDBACK_PATH));
  }
  feedback.push({
    id: Date.now().toString(),
    rating,
    comment,
    createdAt: new Date().toISOString()
  });
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(feedback, null, 2));
  res.json({ success: true });
});

module.exports = router;