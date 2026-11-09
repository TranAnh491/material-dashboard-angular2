import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { isAdminAccount, ADMIN_EMPLOYEE_ID } from './authz';
import { sendZaloToChat } from './zalo-notify.util';

/**
 * Đăng nhập bằng quét thẻ nhân viên: thẻ chỉ chứa mã ASP, không có mật khẩu,
 * nên phiên này bị giới hạn:
 * - Tài khoản admin không được đăng nhập bằng thẻ.
 * - Token mang claim `scan: true`; Firestore rules không cho phiên quét thẻ làm việc quản trị.
 * - Chống dò mã (thử lần lượt ASP0001, ASP0002…): đếm số lần quét SAI theo địa chỉ IP;
 *   quá FAIL_LIMIT lần trong FAIL_WINDOW_MS → khóa IP đó, báo admin qua Zalo.
 *   Nhân viên quét đúng thẻ của mình không bị ảnh hưởng.
 */
const THROTTLE_COLLECTION = 'scan-login-throttle';
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

function ipKey(ip: string): string {
  return createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32);
}

async function assertNotThrottled(db: admin.firestore.Firestore, ip: string): Promise<void> {
  const snap = await db.collection(THROTTLE_COLLECTION).doc(ipKey(ip)).get();
  const d = snap.data() as { fails?: number; windowStart?: number; blockedUntil?: number } | undefined;
  if (d?.blockedUntil && d.blockedUntil > Date.now()) {
    throw new Error('throttled');
  }
}

/** Ghi 1 lần quét sai; vượt ngưỡng → khóa IP + báo admin (1 lần). */
async function recordFailure(db: admin.firestore.Firestore, ip: string, tried: string): Promise<void> {
  const ref = db.collection(THROTTLE_COLLECTION).doc(ipKey(ip));
  const now = Date.now();
  let justBlocked = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.data() || {}) as { fails?: number; windowStart?: number; blockedUntil?: number };
    const inWindow = d.windowStart && now - d.windowStart < FAIL_WINDOW_MS;
    const fails = (inWindow ? d.fails || 0 : 0) + 1;
    const update: Record<string, unknown> = {
      fails,
      windowStart: inWindow ? d.windowStart : now,
      lastTried: tried.slice(0, 12),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (fails >= FAIL_LIMIT && !(d.blockedUntil && d.blockedUntil > now)) {
      update['blockedUntil'] = now + FAIL_WINDOW_MS;
      justBlocked = true;
    }
    tx.set(ref, update, { merge: true });
  });
  if (justBlocked) {
    try {
      const links = await db.collection('zalo_links').where('memberId', '==', ADMIN_EMPLOYEE_ID).limit(1).get();
      const chatId = links.empty ? '' : String(links.docs[0].data()?.chatId || links.docs[0].id).trim();
      if (chatId) {
        await sendZaloToChat(chatId,
          `⚠️ Đăng nhập quét thẻ: ${FAIL_LIMIT} lần quét sai liên tiếp từ cùng 1 máy/mạng — đã khóa 15 phút.\n` +
          `Có thể có người đang dò mã nhân viên. Mã thử gần nhất: ${tried.slice(0, 12)}`);
      }
    } catch (e) {
      console.error('scan-login: báo Zalo thất bại', e);
    }
  }
}

export async function signInFromScan(raw: string, ip = ''): Promise<{ token: string }> {
  const db = admin.firestore();
  await assertNotThrottled(db, ip);

  const text = String(raw || '').trim().toUpperCase();
  const key = text.slice(0, 7);
  const fail = async (): Promise<never> => {
    try { await recordFailure(db, ip, key || text); } catch (e) { console.error('scan-login: ghi lần sai thất bại', e); }
    throw new Error('permission-denied');
  };

  if (!/^ASP\d{4}$/.test(key)) {
    return fail();
  }

  const snap = await db.collection('users').where('employeeId', '==', key).limit(1).get();
  if (snap.empty) {
    return fail();
  }

  const uid = snap.docs[0].id;
  try {
    await admin.auth().getUser(uid);
  } catch {
    return fail();
  }

  if (await isAdminAccount(uid)) {
    throw new Error('permission-denied');
  }

  const token = await admin.auth().createCustomToken(uid, { scan: true });
  return { token };
}
