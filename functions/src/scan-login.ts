import * as admin from 'firebase-admin';
import { isAdminAccount } from './authz';

/**
 * Đăng nhập bằng quét thẻ nhân viên: thẻ chỉ chứa mã ASP, không có mật khẩu,
 * nên phiên này bị giới hạn:
 * - Tài khoản admin không được đăng nhập bằng thẻ.
 * - Token mang claim `scan: true`; Firestore rules không cho phiên quét thẻ làm việc quản trị.
 */
export async function signInFromScan(raw: string): Promise<{ token: string }> {
  const text = String(raw || '').trim().toUpperCase();
  const key = text.slice(0, 7);
  if (!/^ASP\d{4}$/.test(key)) {
    throw new Error('permission-denied');
  }

  const snap = await admin.firestore().collection('users').where('employeeId', '==', key).limit(1).get();
  if (snap.empty) {
    throw new Error('permission-denied');
  }

  const uid = snap.docs[0].id;
  try {
    await admin.auth().getUser(uid);
  } catch {
    throw new Error('permission-denied');
  }

  if (await isAdminAccount(uid)) {
    throw new Error('permission-denied');
  }

  const token = await admin.auth().createCustomToken(uid, { scan: true });
  return { token };
}
