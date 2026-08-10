import * as admin from 'firebase-admin';

const DOC_PATH = 'app-settings/force-logout';

/**
 * Đánh dấu mốc "buộc đăng xuất" — mọi phiên đăng nhập TRƯỚC mốc này (client so sánh
 * `logoutAfter` với thời điểm client tự lưu lúc đăng nhập) sẽ bị đăng xuất khi phát hiện.
 * Chạy 1 lần/ngày lúc 6h (Asia/Ho_Chi_Minh) qua Cloud Scheduler — xem index.ts.
 */
export async function runForceLogoutDaily(db: admin.firestore.Firestore): Promise<void> {
  await db.doc(DOC_PATH).set(
    { logoutAfter: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}
