import * as admin from 'firebase-admin';

export type AdminUpdateUserPasswordPayload = {
  uid: string;
  newPassword: string;
};

function isAdminOrManager(role: string | undefined | null): boolean {
  return role === 'Admin' || role === 'Quản lý';
}

/**
 * Đổi password cho user theo uid, chỉ dùng Admin SDK nên KHÔNG cần biết password hiện tại.
 * Đồng thời cập nhật field password trong Firestore để UI Settings hiển thị đúng.
 */
export async function adminUpdateUserPassword(
  callerUid: string,
  targetUid: string,
  newPassword: string
): Promise<void> {
  if (!callerUid || !targetUid) {
    throw new Error('Thiếu callerUid hoặc targetUid.');
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password mới phải có ít nhất 6 ký tự.');
  }

  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  const callerRole = callerDoc.data()?.role;
  console.log('🔐 adminUpdateUserPassword', {
    callerUid,
    callerRole,
    targetUid,
    passwordLen: newPassword?.length
  });
  if (!isAdminOrManager(callerRole)) {
    throw new Error('permission-denied');
  }

  // Update Firebase Auth password
  await admin.auth().updateUser(targetUid, { password: newPassword });

  // Cập nhật lại password ở Firestore để màn hình Settings hiển thị đồng bộ.
  await admin.firestore().collection('users').doc(targetUid).set(
    { password: newPassword, updatedAt: new Date() },
    { merge: true }
  );
  await admin.firestore().collection('user-permissions').doc(targetUid).set(
    { password: newPassword, updatedAt: new Date() },
    { merge: true }
  );
}

function generateSixDigitPassword(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

/**
 * Admin: sinh mật khẩu mới 6 số ngẫu nhiên rồi đổi cho user theo uid.
 * Trả về password mới để Admin hiển thị/sao chép.
 */
export async function adminResetUserPassword(
  callerUid: string,
  targetUid: string
): Promise<string> {
  const newPassword = generateSixDigitPassword();
  await adminUpdateUserPassword(callerUid, targetUid, newPassword);
  return newPassword;
}

