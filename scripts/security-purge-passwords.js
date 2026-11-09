#!/usr/bin/env node
/**
 * Xóa mật khẩu dạng chữ thường còn lưu trong Firestore (trường `password`)
 * ở các collection: users, user-permissions, local-user-permissions.
 *
 * Chạy SAU khi deploy functions mới (functions mới không ghi password nữa).
 *
 *   node scripts/security-purge-passwords.js            # xem trước, không ghi gì
 *   node scripts/security-purge-passwords.js --apply    # xóa trường password
 *
 * Trước khi xóa, script in ra mã nhân viên có mật khẩu DỄ ĐOÁN
 * (4 số cuối mã + "00", 4 số cuối mã, 123456) — những tài khoản này cần đặt lại mật khẩu.
 * Script không bao giờ in mật khẩu.
 */

const { PROJECT_ID, api, getAccessToken, listCollection, str, docId } = require('./lib/firebase-cli-rest');

const COLLECTIONS = ['users', 'user-permissions', 'local-user-permissions'];

function isPredictable(password, employeeId) {
  const p = String(password || '').trim();
  if (!p) return false;
  if (p === '123456') return true;
  const digits = String(employeeId || '').toUpperCase().replace(/^ASP/, '').slice(-4);
  return !!digits && (p === digits || p === `${digits}00`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const token = await getAccessToken();

  const users = await listCollection(token, 'users');
  const empByUid = new Map(users.map(d => [docId(d), str(d, 'employeeId').toUpperCase()]));

  const weak = new Set();
  const targets = [];
  for (const col of COLLECTIONS) {
    const docs = col === 'users' ? users : await listCollection(token, col);
    const withPw = docs.filter(d => d.fields && 'password' in d.fields);
    withPw.forEach(d => {
      const uid = docId(d);
      const emp = empByUid.get(uid) || str(d, 'employeeId').toUpperCase() || uid;
      if (isPredictable(str(d, 'password'), emp)) weak.add(emp);
      targets.push({ col, id: uid });
    });
    console.log(`${col}: ${docs.length} bản ghi, ${withPw.length} còn lưu password`);
  }

  if (weak.size) {
    console.log(`\n⚠️  ${weak.size} tài khoản có mật khẩu dễ đoán — cần đặt lại (Settings > Reset):`);
    console.log('   ' + [...weak].sort().join(', '));
  }

  if (!targets.length) {
    console.log('\n✅ Không còn password nào trong Firestore.');
    return;
  }
  if (!apply) {
    console.log(`\n(Xem trước — chưa xóa ${targets.length} trường password. Chạy lại với --apply để xóa.)`);
    return;
  }

  for (const t of targets) {
    // PATCH với updateMask=password và không gửi field password => Firestore xóa field đó.
    await api(
      token,
      'firestore.googleapis.com',
      'PATCH',
      `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${t.col}/${encodeURIComponent(t.id)}?updateMask.fieldPaths=password&currentDocument.exists=true`,
      { fields: {} }
    );
  }
  console.log(`\n✅ Đã xóa password khỏi ${targets.length} bản ghi.`);
}

main().catch(err => {
  console.error('❌ security-purge-passwords thất bại:', err.message || err);
  process.exitCode = 1;
});
