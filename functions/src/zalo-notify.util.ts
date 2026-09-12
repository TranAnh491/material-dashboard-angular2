import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const ZALO_BOT_URL = (token: string, method: string): string =>
  `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/${method}`;

async function readBotToken(): Promise<string> {
  try {
    return zaloBotToken.value().trim();
  } catch {
    return '';
  }
}

async function resolveZaloChatId(memberId: string): Promise<{ token: string; chatId: string } | null> {
  const token = await readBotToken();
  if (!token || !memberId) return null;
  const linkSnap = await admin
    .firestore()
    .collection('zalo_links')
    .where('memberId', '==', memberId)
    .limit(1)
    .get();
  if (linkSnap.empty) return null;
  const chatId = String(linkSnap.docs[0].data()?.chatId || '').trim();
  if (!chatId) return null;
  return { token, chatId };
}

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
    const link = await resolveZaloChatId(memberId);
    if (!link) return false;

    const res = await fetch(ZALO_BOT_URL(link.token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: link.chatId, text: text.slice(0, 2000) })
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

/** Gửi file (xlsx/pdf…) qua Zalo bot. Thử sendFile rồi sendDocument. */
export async function sendZaloFileToEmployee(
  memberIdRaw: string,
  buf: Buffer,
  filename: string,
  caption?: string
): Promise<boolean> {
  try {
    const memberId = String(memberIdRaw || '').trim().toUpperCase();
    if (!memberId || !buf?.length || !filename) return false;
    const link = await resolveZaloChatId(memberId);
    if (!link) return false;

    const mime = filename.toLowerCase().endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/octet-stream';
    const blob = new Blob([new Uint8Array(buf)], { type: mime });

    const tryMethod = async (method: string): Promise<boolean> => {
      const form = new FormData();
      form.append('chat_id', link.chatId);
      form.append('file', blob, filename);
      if (caption) form.append('caption', caption.slice(0, 2000));
      const res = await fetch(ZALO_BOT_URL(link.token, method), { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`sendZaloFileToEmployee ${method} failed`, res.status, body.slice(0, 400));
        return false;
      }
      return true;
    };

    if (await tryMethod('sendFile')) return true;
    if (await tryMethod('sendDocument')) return true;
    return false;
  } catch (e) {
    console.error('sendZaloFileToEmployee failed', e);
    return false;
  }
}
