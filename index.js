const express = require('express');
const { middleware } = require('@line/bot-sdk');
require('dotenv').config();

const app = express();

// 🔴 middlewareの前にexpress.json()を使うと署名が壊れることがある！
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

app.post('/webhook', middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  // 処理
  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
