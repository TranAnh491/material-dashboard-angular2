#!/usr/bin/env node
/**
 * Đổi Standard Packing = 0.1 → 1 cho toàn bộ mã NVL (collection `materials` + `catalog`).
 *   node scripts/fix-standard-packing.js          → chạy thử: chỉ liệt kê mã sẽ đổi
 *   node scripts/fix-standard-packing.js --apply  → ghi Firestore + báo app tải lại danh mục NVL
 *
 * Dùng phiên đăng nhập Firebase CLI (giống notify-clients-reload.js), gọi Firestore REST API.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'airspeed-warehouse';
const FROM = 0.1;
const TO = 1;
const COLLECTIONS = ['materials', 'catalog'];
const DB = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status}: ${data}`));
        try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json');
  const refreshToken = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.tokens?.refresh_token;
  if (!refreshToken) throw new Error('Không tìm thấy refresh_token — hãy chạy `firebase login` trước.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET
  }).toString();
  const res = await httpRequest({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!res.access_token) throw new Error('Không lấy được access_token.');
  return res.access_token;
}

function api(token, method, p, payload) {
  const body = payload ? JSON.stringify(payload) : null;
  return httpRequest({
    hostname: 'firestore.googleapis.com', path: p, method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
    }
  }, body);
}

/** Mã có standardPacking = 0.1 (lưu dạng số hoặc chuỗi "0.1"). */
async function findDocs(token, collection) {
  const values = [{ doubleValue: FROM }, { stringValue: String(FROM) }];
  const out = new Map();
  for (const value of values) {
    const rows = await api(token, 'POST', `${DB}:runQuery`, {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: 'standardPacking' }, op: 'EQUAL', value } }
      }
    });
    for (const r of rows) if (r.document) out.set(r.document.name, r.document);
  }
  return [...out.values()];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const token = await getAccessToken();
  const nowIso = new Date().toISOString();
  let total = 0;

  for (const col of COLLECTIONS) {
    const docs = await findDocs(token, col);
    total += docs.length;
    const codes = docs.map(d => d.name.split('/').pop());
    console.log(`${col}: ${docs.length} mã có Standard Packing = ${FROM}`);
    if (codes.length) console.log('  ' + codes.join(', '));
    if (!apply) continue;
    for (let i = 0; i < docs.length; i += 400) {
      const writes = docs.slice(i, i + 400).map(d => ({
        update: {
          name: d.name,
          fields: {
            standardPacking: { integerValue: String(TO) },
            updatedAt: { timestampValue: nowIso },
            lastEditedBy: { stringValue: 'SP_0.1_TO_1' }
          }
        },
        updateMask: { fieldPaths: ['standardPacking', 'updatedAt', 'lastEditedBy'] },
        currentDocument: { exists: true }
      }));
      await api(token, 'POST', `${DB}:commit`, { writes });
    }
    console.log(`  ✅ Đã đổi ${docs.length} mã → ${TO}`);
  }

  if (apply && total) {
    // Báo các máy đang mở app đọc lại phần danh mục NVL vừa đổi (nvl-catalog-full.service.ts → app-meta/nvl-catalog).
    await api(token, 'PATCH', `${DB}/app-meta/nvl-catalog?updateMask.fieldPaths=updatedAt`, {
      fields: { updatedAt: { timestampValue: new Date().toISOString() } }
    });
  }
  console.log(apply ? `Xong: ${total} dòng đã cập nhật.` : `Chạy thử: ${total} dòng sẽ đổi. Thêm --apply để ghi.`);
}

main().catch(err => {
  console.error('❌ fix-standard-packing thất bại:', err.message || err);
  process.exitCode = 1;
});
