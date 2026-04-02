import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { runOutboundDupNotifyForSlot, sendOutboundDupReportManual } from './outbound-dup-notify';
import { sendQcPriorityResolvedEmail, QcPriorityResolvedPayload } from './qc-priority-email';
import { emailPass } from './params-config';

admin.initializeApp();

/**
 * Control Batch: 12:00 và 17:00 (Asia/Ho_Chi_Minh) quét trùng xuất outbound; có trùng thì gửi email.
 * Secret: EMAIL_PASS — chuỗi: EMAIL_USER, EMAIL_TO, … (xem params-config.ts).
 */
export const notifyOutboundDuplicatesAt12 = functions
  .runWith({ secrets: [emailPass] })
  .pubsub.schedule('0 12 * * *')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async () => {
    await runOutboundDupNotifyForSlot(admin.firestore(), '12');
  });

export const notifyOutboundDuplicatesAt17 = functions
  .runWith({ secrets: [emailPass] })
  .pubsub.schedule('0 17 * * *')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async () => {
    await runOutboundDupNotifyForSlot(admin.firestore(), '17');
  });

/** Callable: gửi mail báo cáo trùng xuất tại thời điểm gọi (nút Send Mail — Control Batch). */
export const sendControlBatchReportEmail = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
      const r = await sendOutboundDupReportManual(admin.firestore());
      return { ok: true, dupGroups: r.dupGroups };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('Thiếu cấu hình') ? 'failed-precondition' : 'internal',
        msg
      );
    }
  });

/** QC: mã ưu tiên trong Chờ kiểm, từ CHỜ KIỂM → trạng thái khác → gửi mail QC_PRIORITY_EMAIL_TO. */
export const sendQcPriorityResolvedEmailFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data: Partial<QcPriorityResolvedPayload>, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const materialCode = typeof data?.materialCode === 'string' ? data.materialCode.trim().slice(0, 120) : '';
    const poNumber = typeof data?.poNumber === 'string' ? data.poNumber.trim().slice(0, 120) : '';
    const imd = typeof data?.imd === 'string' ? data.imd.trim().slice(0, 120) : '';
    const location = typeof data?.location === 'string' ? data.location.trim().slice(0, 120) : '';
    const factory = typeof data?.factory === 'string' ? data.factory.trim().slice(0, 40) : 'ASM1';
    const oldStatus = typeof data?.oldStatus === 'string' ? data.oldStatus.trim().slice(0, 80) : '';
    const newStatus = typeof data?.newStatus === 'string' ? data.newStatus.trim().slice(0, 80) : '';
    const checkedBy = typeof data?.checkedBy === 'string' ? data.checkedBy.trim().slice(0, 80) : '';
    if (!materialCode || !newStatus) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu materialCode hoặc newStatus.');
    }
    const payload: QcPriorityResolvedPayload = {
      materialCode,
      poNumber,
      imd,
      location,
      factory,
      oldStatus,
      newStatus,
      checkedBy
    };
    try {
      await sendQcPriorityResolvedEmail(payload);
      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('Thiếu') ? 'failed-precondition' : 'internal',
        msg
      );
    }
  });
