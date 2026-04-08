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

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Admin: cập nhật tên, bộ phận, email đăng nhập (Firebase Auth + Firestore).
 */
export async function adminUpdateUserProfile(
  callerUid: string,
  targetUid: string,
  patch: { displayName?: string; department?: string; email?: string }
): Promise<{ email: string }> {
  if (!callerUid || !targetUid) {
    throw new Error('Thiếu callerUid hoặc targetUid.');
  }

  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  const callerRole = callerDoc.data()?.role;
  if (!isAdminOrManager(callerRole)) {
    throw new Error('permission-denied');
  }

  const emailRaw =
    typeof patch.email === 'string' ? patch.email.trim().toLowerCase() : undefined;
  if (emailRaw !== undefined && emailRaw.length > 0 && !isValidEmail(emailRaw)) {
    throw new Error('Email không hợp lệ.');
  }

  if (emailRaw) {
    try {
      const existing = await admin.auth().getUserByEmail(emailRaw);
      if (existing.uid !== targetUid) {
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
    await admin.auth().updateUser(targetUid, { email: emailRaw });
  }

  const usersMerge: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.displayName === 'string') {
    usersMerge.displayName = patch.displayName.trim();
  }
  if (typeof patch.department === 'string') {
    usersMerge.department = patch.department.trim();
  }
  if (emailRaw) {
    usersMerge.email = emailRaw;
  }

  await admin.firestore().collection('users').doc(targetUid).set(usersMerge, { merge: true });

  const permMerge: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.displayName === 'string') {
    permMerge.displayName = patch.displayName.trim();
  }
  if (emailRaw) {
    permMerge.email = emailRaw;
  }
  await admin.firestore().collection('user-permissions').doc(targetUid).set(permMerge, { merge: true });

  const tabMerge: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.displayName === 'string') {
    tabMerge.displayName = patch.displayName.trim();
  }
  if (emailRaw) {
    tabMerge.email = emailRaw;
  }
  await admin.firestore().collection('user-tab-permissions').doc(targetUid).set(tabMerge, { merge: true });

  const after = await admin.auth().getUser(targetUid);
  return { email: (after.email || emailRaw || '').toLowerCase() };
}
