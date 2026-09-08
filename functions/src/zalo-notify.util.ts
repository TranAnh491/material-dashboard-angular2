import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const ZALO_SEND_MESSAGE_URL = (token: string): string =>
  `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;

/**
 * Gửi một tin nhắn Zalo cho nhân viên theo mã ASP — chỉ khi nhân viên đã liên kết
 * bot (nhắn bot: /link → nhập mã ASPxxxx → /id, ghi vào `zalo_links`).
 *
 * Best-effort: chưa liên kết / thiếu ZALO_BOT_TOKEN / lỗi mạng → trả về false,
 * KHÔNG throw (không được làm hỏng luồng tạo tài khoản).
 *
 * Hàm gọi phải khai báo secret ZALO_BOT_TOKEN trong `runWith({ secrets: [zaloBotToken] })`.
 */
export async function sendZaloToEmployee(memberIdRaw: string, text: string): Promise<boolean> {
  try {
    const memberId = String(memberIdRaw || '').trim().toUpperCase();
    if (!memberId || !text) {
      return false;
    }

    let token = '';
    try {
      token = zaloBotToken.value().trim();
    } catch {
      token = '';
    }
    if (!token) {
      return false;
    }

    const linkSnap = await admin
      .firestore()
      .collection('zalo_links')
      .where('memberId', '==', memberId)
      .limit(1)
      .get();
    if (linkSnap.empty) {
      return false;
    }

    const chatId = String(linkSnap.docs[0].data()?.chatId || '').trim();
    if (!chatId) {
      return false;
    }

    const res = await fetch(ZALO_SEND_MESSAGE_URL(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('sendZaloToEmployee: Zalo sendMessage failed', res.status, JSON.stringify(body));
      return false;
    }
    return true;
  } catch (e) {
    console.error('sendZaloToEmployee failed', e);
    return false;
  }
}
