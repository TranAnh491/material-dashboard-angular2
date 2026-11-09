#!/usr/bin/env node
/**
 * Chuyển lịch sử KK cũ (`inventory-kk-history`, mỗi lần tick 1 doc) sang log gọn
 * `kk-history-log/{factory}_{YYYY-MM-DD}` — cùng định dạng dòng với
 * src/app/services/kk-history-log.service.ts. Dòng trùng được arrayUnion tự gộp nên chạy lại an toàn.
 *
 * Dùng phiên `firebase login` (giống notify-clients-reload.js). Chạy: node scripts/backfill-kk-history-log.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'airspeed-warehouse';
const CID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CSEC = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const DB = `projects/${PROJECT_ID}/databases/(default)/documents`;

function req(o, b) {
  return new Promise((res, rej) => {
    const r = https.request(o, (s) => {
      let d = '';
      s.on('data', (c) => (d += c));
      s.on('end', () => (s.statusCode >= 300 ? rej(new Error(s.statusCode + ' ' + d)) : res(JSON.parse(d || '{}'))));
    });
    r.on('error', rej);
    if (b) r.write(b);
    r.end();
  });
}

async function token() {
  const cfg = path.join(process.env.USERPROFILE || process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json');
  const rt = JSON.parse(fs.readFileSync(cfg, 'utf8')).tokens.refresh_token;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CID, client_secret: CSEC }).toString();
  const r = await req({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, body);
  return r.access_token;
}

function val(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('booleanValue' in v) return v.booleanValue;
  return undefined;
}

const pad = (n) => (n < 10 ? `0${n}` : String(n));
const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function toLine(f) {
  const at = f.checkedAt instanceof Date ? f.checkedAt : (f.createdAt instanceof Date ? f.createdAt : null);
  if (!at) return null;
  const line = [
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`,
    clean(f.action) || 'tick',
    clean(f.materialCode).toUpperCase(),
    clean(f.poNumber),
    clean(f.batchNumber),
    clean(f.location).toUpperCase(),
    clean(f.palletId),
    clean(Number(f.quantity) || 0),
    clean(Number(f.stock) || 0),
    clean(f.unit),
    clean(f.checkedBy).toUpperCase(),
    clean(f.source),
    clean(f.materialName).slice(0, 60)
  ].join('\t');
  return { factory: clean(f.factory).toUpperCase() || 'ASM1', date: dateKey(at), line };
}

(async () => {
  const tok = await token();
  const auth = { Authorization: 'Bearer ' + tok };
  const groups = new Map();
  let pageToken = '';
  let n = 0;
  do {
    const r = await req({ hostname: 'firestore.googleapis.com', method: 'GET', headers: auth,
      path: `/v1/${DB}/inventory-kk-history?pageSize=1000${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}` });
    for (const d of r.documents || []) {
      const f = {};
      for (const [k, v] of Object.entries(d.fields || {})) f[k] = val(v);
      const it = toLine(f);
      if (!it) continue;
      n++;
      const base = `${it.factory}_${it.date}`;
      const g = groups.get(base) || { factory: it.factory, date: it.date, lines: [] };
      g.lines.push(it.line);
      groups.set(base, g);
    }
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  console.log(`Đọc ${n} dòng → ${groups.size} ngày`);

  const writes = [];
  for (const [base, g] of groups) {
    writes.push({
      update: { name: `${DB}/kk-history-log/${base}`, fields: {
        factory: { stringValue: g.factory }, date: { stringValue: g.date }, shard: { integerValue: '1' } } },
      updateMask: { fieldPaths: ['factory', 'date', 'shard'] },
      updateTransforms: [{ fieldPath: 'lines', appendMissingElements: { values: g.lines.map((s) => ({ stringValue: s })) } }]
    });
  }
  for (let i = 0; i < writes.length; i += 50) {
    const body = JSON.stringify({ writes: writes.slice(i, i + 50) });
    await req({ hostname: 'firestore.googleapis.com', method: 'POST', path: `/v1/${DB}:commit`,
      headers: { ...auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  }
  console.log(`✅ Đã ghi ${writes.length} doc log.`);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
