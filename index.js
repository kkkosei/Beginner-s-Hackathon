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
    // ────────────────────────────────────────────────────────────────────
    // ① フォロー（友だち追加）されたときの使い方メッセージ送信
    if (event.type === 'follow') {
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: [
          'こんにちは！ToDo管理Botへようこそ😊',
          '',
          '――――――――――――――――――――――',
          '■ 使い方 ■',
          '',
          '① タスクを登録したいとき：',
          '　「タスク名 YYYY-MM-DD」',
          '　例）レポート提出 2025-06-10',
          '',
          '② タスクが完了したとき：',
          '　「タスク名完了」 または 「タスク名完了しました」',
          '　例）レポート提出完了',
          '',
          '③ 締切○○までのタスクを一覧で見たいとき：',
          '　「YYYY-MM-DDまでのタスクを教えて」',
          '　例）2025-06-15までのタスクを教えて',
          '――――――――――――――――――――――',
          '上記形式で送っていただくと、自動でスプレッドシートに登録・削除・一覧取得を行います！',
        ].join('\n'),
      });
      // フォロー時は以降の「メッセージ受信処理」は不要なので continue
      continue;
    }
    // ────────────────────────────────────────────────────────────────────

    // ② メッセージ受信時の処理
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const text = event.message.text.trim();

      // ── 1) 完了報告（タスク削除）判定 ──
      const completeMatch = text.match(/^(.+?)(?:完了しました|完了)$/);
      if (completeMatch) {
        const taskName = completeMatch[1].trim();
        const deletedCount = await deleteTask(userId, taskName);

        if (deletedCount === 0) {
          await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: `「${taskName}」という名前のタスクが見つかりませんでした。`,
          });
        } else {
          await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: `タスク「${taskName}」をスプレッドシートから削除しました。（${deletedCount} 件）`,
          });
        }
        return;
      }

      // ── 2) 期限付き一覧取得判定 ──
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

        const message = filtered
          .map(([, task, deadline]) => `・${task}（締切: ${deadline}）`)
          .join('\n');

        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `以下が${untilDate}までのタスクです：\n${message}`,
        });
        return;
      }

      // ── 3) 新規タスク登録 ──
      const parts = text.split(/\s+/);
      const [task, deadlineRaw] = parts;

      if (!task || !deadlineRaw) {
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `「タスク名 日付」の形式で送信してください。\n例）レポート提出 2025-06-10`,
        });
        return;
      }

      await saveTask(userId, task, deadlineRaw);
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `ToDoを追加しました：\n${task}\n締切：${deadlineRaw}`,
      });
      return;
    }
  }

  res.sendStatus(200);
});

// ─── 以下、関数定義 ───

async function saveTask(userId, task, deadlineRaw) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'シート1!A:C',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[userId, task, deadlineRaw]],
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
  return result.data.values || [];
}

async function deleteTask(userId, taskName) {
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });

  // 1) 全行取得（A～C列）
  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'シート1!A:C',
  });
  const rows = getRes.data.values || [];

  // 2) sheetId を取得
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    includeGridData: false,
  });
  const sheetInfo = meta.data.sheets.find(s => s.properties.title === 'シート1');
  if (!sheetInfo) throw new Error('シート1 が見つかりませんでした。');
  const sheetId = sheetInfo.properties.sheetId;

  // 3) 削除対象の行を収集
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

  // 4) 一括削除実行
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
