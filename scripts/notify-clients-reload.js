#!/usr/bin/env node
/**
 * Sau khi deploy Hosting xong, tăng token trên Firestore `app-settings/client-reload`
 * để mọi trình duyệt đang mở web hiện popup bắt buộc "Tải lại ngay" (xem
 * src/app/services/client-reload.service.ts + src/app/app.component.ts).
 *
 * Dùng lại phiên đăng nhập của Firebase CLI (firebase login) để lấy access token gọi
 * thẳng Firestore REST API — không cần service account key hay thêm dependency nào.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'airspeed-warehouse';
const DOC_PATH = 'app-settings/client-reload';

// Firebase CLI OAuth client (installed-app client, công khai trong mã nguồn firebase-tools).
const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}: ${data}`));
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function readRefreshToken() {
  const configPath = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.config',
    'configstore',
    'firebase-tools.json'
  );
  const raw = fs.readFileSync(configPath, 'utf8');
  const data = JSON.parse(raw);
  const refreshToken = data?.tokens?.refresh_token;
  if (!refreshToken) {
    throw new Error('Không tìm thấy refresh_token — hãy chạy `firebase login` trước.');
  }
  return refreshToken;
}

async function getAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET
  }).toString();

  const res = await httpRequest(
    {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    },
    body
  );
  if (!res.access_token) {
    throw new Error('Không lấy được access_token từ refresh_token.');
  }
  return res.access_token;
}

async function getCurrentReloadToken(accessToken) {
  try {
    const res = await httpRequest({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${DOC_PATH}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const v = res?.fields?.reloadToken?.integerValue;
    const n = v != null ? parseInt(v, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    // Doc chưa tồn tại (404) hoặc lỗi đọc -> coi như token hiện tại = 0
    return 0;
  }
}

async function setReloadToken(accessToken, nextToken) {
  const nowIso = new Date().toISOString();
  const body = JSON.stringify({
    fields: {
      reloadToken: { integerValue: String(nextToken) },
      requestedAt: { timestampValue: nowIso },
      requestedBy: { stringValue: 'AUTO_DEPLOY' },
      message: { stringValue: 'Tự động sau khi deploy Hosting' }
    }
  });

  const mask = ['reloadToken', 'requestedAt', 'requestedBy', 'message']
    .map(f => `updateMask.fieldPaths=${f}`)
    .join('&');

  await httpRequest(
    {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${DOC_PATH}?${mask}`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    },
    body
  );
}

async function main() {
  const refreshToken = readRefreshToken();
  const accessToken = await getAccessToken(refreshToken);
  const current = await getCurrentReloadToken(accessToken);
  const next = current + 1;
  await setReloadToken(accessToken, next);
  console.log(`✅ Đã gửi lệnh tải lại cho mọi trình duyệt đang mở (token #${next}).`);
}

main().catch(err => {
  console.error('❌ notify-clients-reload thất bại:', err.message || err);
  process.exitCode = 1;
});
