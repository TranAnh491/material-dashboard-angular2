import * as admin from 'firebase-admin';

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Chỉ chấp nhận email công ty thật khi tự cập nhật (không phải admin thao tác hộ). */
function isCompanyEmail(email: string): boolean {
  const e = (email || '').trim().toLowerCase();
  return e.endsWith('@airspeedmfgvn.com') || e.endsWith('@airspeedmfg.com');
}

/**
 * Tự cập nhật email công ty cho chính tài khoản đang đăng nhập (Firebase Auth + Firestore).
 * Dùng cho popup bắt buộc "Cập nhật email công ty" ở lần đăng nhập tiếp theo (tài khoản
 * không thuộc bộ phận WH và chưa có email công ty thật).
 */
export async function selfUpdateCompanyEmail(uid: string, emailRaw: string): Promise<{ email: string }> {
  if (!uid) {
    throw new Error('Thiếu uid.');
  }
  const email = (emailRaw || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    throw new Error('Email không hợp lệ.');
  }
  if (!isCompanyEmail(email)) {
    throw new Error('Chỉ chấp nhận email công ty (@airspeedmfgvn.com hoặc @airspeedmfg.com).');
  }

  try {
    const existing = await admin.auth().getUserByEmail(email);
    if (existing.uid !== uid) {
      throw new Error('Email đã được dùng cho tài khoản khác.');
    }
  } catch (e: any) {
    if (e?.message && e.message.includes('đã được dùng')) {
      throw e;
    }
    if (e?.code !== 'auth/user-not-found') {
      throw e;
    }
  }

  await admin.auth().updateUser(uid, { email });

  const now = new Date();
  const merge = { email, updatedAt: now };
  await admin.firestore().collection('users').doc(uid).set(merge, { merge: true });
  await admin.firestore().collection('user-permissions').doc(uid).set(merge, { merge: true });
  await admin.firestore().collection('user-tab-permissions').doc(uid).set(merge, { merge: true });

  return { email };
}
