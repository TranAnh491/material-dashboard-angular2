import * as admin from 'firebase-admin';

type TruckDriverAccount = {
  uid: string;
  email: string;
  employeeId: string;
  password: string;
  displayName: string;
};

/** Tài khoản app phụ Xe Tải — đăng nhập bằng mã ASP hoặc XETAI, mật khẩu 123456. */
const TRUCK_DRIVER_ACCOUNTS: Record<string, TruckDriverAccount> = {
  ASP9999: {
    uid: 'truck-driver-asp9999',
    email: 'asp9999@asp.com',
    employeeId: 'ASP9999',
    password: '123456',
    displayName: 'Tài xế Xe Tải'
  },
  XETAI: {
    uid: 'truck-driver-xetai',
    email: 'xetai@asp.com',
    employeeId: 'XETAI',
    password: '123456',
    displayName: 'Tài xế Xe Tải'
  }
};

/** Firebase Auth yêu cầu mật khẩu >= 6 ký tự. */
export function toTruckAuthPassword(password: string): string {
  const p = String(password || '').trim();
  if (p.length >= 6) return p;
  return p.padEnd(6, '0');
}

async function ensureTruckDriverAuthUser(account: TruckDriverAccount): Promise<string> {
  const auth = admin.auth();
  const authPassword = toTruckAuthPassword(account.password);

  const applyUpdate = async (uid: string): Promise<void> => {
    await auth.updateUser(uid, {
      email: account.email,
      emailVerified: true,
      displayName: account.displayName,
      password: authPassword
    });
  };

  try {
    await auth.getUser(account.uid);
    try {
      await applyUpdate(account.uid);
      return account.uid;
    } catch (e: any) {
      if (e?.code !== 'auth/email-already-exists') {
        throw e;
      }
    }
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') {
      throw e;
    }
  }

  try {
    const byEmail = await auth.getUserByEmail(account.email);
    await auth.updateUser(byEmail.uid, {
      emailVerified: true,
      displayName: account.displayName,
      password: authPassword
    });
    return byEmail.uid;
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') {
      throw e;
    }
  }

  await auth.createUser({
    uid: account.uid,
    email: account.email,
    emailVerified: true,
    displayName: account.displayName,
    password: authPassword
  });
  return account.uid;
}

async function ensureTruckDriverFirestore(account: TruckDriverAccount, uid: string): Promise<void> {
  const now = new Date();
  await admin
    .firestore()
    .collection('users')
    .doc(uid)
    .set(
      {
        uid,
        email: account.email,
        employeeId: account.employeeId,
        displayName: account.displayName,
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
    .doc(uid)
    .set(
      {
        uid,
        email: account.email,
        displayName: account.displayName,
        hasReadOnlyPermission: true,
        isTruckDriver: true,
        updatedAt: now
      },
      { merge: true }
    );
}

export async function signInTruckDriver(
  employeeIdRaw: string,
  passwordRaw: string
): Promise<{ email: string; authPassword: string }> {
  const employeeId = String(employeeIdRaw || '')
    .trim()
    .toUpperCase();
  const password = String(passwordRaw || '').trim();
  const account = TRUCK_DRIVER_ACCOUNTS[employeeId];

  if (!account || password !== account.password) {
    throw new Error('permission-denied');
  }

  const uid = await ensureTruckDriverAuthUser(account);
  await ensureTruckDriverFirestore(account, uid);

  return {
    email: account.email,
    authPassword: toTruckAuthPassword(account.password)
  };
}
