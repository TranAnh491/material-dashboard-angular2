#!/usr/bin/env node
/**
 * Gán quyền admin (custom claim `admin: true`) cho DUY NHẤT tài khoản ASP0106,
 * và gỡ claim admin khỏi mọi tài khoản khác.
 *
 * Chạy TRƯỚC khi deploy functions/rules mới (functions/rules mới chỉ tin claim này).
 *
 *   node scripts/security-bootstrap-admin.js            # xem trước, không ghi gì
 *   node scripts/security-bootstrap-admin.js --apply    # ghi claim
 *   node scripts/security-bootstrap-admin.js --apply --uid=<uid>   # khi có nhiều ứng viên
 *
 * Vì trước đây ai cũng tự sửa được `employeeId` trong Firestore, script KHÔNG tin một nguồn duy nhất:
 * liệt kê mọi ứng viên (Firestore users.employeeId == ASP0106, Auth email asp0106@asp.com);
 * nếu có hơn một tài khoản thì dừng lại để bạn chọn đúng UID.
 * Script cũng in các dấu hiệu bị sửa trái phép (mã ASP trùng, role khác 'User').
 */

const { getAccessToken, listCollection, listAuthUsers, claimsOf, setClaims, str, docId } = require('./lib/firebase-cli-rest');

const ADMIN_EMPLOYEE_ID = 'ASP0106';
const ADMIN_INTERNAL_EMAIL = 'asp0106@asp.com';

function arg(name) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
}

async function main() {
  const apply = arg('apply') === true;
  const forcedUid = typeof arg('uid') === 'string' ? arg('uid') : '';

  const token = await getAccessToken();
  const [userDocs, authUsers] = await Promise.all([listCollection(token, 'users'), listAuthUsers(token)]);
  const authByUid = new Map(authUsers.map(u => [u.localId, u]));

  // --- Kiểm tra dấu hiệu bị sửa trái phép ---
  const byEmp = new Map();
  const oddRoles = [];
  userDocs.forEach(d => {
    const emp = str(d, 'employeeId').trim().toUpperCase();
    if (emp) byEmp.set(emp, [...(byEmp.get(emp) || []), docId(d)]);
    const role = str(d, 'role').trim();
    if (role && role !== 'User') oddRoles.push({ uid: docId(d), employeeId: emp || '-', role });
  });
  const dups = [...byEmp.entries()].filter(([, uids]) => uids.length > 1);
  console.log(`Tài khoản Auth: ${authUsers.length}, hồ sơ users: ${userDocs.length}`);
  if (dups.length) {
    console.log('\n⚠️  Mã ASP bị trùng (một mã gắn nhiều tài khoản):');
    dups.forEach(([emp, uids]) => console.log(`   ${emp}: ${uids.join(', ')}`));
  }
  if (oddRoles.length) {
    console.log(`\nℹ️  ${oddRoles.length} hồ sơ có role khác 'User' (sau đợt này role KHÔNG còn cấp quyền gì ở server):`);
    oddRoles.forEach(r => console.log(`   ${r.employeeId}  role=${r.role}  uid=${r.uid}`));
  }

  // --- Ứng viên ASP0106 ---
  const candidates = new Map();
  (byEmp.get(ADMIN_EMPLOYEE_ID) || []).forEach(uid => candidates.set(uid, 'Firestore users.employeeId'));
  authUsers
    .filter(u => String(u.email || '').toLowerCase() === ADMIN_INTERNAL_EMAIL)
    .forEach(u => candidates.set(u.localId, (candidates.get(u.localId) ? candidates.get(u.localId) + ' + ' : '') + 'Auth email'));

  console.log(`\nỨng viên ${ADMIN_EMPLOYEE_ID}:`);
  candidates.forEach((source, uid) => {
    const a = authByUid.get(uid);
    const created = a?.createdAt ? new Date(Number(a.createdAt)).toISOString() : '-';
    const last = a?.lastLoginAt ? new Date(Number(a.lastLoginAt)).toISOString() : '-';
    console.log(`   uid=${uid}  email=${a?.email || '(không có Auth)'}  tạo=${created}  đăng nhập cuối=${last}  [${source}]`);
  });

  let targetUid = forcedUid;
  if (!targetUid) {
    const withAuth = [...candidates.keys()].filter(uid => authByUid.has(uid));
    if (withAuth.length !== 1) {
      console.log(`\n⛔ Có ${withAuth.length} ứng viên có tài khoản Auth. Kiểm tra danh sách trên rồi chạy lại với --uid=<uid đúng>.`);
      process.exitCode = 1;
      return;
    }
    targetUid = withAuth[0];
  }
  if (!authByUid.has(targetUid)) {
    console.log(`\n⛔ UID ${targetUid} không có trong Firebase Auth.`);
    process.exitCode = 1;
    return;
  }

  // --- Kế hoạch ghi claim ---
  const plan = [];
  authUsers.forEach(u => {
    const claims = claimsOf(u);
    if (u.localId === targetUid) {
      if (claims.admin !== true) plan.push({ uid: u.localId, email: u.email, next: { ...claims, admin: true }, action: 'GÁN admin' });
    } else if (claims.admin === true) {
      const { admin, ...rest } = claims;
      plan.push({ uid: u.localId, email: u.email, next: rest, action: 'GỠ admin' });
    }
  });

  console.log(`\nAdmin sẽ là: uid=${targetUid} (${authByUid.get(targetUid).email || '-'})`);
  if (!plan.length) {
    console.log('✅ Claim đã đúng, không cần ghi gì.');
    return;
  }
  plan.forEach(p => console.log(`   ${p.action}: ${p.uid} (${p.email || '-'})`));

  if (!apply) {
    console.log('\n(Xem trước — chưa ghi. Chạy lại với --apply để ghi.)');
    return;
  }
  for (const p of plan) {
    await setClaims(token, p.uid, p.next);
  }
  console.log(`\n✅ Đã ghi ${plan.length} thay đổi. ${ADMIN_EMPLOYEE_ID} cần ĐĂNG XUẤT rồi đăng nhập lại để token có quyền admin.`);
}

main().catch(err => {
  console.error('❌ security-bootstrap-admin thất bại:', err.message || err);
  process.exitCode = 1;
});
