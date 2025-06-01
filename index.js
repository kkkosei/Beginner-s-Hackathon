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
      const userId = event.source.userId;
      const text = event.message.text.trim();

      const parts = text.split(/\s+/); // 空白で分割
      const [task, deadlineRaw, statusRaw] = parts;

      if (!task || !deadlineRaw) {
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `「タスク名 日付 [ステータス]」の形式で送信してください。\n例: レポート提出 2025-06-02 未完了`,
        });
        return;
      }

      const status = statusRaw || '未完了';

      await saveTask(userId, task, deadlineRaw, status);

      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `ToDoを追加しました：\n${task}\n締切：${deadlineRaw}\nステータス：${status}`,
      });
    }
  }

  res.sendStatus(200);
});

async function saveTask(userId, task, deadlineRaw, status) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'シート1!A:D',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[userId, task, deadlineRaw, status]],
    },
  });
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

