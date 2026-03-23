const express = require('express');
const cors = require('cors');
const session = require('express-session');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// Trust Railway's proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

app.use(cors({
  origin: [
    /^http:\/\/localhost:\d+$/,
    'https://mailbot-alpha.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use('/auth', require('./routes/auth'));
app.use('/email', require('./routes/email'));

app.get('/', (req, res) => res.json({ status: 'ok', message: 'Mailbot API running' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/debug', (req, res) => {
  res.json({
    hasClientId: !!process.env.GOOGLE_CLIENT_ID,
    clientIdStart: process.env.GOOGLE_CLIENT_ID?.slice(0, 10),
    nodeEnv: process.env.NODE_ENV
  })
})

app.listen(3001, () => console.log('✅ Server running on http://localhost:3001'));