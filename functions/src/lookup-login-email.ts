import * as admin from 'firebase-admin';

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
 * Tìm email đăng nhập Firebase Auth theo mã nhân viên (field employeeId trong users).
 * Dùng khi user đăng ký bằng @airspeedmfgvn.com — không còn trùng với asp####@asp.com.
 */
export async function lookupAuthLoginEmailByEmployeeId(employeeIdRaw: string): Promise<string | null> {
  const employeeId = normalizeAspEmployeeId(employeeIdRaw);
  if (!employeeId) {
    return null;
  }

  const snap = await admin
    .firestore()
    .collection('users')
    .where('employeeId', '==', employeeId)
    .limit(1)
    .get();

  if (snap.empty) {
    return null;
  }

  const data = snap.docs[0].data() as { email?: string };
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  return email ? email.toLowerCase() : null;
}
