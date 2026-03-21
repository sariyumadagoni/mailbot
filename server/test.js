require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk').default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 10,
  messages: [{ role: 'user', content: 'say hi' }]
})
.then(r => console.log('✅ Works!', r.content[0].text))
.catch(e => console.log('❌ Error:', e.message));