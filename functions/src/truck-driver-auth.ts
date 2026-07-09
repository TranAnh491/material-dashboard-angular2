import * as admin from 'firebase-admin';

const XETAI_UID = 'truck-driver-xetai';
const XETAI_EMAIL = 'xetai@asp.com';
const XETAI_EMPLOYEE_ID = 'XETAI';
const XETAI_PASSWORD = '1234';

export async function signInTruckDriver(
  employeeIdRaw: string,
  passwordRaw: string
): Promise<{ email: string }> {
  const employeeId = String(employeeIdRaw || '')
    .trim()
    .toUpperCase();
  const password = String(passwordRaw || '').trim();

  if (employeeId !== XETAI_EMPLOYEE_ID || password !== XETAI_PASSWORD) {
    throw new Error('permission-denied');
  }

  try {
    await admin.auth().getUser(XETAI_UID);
    await admin.auth().updateUser(XETAI_UID, {
      email: XETAI_EMAIL,
      emailVerified: true,
      displayName: 'Tài xế Xe Tải',
      password: XETAI_PASSWORD
    });
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') {
      throw e;
    }
    await admin.auth().createUser({
      uid: XETAI_UID,
      email: XETAI_EMAIL,
      emailVerified: true,
      displayName: 'Tài xế Xe Tải',
      password: XETAI_PASSWORD
    });
  }

  const now = new Date();
  await admin
    .firestore()
    .collection('users')
    .doc(XETAI_UID)
    .set(
      {
        uid: XETAI_UID,
        email: XETAI_EMAIL,
        employeeId: XETAI_EMPLOYEE_ID,
        displayName: 'Tài xế Xe Tải',
        department: 'LOG',
        factory: 'ALL',
        role: 'User',
        isTruckDriver: true,
        createdAt: now,
        lastLoginAt: now,
        updatedAt: now
      },
      { merge: true }
    );

  await admin
    .firestore()
    .collection('user-permissions')
    .doc(XETAI_UID)
    .set(
      {
        uid: XETAI_UID,
        email: XETAI_EMAIL,
        displayName: 'Tài xế Xe Tải',
        hasReadOnlyPermission: true,
        isTruckDriver: true,
        updatedAt: now
      },
      { merge: true }
    );

  return { email: XETAI_EMAIL };
}
