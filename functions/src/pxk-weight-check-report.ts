/**
 * Báo cáo mã không hợp lý để Check lượng PXK — gửi Zalo tới nhóm Quản lý kho.
 */
import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function clip(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max);
}

export async function notifyPxkWeightCheckReport(
  db: admin.firestore.Firestore,
  opts?: {
    lsx?: string;
    materialCode?: string;
    maKho?: string;
    po?: string;
    reason?: string;
    reportedBy?: string;
  }
): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }
  const groupSnap = await db.doc(KHO_GROUP_DOC).get();
  const chatId = String(groupSnap.data()?.chatId || '').trim();
  if (!chatId) {
    throw new Error('Chưa gắn nhóm Quản lý kho trong zalo_group_config/quanly_kho.');
  }
  const lines = [
    '📋 Báo cáo Check lượng PXK',
    `Thời điểm: ${vnNowLabel(new Date())}`,
    clip(opts?.reportedBy, 20) ? `Người gửi: ${clip(opts?.reportedBy, 20)}` : '',
    clip(opts?.lsx, 40) ? `LSX: ${clip(opts?.lsx, 40)}` : '',
    clip(opts?.materialCode, 40) ? `Mã hàng: ${clip(opts?.materialCode, 40)}` : '',
    clip(opts?.maKho, 40) ? `Kho: ${clip(opts?.maKho, 40)}` : '',
    clip(opts?.po, 80) ? `PO: ${clip(opts?.po, 80)}` : '',
    clip(opts?.reason, 400) ? `Lý do: ${clip(opts?.reason, 400)}` : '',
    'Nhóm Quản lý kho: Work Order Status → KHÁC → Danh mục check lượng → Duyệt hoặc Từ chối.'
  ].filter(Boolean);
  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
  }
}
