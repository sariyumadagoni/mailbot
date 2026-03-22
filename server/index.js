const express = require('express');
const cors = require('cors');
const session = require('express-session');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

app.use(cors({ origin: /^http:\/\/localhost:\d+$/, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use('/auth', require('./routes/auth'));
app.use('/email', require('./routes/email'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/debug', (req, res) => {
  res.json({
    hasClientId: !!process.env.GOOGLE_CLIENT_ID,
    clientIdStart: process.env.GOOGLE_CLIENT_ID?.slice(0, 10),
    nodeEnv: process.env.NODE_ENV
  })
})
app.listen(3001, () => console.log('✅ Server running on http://localhost:3001'));