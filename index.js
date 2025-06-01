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

      const deadlineMatch = text.match(/^(\d{4}-\d{2}-\d{2})までのタスクを教えて$/);
      if (deadlineMatch) {
        const untilDate = deadlineMatch[1];

        const tasks = await fetchTasks(userId);
        const filtered = tasks.filter(([uid, , deadline]) => {
          if (uid !== userId) return false;
          const today = new Date();
          const due = new Date(deadline);
          const until = new Date(untilDate);
          return due >= today && due <= until;
        });

        if (filtered.length === 0) {
          await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: `指定された期間のタスクは見つかりませんでした。`,
          });
          return;
        }

        // ステータスではなく「タスク名（締切）」だけを並べる
        const message = filtered
          .map(([, task, deadline]) => `・${task}（締切: ${deadline}）`)
          .join('\n');

        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `以下が${untilDate}までのタスクです：\n${message}`,
        });
        return;
      }

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

async function fetchTasks(userId) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'シート1!A:C',
  });

  return result.data.values || []; // 1行あたり [ユーザーID, タスク名, 締切]
}

async function deleteTask(userId, taskName) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });

  // A～C列を取得する
  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'シート1!A:C',
  });
  const rows = getRes.data.values || [];

  // シート情報から sheetId を取得
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    includeGridData: false,
  });
  const sheetInfo = meta.data.sheets.find(s => s.properties.title === 'シート1');
  if (!sheetInfo) throw new Error('シート1 が見つかりませんでした。');
  const sheetId = sheetInfo.properties.sheetId;

  // 削除すべき行を列挙（行インデックスは 0ベース）
  const deleteRequests = [];
  rows.forEach((row, i) => {
    const [uid, tName] = row;
    if (uid === userId && tName === taskName) {
      deleteRequests.push({
        deleteDimension: {
          range: {
            sheetId: sheetId,
            dimension: 'ROWS',
            startIndex: i,
            endIndex: i + 1,
          },
        },
      });
    }
  });

  if (deleteRequests.length === 0) return 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: deleteRequests },
  });

  return deleteRequests.length;
}


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

