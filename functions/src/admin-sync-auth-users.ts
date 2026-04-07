import * as admin from 'firebase-admin';

function isAdminOrManager(role: string | undefined | null): boolean {
  const r = (role || '').toString().trim().toLowerCase();
  const normalized = r
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

  return (
    normalized === 'admin' ||
    normalized === 'quan ly' ||
    r === 'admin' ||
    r === 'quản lý'
  );
}

export type DeleteAuthUsersNotInSettingsResult = {
  ok: true;
  deletedCount: number;
  protectedCount: number;
  deletedUidsSample: string[];
};

function normalizeAspEmployeeId(input: string): string | null {
  const t = (input || '').trim().toUpperCase();
  if (!t) return null;

  const m1 = t.match(/^ASP(\d{4})$/);
  if (m1) return `ASP${m1[1]}`;

  const m2 = t.match(/^(\d{4})$/);
  if (m2) return `ASP${m2[1]}`;

  return null;
}

export type DeleteUserByEmployeeIdResult = {
  ok: true;
  employeeId: string;
  deletedAuth: boolean;
  uid: string;
  email: string;
};

/**
 * Admin: xóa 1 tài khoản theo mã nhân viên ASP (ASPxxxx hoặc xxxx).
 * - Xóa Firebase Auth user (Admin SDK)
 * - Xóa Firestore docs: users / user-permissions / user-tab-permissions theo uid
 */
export async function adminDeleteUserByEmployeeId(
  callerUid: string,
  employeeIdRaw: string
): Promise<DeleteUserByEmployeeIdResult> {
  if (!callerUid) throw new Error('Thiếu callerUid.');
  if (!employeeIdRaw) throw new Error('Thiếu employeeId.');

  const employeeId = normalizeAspEmployeeId(employeeIdRaw);
  if (!employeeId) throw new Error('employeeId không đúng định dạng (ASPxxxx hoặc xxxx).');

  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  const callerRole = callerDoc.data()?.role;
  if (!isAdminOrManager(callerRole)) {
    throw new Error('permission-denied');
  }

  const digits = employeeId.replace(/^ASP/, '');
  const emailCandidates = [
    `asp${digits.toLowerCase()}@asp.com`,
    `asp${digits.toLowerCase()}@gmail.com`,
    `${digits.toLowerCase()}@asp.com`,
    `${digits.toLowerCase()}@gmail.com`
  ];

  let uid: string | null = null;
  let email: string | null = null;
  for (const e of emailCandidates) {
    try {
      const ur = await admin.auth().getUserByEmail(e);
      if (ur?.uid) {
        uid = ur.uid;
        email = e;
        break;
      }
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') continue;
      throw err;
    }
  }

  if (!uid || !email) {
    throw new Error(`Không tìm thấy Firebase Auth user theo mã ${employeeId}.`);
  }

  // Không cho xóa chính mình (an toàn)
  if (uid === callerUid) {
    throw new Error('Không thể xóa chính tài khoản đang đăng nhập.');
  }

  // Xóa Firestore trước (để app không còn thấy user), sau đó xóa Auth
  const batch = admin.firestore().batch();
  batch.delete(admin.firestore().collection('users').doc(uid));
  batch.delete(admin.firestore().collection('user-permissions').doc(uid));
  batch.delete(admin.firestore().collection('user-tab-permissions').doc(uid));
  await batch.commit();

  await admin.auth().deleteUser(uid);

  return { ok: true, employeeId, deletedAuth: true, uid, email };
}

/**
 * Admin: xóa toàn bộ Firebase Auth users KHÔNG có trong danh sách Settings.
 *
 * "Danh sách Settings" ở đây tương ứng:
 * - collection `users` (nguồn chính vì AuthGuard/signIn đang kiểm tra collection này)
 * - và collection `user-permissions` (một số trường hợp UI có thể hiển thị từ collection này)
 *
 * Hàm sẽ:
 * 1) Lấy allowedUids từ union(`users`, `user-permissions`)
 * 2) Đảm bảo mọi allowedUid đều có doc trong `users` (nếu thiếu -> tạo doc để đồng bộ đăng nhập)
 * 3) listUsers và delete những uid không thuộc allowedUids
 */
export async function adminDeleteAuthUsersNotInSettings(
  callerUid: string
): Promise<DeleteAuthUsersNotInSettingsResult> {
  if (!callerUid) {
    throw new Error('Thiếu callerUid.');
  }

  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  const callerRole = callerDoc.data()?.role;

  if (!isAdminOrManager(callerRole)) {
    throw new Error('permission-denied');
  }

  const usersSnap = await admin.firestore().collection('users').get();
  const permSnap = await admin.firestore().collection('user-permissions').get();

  const allowedUids = new Set<string>();
  for (const d of usersSnap.docs) allowedUids.add(d.id);
  for (const d of permSnap.docs) allowedUids.add(d.id);

  // Luôn bảo vệ chính caller
  allowedUids.add(callerUid);

  // Tạo doc users cho các uid chỉ nằm trong user-permissions nhưng thiếu trong users
  // (để FirebaseAuthService.signIn / AuthGuard pass được)
  const missingUserDocs: { uid: string; data: any }[] = [];
  for (const d of permSnap.docs) {
    if (usersSnap.docs.some(x => x.id === d.id)) continue;
    missingUserDocs.push({ uid: d.id, data: d.data() });
  }

  // Nếu collection lớn thì dùng cách tối ưu hơn, nhưng hiện tại ưu tiên đúng logic.
  await Promise.all(
    missingUserDocs.map(async (item) => {
      const data = item.data || {};
      await admin.firestore().collection('users').doc(item.uid).set(
        {
          uid: item.uid,
          email: data.email || '',
          displayName: data.displayName || '',
          department: data.department || '',
          factory: data.factory || '',
          role: data.role || 'User',
          createdAt: data.createdAt ? data.createdAt : new Date(),
          lastLoginAt: data.lastLoginAt ? data.lastLoginAt : new Date()
        },
        { merge: true }
      );
    })
  );

  let deletedCount = 0;
  const deletedUidsSample: string[] = [];

  let protectedCount = 0;
  const sampleSize = 20;

  let pageToken: string | undefined = undefined;
  do {
    const listRes = await admin.auth().listUsers(1000, pageToken);
    const candidates = listRes.users || [];

    const toDelete = candidates.filter(u => !allowedUids.has(u.uid));
    protectedCount += candidates.length - toDelete.length;

    // Xóa theo batch nhỏ để tránh quá tải
    const chunkSize = 10;
    for (let i = 0; i < toDelete.length; i += chunkSize) {
      const chunk = toDelete.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (u) => {
          try {
            await admin.auth().deleteUser(u.uid);
            deletedCount += 1;
            if (deletedUidsSample.length < sampleSize) {
              deletedUidsSample.push(u.uid);
            }
          } catch (e) {
            // tiếp tục xóa các user khác
          }
        })
      );
    }

    pageToken = listRes.pageToken;
  } while (pageToken);

  return {
    ok: true,
    deletedCount,
    protectedCount,
    deletedUidsSample
  };
}

