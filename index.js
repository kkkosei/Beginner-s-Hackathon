const express = require('express');
const { google } = require('googleapis');
const { middleware, Client } = require('@line/bot-sdk');
require('dotenv').config();
const app = express();


const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

app.post('/webhook', middleware(lineConfig), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const task = event.message.text;
      const userId = event.source.userId;

      await saveTask(userId, task);

      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `ToDoを追加しました：${task}`,
      });
    }
  }

  res.sendStatus(200);
});

async function saveTask(userId, task) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'シート1!A:D',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[now, userId, task, '未完了']],
    },
  });
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

