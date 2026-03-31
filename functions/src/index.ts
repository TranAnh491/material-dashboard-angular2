import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

// Stub: health check khi deploy Functions.
export const placeholder = functions.https.onRequest((req, res) => {
  res.status(200).send('OK');
});

/**
 * Gửi tin nhắn Telegram (bot → group) — token chỉ nằm trên server.
 * Cấu hình: firebase functions:config:set telegram.bot_token="..." telegram.chat_id="-100..."
 * Gọi từ Angular: httpsCallable(getFunctions(app), 'sendTelegramNotification')({ text: '...' })
 */
export const sendTelegramNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
  }
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!text) {
    throw new functions.https.HttpsError('invalid-argument', 'Thiếu nội dung.');
  }
  const cfg = (functions.config() as { telegram?: { bot_token?: string; chat_id?: string } }).telegram || {};
  const botToken = cfg.bot_token;
  const chatId = cfg.chat_id;
  if (!botToken || !chatId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Chưa cấu hình telegram.bot_token / telegram.chat_id trên Functions.'
    );
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error('Telegram API error', res.status, errBody);
    throw new functions.https.HttpsError('internal', 'Gửi Telegram thất bại.');
  }
  return { ok: true };
});
