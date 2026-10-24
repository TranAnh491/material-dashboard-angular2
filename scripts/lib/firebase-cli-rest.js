/**
 * Gọi REST API của Google bằng phiên đăng nhập Firebase CLI (`firebase login`),
 * giống scripts/notify-clients-reload.js — không cần service account key.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'airspeed-warehouse';

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
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const refreshToken = data?.tokens?.refresh_token;
  if (!refreshToken) {
    throw new Error('Không tìm thấy refresh_token — hãy chạy `firebase login` trước.');
  }
  return refreshToken;
}

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: readRefreshToken(),
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

/** Gọi API với Bearer token; body là object (sẽ JSON.stringify) hoặc undefined. */
function api(accessToken, hostname, method, apiPath, bodyObj) {
  const body = bodyObj === undefined ? undefined : JSON.stringify(bodyObj);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return httpRequest({ hostname, path: apiPath, method, headers }, body);
}

/** Đọc toàn bộ document của một collection (Firestore REST). */
async function listCollection(accessToken, collection) {
  const docs = [];
  let pageToken = '';
  do {
    const q = `pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await api(
      accessToken,
      'firestore.googleapis.com',
      'GET',
      `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}?${q}`
    );
    (res.documents || []).forEach(d => docs.push(d));
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/** Giá trị chuỗi của một field Firestore REST (stringValue), hoặc ''. */
function str(doc, field) {
  const f = doc?.fields?.[field];
  if (!f) return '';
  if (f.stringValue != null) return String(f.stringValue);
  if (f.integerValue != null) return String(f.integerValue);
  return '';
}

function docId(doc) {
  return String(doc.name || '').split('/').pop();
}

/** Toàn bộ tài khoản Firebase Auth (Identity Toolkit). */
async function listAuthUsers(accessToken) {
  const users = [];
  let pageToken = '';
  do {
    const q = `maxResults=1000${pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await api(
      accessToken,
      'identitytoolkit.googleapis.com',
      'GET',
      `/v1/projects/${PROJECT_ID}/accounts:batchGet?${q}`
    );
    (res.users || []).forEach(u => users.push(u));
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return users;
}

function claimsOf(authUser) {
  try {
    return authUser.customAttributes ? JSON.parse(authUser.customAttributes) : {};
  } catch {
    return {};
  }
}

/** Ghi đè custom claims của một tài khoản. */
function setClaims(accessToken, uid, claims) {
  return api(accessToken, 'identitytoolkit.googleapis.com', 'POST', `/v1/projects/${PROJECT_ID}/accounts:update`, {
    localId: uid,
    customAttributes: JSON.stringify(claims)
  });
}

module.exports = {
  PROJECT_ID,
  api,
  getAccessToken,
  listCollection,
  listAuthUsers,
  claimsOf,
  setClaims,
  str,
  docId
};
