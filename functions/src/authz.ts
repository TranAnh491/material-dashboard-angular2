import * as admin from 'firebase-admin';
import { randomInt } from 'crypto';
import { sendZaloToChat } from './zalo-notify.util';

/** Admin duy nhất — nhận mật khẩu mới qua Zalo để chuyển cho nhân viên. */
export const ADMIN_EMPLOYEE_ID = 'ASP0106';

/**
 * Quyền admin chỉ nằm trong custom claim `admin` của Firebase Auth.
 * Client không tự gán được claim, khác với trường `role` / `employeeId` trong Firestore `users`.
 * Gán claim bằng scripts/security-bootstrap-admin.js.
 */
export async function assertAdmin(callerUid: string): Promise<void> {
  if (!callerUid) {
    throw new Error('permission-denied');
  }
  const caller = await admin.auth().getUser(callerUid);
  if (caller.customClaims?.admin !== true) {
    throw new Error('permission-denied');
  }
}

/** Tài khoản admin: không cho đăng nhập bằng quét thẻ, không cho xóa / đổi mật khẩu qua chức năng thường. */
export async function isAdminAccount(uid: string): Promise<boolean> {
  try {
    const user = await admin.auth().getUser(uid);
    return user.customClaims?.admin === true;
  } catch {
    return false;
  }
}

/** Mật khẩu 6 số ngẫu nhiên (crypto, không dùng Math.random). */
export function randomSixDigitPassword(): string {
  return String(randomInt(100000, 1000000));
}

export type NewPasswordEntry = { employeeId: string; fullName?: string; password: string };

/**
 * Gửi mật khẩu mới về Zalo của ASP0106 để chuyển cho nhân viên.
 * Chỉ gửi khi ASP0106 liên kết với ĐÚNG MỘT chat — có hơn một chat nghĩa là liên kết bị chen ngang,
 * không gửi mật khẩu vào đó. Best-effort: lỗi trả về false, không làm hỏng việc đổi mật khẩu.
 * Hàm gọi phải khai báo secret ZALO_BOT_TOKEN trong `runWith({ secrets: [zaloBotToken] })`.
 */
export async function sendNewPasswordsToAdminZalo(title: string, entries: NewPasswordEntry[]): Promise<boolean> {
  if (!entries.length) return true;
  try {
    const links = await admin.firestore().collection('zalo_links')
      .where('memberId', '==', ADMIN_EMPLOYEE_ID)
      .get();
    if (links.size !== 1) {
      console.error(`sendNewPasswordsToAdminZalo: ${ADMIN_EMPLOYEE_ID} có ${links.size} chat Zalo — không gửi mật khẩu.`);
      return false;
    }
    const chatId = String(links.docs[0].data()?.chatId || links.docs[0].id).trim();
    if (!chatId) return false;

    const lines = entries.map(e => `${e.employeeId}${e.fullName ? ` — ${e.fullName}` : ''}: ${e.password}`);
    let ok = true;
    for (let i = 0; i < lines.length; i += 25) {
      const part = lines.length > 25 ? ` (${i / 25 + 1}/${Math.ceil(lines.length / 25)})` : '';
      const text = `🔑 ${title}${part}\n${lines.slice(i, i + 25).join('\n')}\n\nChuyển cho nhân viên rồi xóa tin này.`;
      ok = (await sendZaloToChat(chatId, text)) && ok;
    }
    return ok;
  } catch (e) {
    console.error('sendNewPasswordsToAdminZalo failed', e);
    return false;
  }
}
