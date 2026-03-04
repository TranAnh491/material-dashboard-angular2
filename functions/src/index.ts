import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

// Stub: không export function nào. Thêm Cloud Functions tại đây khi cần.
export const placeholder = functions.https.onRequest((req, res) => {
  res.status(200).send('OK');
});
