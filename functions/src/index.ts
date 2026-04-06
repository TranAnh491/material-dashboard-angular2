import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { runOutboundDupNotifyForSlot, sendOutboundDupReportManual } from './outbound-dup-notify';
import { sendQcPriorityResolvedEmail, QcPriorityResolvedPayload } from './qc-priority-email';
import { emailPass } from './params-config';
import {
  adminUpdateUserPassword,
  adminResetUserPassword,
  adminSetUserPasswordByEmployeeId
} from './admin-update-user-password';
import { adminDeleteAuthUsersNotInSettings } from './admin-sync-auth-users';

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

/** Admin: đổi password user theo uid (không cần password hiện tại). */
export const adminUpdateUserPasswordFn = functions
  .https.onCall(async (data: { uid?: string; newPassword?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';
    const newPassword = typeof data?.newPassword === 'string' ? data.newPassword : '';

    if (!uid || !newPassword) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu uid hoặc newPassword.');
    }

    try {
      await adminUpdateUserPassword(context.auth.uid, uid, newPassword);
      return { ok: true };
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Chỉ Admin/Quản lý mới đổi được password.'
        );
      }

      // Errors từ Firebase Admin Auth
      if (code === 'auth/user-not-found') {
        throw new functions.https.HttpsError('not-found', 'Không tìm thấy user trong Firebase Auth.');
      }
      if (code === 'auth/invalid-uid') {
        throw new functions.https.HttpsError('invalid-argument', 'UID user không hợp lệ.');
      }
      if (code === 'auth/operation-not-allowed') {
        throw new functions.https.HttpsError('failed-precondition', 'Operation đổi password không được phép.');
      }

      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  });

/** Admin: tạo mật khẩu mới 6 số ngẫu nhiên và đổi theo uid. */
export const adminResetUserPasswordFn = functions
  .https.onCall(async (data: { uid?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';

    if (!uid) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu uid.');
    }

    try {
      const newPassword = await adminResetUserPassword(context.auth.uid, uid);
      return { ok: true, newPassword };
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      console.error('❌ adminResetUserPasswordFn error:', {
        callerUid: context.auth?.uid,
        targetUid: uid,
        code,
        msg
      });

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới đổi được password.');
      }
      if (code === 'auth/user-not-found') {
        throw new functions.https.HttpsError('not-found', 'Không tìm thấy user trong Firebase Auth.');
      }
      if (code === 'auth/invalid-uid') {
        throw new functions.https.HttpsError('invalid-argument', 'UID user không hợp lệ.');
      }
      if (code === 'auth/operation-not-allowed') {
        throw new functions.https.HttpsError('failed-precondition', 'Tài khoản không cho phép đổi password bằng phương thức này.');
      }
      if (code === 'auth/weak-password' || code === 'auth/invalid-password') {
        throw new functions.https.HttpsError('invalid-argument', 'Password mới không đạt chuẩn của Firebase Auth.');
      }

      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  });

/** Admin: đặt password theo mã nhân viên (ASPxxxx hoặc xxxx) -> reset về newPassword. */
export const adminSetUserPasswordByEmployeeIdFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data: { employeeId?: string; newPassword?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }

    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
    const newPassword = typeof data?.newPassword === 'string' ? data.newPassword : '';

    if (!employeeId || !newPassword) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId hoặc newPassword.');
    }

    try {
      const r = await adminSetUserPasswordByEmployeeId(context.auth.uid, employeeId, newPassword);
      return { ok: true, uid: r.uid, email: r.email };
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới đổi được password.');
      }
      if (msg.includes('Không tìm thấy Firebase Auth user')) {
        throw new functions.https.HttpsError('not-found', msg);
      }
      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  });

/** Admin: xóa Firebase Auth users không nằm trong danh sách Settings (collection users/user-permissions). */
export const adminDeleteAuthUsersNotInSettingsFn = functions
  .https.onCall(async (_data: unknown, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }

    try {
      const r = await adminDeleteAuthUsersNotInSettings(context.auth.uid);
      return r;
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = anyErr instanceof Error ? anyErr.message : anyErr?.message ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới được phép xóa.');
      }
      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  });
