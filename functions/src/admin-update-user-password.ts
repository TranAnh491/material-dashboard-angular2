import * as admin from 'firebase-admin';
import { assertAdmin, randomSixDigitPassword, sendNewPasswordsToAdminZalo } from './authz';

export type AdminUpdateUserPasswordPayload = {
  uid: string;
  newPassword: string;
};

/**
 * Đổi password cho user theo uid, chỉ dùng Admin SDK nên KHÔNG cần biết password hiện tại.
 * Không lưu password vào Firestore; mật khẩu mới được gửi về Zalo ASP0106 để chuyển cho nhân viên.
 * Trả về true nếu đã gửi Zalo.
 */
export async function adminUpdateUserPassword(
  callerUid: string,
  targetUid: string,
  newPassword: string
): Promise<boolean> {
  if (!callerUid || !targetUid) {
    throw new Error('Thiếu callerUid hoặc targetUid.');
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password mới phải có ít nhất 6 ký tự.');
  }

  await assertAdmin(callerUid);
  console.log('🔐 adminUpdateUserPassword', { callerUid, targetUid });

  await admin.auth().updateUser(targetUid, { password: newPassword });
  // Phiên đăng nhập cũ của user bị buộc đăng nhập lại.
  await admin.auth().revokeRefreshTokens(targetUid);

  // Xóa password cũ còn sót trong Firestore (dữ liệu trước khi ngừng lưu).
  const clear = { password: admin.firestore.FieldValue.delete(), updatedAt: new Date() };
  await admin.firestore().collection('users').doc(targetUid).set(clear, { merge: true });
  await admin.firestore().collection('user-permissions').doc(targetUid).set(clear, { merge: true });

  const profile = (await admin.firestore().collection('users').doc(targetUid).get()).data() || {};
  return sendNewPasswordsToAdminZalo('Mật khẩu mới (đặt lại)', [{
    employeeId: String(profile.employeeId || targetUid),
    fullName: String(profile.displayName || ''),
    password: newPassword
  }]);
}

/**
 * Admin: sinh mật khẩu mới 6 số ngẫu nhiên rồi đổi cho user theo uid.
 * Trả về password mới để Admin hiển thị/sao chép.
 */
export async function adminResetUserPassword(
  callerUid: string,
  targetUid: string
): Promise<string> {
  const newPassword = randomSixDigitPassword();
  await adminUpdateUserPassword(callerUid, targetUid, newPassword);
  return newPassword;
}

function normalizeAspEmployeeId(input: string): string | null {
  const t = (input || '').trim().toUpperCase();
  if (!t) return null;

  const m1 = t.match(/^ASP(\d{4})$/);
  if (m1) return `ASP${m1[1]}`;

  const m2 = t.match(/^(\d{4})$/);
  if (m2) return `ASP${m2[1]}`;

  return null;
}

/**
 * Admin: đặt password cho user theo mã nhân viên ASP (ASPxxxx hoặc xxxx).
 * Lookup user bằng Firebase Auth (getUserByEmail) rồi update password theo uid.
 * Đồng thời cập nhật Firestore để UI hiển thị đúng.
 */
export async function adminSetUserPasswordByEmployeeId(
  callerUid: string,
  employeeIdRaw: string,
  newPassword: string
): Promise<{ uid: string; email: string; zaloSent: boolean }> {
  if (!callerUid) throw new Error('Thiếu callerUid.');
  if (!employeeIdRaw) throw new Error('Thiếu employeeId.');
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password mới phải có ít nhất 6 ký tự.');
  }

  const employeeId = normalizeAspEmployeeId(employeeIdRaw);
  if (!employeeId) throw new Error('employeeId không đúng định dạng (ASPxxxx hoặc xxxx).');
  await assertAdmin(callerUid);

  const digits = employeeId.replace(/^ASP/, '');
  const emailCandidates = [
    // Legacy/đang dùng trong app Settings: asp0609@asp.com
    `asp${digits.toLowerCase()}@asp.com`,
    `asp${digits.toLowerCase()}@gmail.com`,
    // Một số môi trường cũ: 0609@asp.com
    `${digits.toLowerCase()}@asp.com`,
    `${digits.toLowerCase()}@gmail.com`
  ];

  let foundUid: string | null = null;
  let foundEmail: string | null = null;

  for (const email of emailCandidates) {
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      if (userRecord?.uid) {
        foundUid = userRecord.uid;
        foundEmail = email;
        break;
      }
    } catch (e: any) {
      // Nếu không tìm thấy email này thì thử candidate khác
      if (e?.code === 'auth/user-not-found') continue;
      throw e;
    }
  }

  // Đăng ký bằng email thật: tìm theo field employeeId trên Firestore
  if (!foundUid) {
    const fsSnap = await admin
      .firestore()
      .collection('users')
      .where('employeeId', '==', employeeId)
      .limit(1)
      .get();
    if (!fsSnap.empty) {
      foundUid = fsSnap.docs[0].id;
    }
  }

  if (!foundUid) {
    throw new Error(`Không tìm thấy Firebase Auth user theo mã ${employeeId}.`);
  }

  if (!foundEmail) {
    const authUser = await admin.auth().getUser(foundUid);
    foundEmail = authUser.email || '';
  }

  const zaloSent = await adminUpdateUserPassword(callerUid, foundUid, newPassword);
  return { uid: foundUid, email: foundEmail, zaloSent };
}

