import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import type { QcPriorityResolvedPayload } from './qc-priority-email';
import { emailPass, zaloBotToken } from './params-config';

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
    const { runOutboundDupNotifyForSlot } = await import('./outbound-dup-notify');
    await runOutboundDupNotifyForSlot(admin.firestore(), '12');
  });

export const notifyOutboundDuplicatesAt17 = functions
  .runWith({ secrets: [emailPass] })
  .pubsub.schedule('0 17 * * *')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async () => {
    const { runOutboundDupNotifyForSlot } = await import('./outbound-dup-notify');
    await runOutboundDupNotifyForSlot(admin.firestore(), '17');
  });

/**
 * Nhiệt Độ: nhắc cập nhật biểu mẫu qua Zalo (T2–T7, không nhắc CN).
 * 8:55 / 9:25 / 9:55 và 14:55 / 15:25 / 15:55 — sau 2 lần nhắc → ASP0119, ASP1761, ASP0538.
 * Cấu hình NV: Firestore `nhiet-do-zalo-settings` (ASM1, ASM2).
 */
const runNhietDoZaloRemindJob = async () => {
  const { runNhietDoZaloRemind } = await import('./nhiet-do-zalo-remind');
  await runNhietDoZaloRemind(admin.firestore());
};

export const notifyNhietDoZaloRemindMorning = functions
  .runWith({ secrets: [zaloBotToken] })
  .pubsub.schedule('*/5 8-10 * * 1-6')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(runNhietDoZaloRemindJob);

export const notifyNhietDoZaloRemindAfternoon = functions
  .runWith({ secrets: [zaloBotToken] })
  .pubsub.schedule('*/5 14-16 * * 1-6')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(runNhietDoZaloRemindJob);

/** Nhiệt Độ: gửi thử tin nhắc Zalo (nút「Gửi ngay」— cài đặt nhắc). */
export const sendNhietDoZaloRemindTestFn = functions
  .runWith({ secrets: [zaloBotToken] })
  .https.onCall(async (data: Record<string, unknown>, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const factory = data?.factory === 'ASM2' ? 'ASM2' : 'ASM1';
    const slotRaw = data?.slot;
    const slot =
      slotRaw === 'afternoon' ? 'afternoon' : slotRaw === 'morning' ? 'morning' : undefined;
    const memberIds = Array.isArray(data?.memberIds)
      ? (data.memberIds as unknown[]).map(m => String(m ?? ''))
      : undefined;
    try {
      const { sendNhietDoZaloRemindTest } = await import('./nhiet-do-zalo-remind');
      const r = await sendNhietDoZaloRemindTest(admin.firestore(), factory, { slot, memberIds });
      return r;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('Thiếu') || msg.includes('Chưa') || msg.includes('Không')
          ? 'failed-precondition'
          : 'internal',
        msg
      );
    }
  });

/** Callable: gửi mail báo cáo trùng xuất tại thời điểm gọi (nút Send Mail — Control Batch). */
export const sendControlBatchReportEmail = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
      const {
        buildControlBatchDupSettingsFromCallablePayload,
        loadControlBatchDupSettings,
        sendOutboundDupReportManual
      } = await import('./outbound-dup-notify');
      const db = admin.firestore();
      const fromUi = buildControlBatchDupSettingsFromCallablePayload(data);
      const settings = fromUi ?? (await loadControlBatchDupSettings(db));
      const r = await sendOutboundDupReportManual(db, settings);
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
      const { sendQcPriorityResolvedEmail } = await import('./qc-priority-email');
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

/** Materials ASM1/ASM2: gửi mã OTP 4 số qua Zalo để mở khóa cột Vị trí.
 *  Tab Location: truyền forLocationAdd=true → tin Zalo yêu cầu thêm vị trí (gửi ASP0106). */
export const requestLocationUnlockOtpFn = functions
  .runWith({ secrets: [zaloBotToken] })
  .https.onCall(async (data: Record<string, unknown>, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const forLocationAdd = data?.forLocationAdd === true;
    const requestedBy = typeof data?.requestedBy === 'string' ? data.requestedBy.trim().slice(0, 20) : '';
    const locationName = typeof data?.locationName === 'string' ? data.locationName.trim().slice(0, 80) : '';
    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim().slice(0, 20) : '';
    if (!forLocationAdd && !employeeId) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu mã nhân viên.');
    }
    try {
      if (forLocationAdd) {
        const { requestLocationAddOtp } = await import('./location-add-otp');
        await requestLocationAddOtp(admin.firestore(), requestedBy, locationName);
      } else {
        const { requestLocationUnlockOtp } = await import('./location-unlock-otp');
        await requestLocationUnlockOtp(admin.firestore(), employeeId);
      }
      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('không được phép') || msg.includes('Thiếu') || msg.includes('zalo_links')
          ? 'failed-precondition'
          : 'internal',
        msg
      );
    }
  });

/** Materials ASM1/ASM2: xác nhận mã OTP mở khóa cột Vị trí.
 *  Tab Location: truyền forLocationAdd=true. */
export const verifyLocationUnlockOtpFn = functions
  .runWith({ secrets: [zaloBotToken] })
  .https.onCall(async (data: Record<string, unknown>, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const forLocationAdd = data?.forLocationAdd === true;
    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim().slice(0, 20) : '';
    const code = typeof data?.code === 'string' ? data.code.trim().slice(0, 8) : '';
    if (!code) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu mã OTP.');
    }
    if (!forLocationAdd && !employeeId) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu mã nhân viên hoặc mã OTP.');
    }
    try {
      if (forLocationAdd) {
        const { verifyLocationAddOtp } = await import('./location-add-otp');
        await verifyLocationAddOtp(admin.firestore(), code);
        return { ok: true };
      }
      const { verifyLocationUnlockOtp } = await import('./location-unlock-otp');
      const result = await verifyLocationUnlockOtp(admin.firestore(), employeeId, code);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('không đúng') || msg.includes('hết hạn') || msg.includes('Chưa có')
          ? 'failed-precondition'
          : 'internal',
        msg
      );
    }
  });

/** Location tab: gửi mã OTP 4 số qua Zalo tới ASP0106 để thêm vị trí mới. */
export const requestLocationAddOtpFn = functions
  .runWith({ secrets: [zaloBotToken] })
  .https.onCall(async (data: Record<string, unknown>, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const requestedBy = typeof data?.requestedBy === 'string' ? data.requestedBy.trim().slice(0, 20) : '';
    const locationName = typeof data?.locationName === 'string' ? data.locationName.trim().slice(0, 80) : '';
    try {
      const { requestLocationAddOtp } = await import('./location-add-otp');
      await requestLocationAddOtp(admin.firestore(), requestedBy, locationName);
      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('Thiếu') || msg.includes('zalo_links') ? 'failed-precondition' : 'internal',
        msg
      );
    }
  });

/** Location tab: xác nhận mã OTP thêm vị trí mới. */
export const verifyLocationAddOtpFn = functions
  .runWith({ secrets: [zaloBotToken] })
  .https.onCall(async (data: Record<string, unknown>, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const code = typeof data?.code === 'string' ? data.code.trim().slice(0, 8) : '';
    if (!code) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu mã OTP.');
    }
    try {
      const { verifyLocationAddOtp } = await import('./location-add-otp');
      const result = await verifyLocationAddOtp(admin.firestore(), code);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('không đúng') || msg.includes('hết hạn') || msg.includes('Chưa có')
          ? 'failed-precondition'
          : 'internal',
        msg
      );
    }
  });

/** Equipment: hoàn thành bài kiểm tra kho → lưu file hình lên Storage + Firestore. */
export const saveWarehouseTrainingQuizImageFn = functions.https.onCall(async (data: any, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
  }
  const imageDataUrl = typeof data?.imageDataUrl === 'string' ? data.imageDataUrl : '';
  if (!imageDataUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'Thiếu imageDataUrl.');
  }
  try {
    const { saveWarehouseTrainingQuizImage } = await import('./warehouse-training-quiz-storage');
    const result = await saveWarehouseTrainingQuizImage(admin.firestore(), {
      employeeId: typeof data?.employeeId === 'string' ? data.employeeId : '',
      fullName: typeof data?.fullName === 'string' ? data.fullName : '',
      joinDate: typeof data?.joinDate === 'string' ? data.joinDate : '',
      sectionId: typeof data?.sectionId === 'string' ? data.sectionId : '',
      sectionTitle: typeof data?.sectionTitle === 'string' ? data.sectionTitle : '',
      resultText: typeof data?.resultText === 'string' ? data.resultText : '',
      imageDataUrl
    });
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new functions.https.HttpsError('internal', msg);
  }
});

/** Equipment: hoàn thành bài kiểm tra kho → gửi mail WH1–WH4 đính kèm PDF. */
export const sendWarehouseTrainingQuizPdfEmailFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data: any, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const pdfDataUrl = typeof data?.pdfDataUrl === 'string' ? data.pdfDataUrl : '';
    if (!pdfDataUrl) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu pdfDataUrl.');
    }
    try {
      const { sendWarehouseTrainingQuizPdfEmail } = await import('./warehouse-training-quiz-email');
      const result = await sendWarehouseTrainingQuizPdfEmail({
        employeeId: typeof data?.employeeId === 'string' ? data.employeeId : '',
        fullName: typeof data?.fullName === 'string' ? data.fullName : '',
        joinDate: typeof data?.joinDate === 'string' ? data.joinDate : '',
        resultText: typeof data?.resultText === 'string' ? data.resultText : '',
        sectionId: typeof data?.sectionId === 'string' ? data.sectionId : '',
        pdfDataUrl
      });
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('Thiếu SMTP') ? 'failed-precondition' : 'internal',
        msg
      );
    }
  });

/**
 * QC Monthly Report:
 * - Schedule: 08:00 ngày 1 hằng tháng (VN) → gửi report tháng vừa rồi
 * - Manual: callable từ UI → gửi report từ đầu tháng tới thời điểm bấm
 */
export const sendQcMonthlyReportAtMonthStart = functions
  .runWith({ secrets: [emailPass] })
  .pubsub.schedule('0 8 1 * *')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async () => {
    const { sendQcMonthlyReport } = await import('./qc-monthly-report');
    await sendQcMonthlyReport(admin.firestore(), { factory: 'ASM1', mode: 'previousMonth' });
  });

/**
 * Print Label: 08:00 hằng ngày (VN) — gửi mail danh sách mã chưa Done và đã quá Ngày nhận kế hoạch.
 * Danh sách người nhận: Firestore `print-label-settings/late-notification-emails` (emails[]).
 */
export const notifyPrintLabelLateItemsDaily = functions
  .runWith({ secrets: [emailPass] })
  .pubsub.schedule('0 8 * * *')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async () => {
    const { runPrintLabelLateNotify } = await import('./print-label-late-notify');
    await runPrintLabelLateNotify(admin.firestore());
  });

/**
 * FG Overview: T2–T6 (Asia/Ho_Chi_Minh) — nếu quá 1 ngày chưa import tồn kho thì gửi email WH.
 * Nguồn: `fg-overview-import-cache/current-asm1` và `current-asm2` (field `updatedAt`).
 */
export const notifyFgOverviewMissingImportWeekdays = functions
  .runWith({ secrets: [emailPass] })
  .pubsub.schedule('0 8 * * 1-5')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async () => {
    const { runFgOverviewImportNotify } = await import('./fg-overview-import-notify');
    await runFgOverviewImportNotify(admin.firestore());
  });

/** Callable: chạy thủ công cùng logic báo tem trễ kế hoạch (More → Danh sách mail). */
export const sendPrintLabelLateNotifyManualFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
      const { runPrintLabelLateNotify } = await import('./print-label-late-notify');
      const r = await runPrintLabelLateNotify(admin.firestore());
      return {
        ok: true,
        sent: r.sent,
        lateCount: r.lateCount,
        recipientCount: r.recipientCount
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('Thiếu') ? 'failed-precondition' : 'internal',
        msg
      );
    }
  });

/**
 * Putaway Hold: thứ 2 hằng tuần 08:00 (VN) — gửi mail chi tiết mã Hold tại khu IQC.
 * Danh sách người nhận: Firestore `qc-settings/hold-notification-emails` (cấu hình tab QC → More).
 */
export const notifyPutawayHoldWeekly = functions
  .runWith({ secrets: [emailPass] })
  .pubsub.schedule('0 8 * * 1')
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async () => {
    const { runPutawayHoldWeeklyEmail } = await import('./putaway-hold-weekly-email');
    await runPutawayHoldWeeklyEmail(admin.firestore());
  });

/** Callable: gửi thử báo cáo Hold Putaway (tab QC → More → Mail Hold Putaway). */
export const sendPutawayHoldWeeklyEmailManualFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
      const { runPutawayHoldWeeklyEmail } = await import('./putaway-hold-weekly-email');
      const r = await runPutawayHoldWeeklyEmail(admin.firestore());
      return {
        ok: true,
        sent: r.sent,
        holdMaterialCount: r.holdMaterialCount,
        holdSkuCount: r.holdSkuCount,
        recipientCount: r.recipientCount
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new functions.https.HttpsError(
        msg.includes('Thiếu') ? 'failed-precondition' : 'internal',
        msg
      );
    }
  });

export const sendQcMonthlyReportManualFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data: { factory?: string; mode?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const factory = (typeof data?.factory === 'string' ? data.factory.trim().toUpperCase() : 'ASM1') as 'ASM1';
    const modeRaw = typeof data?.mode === 'string' ? data.mode.trim() : 'currentMonthToDate';
    const mode = (modeRaw === 'previousMonth' ? 'previousMonth' : 'currentMonthToDate') as
      | 'previousMonth'
      | 'currentMonthToDate';
    if (factory !== 'ASM1') {
      throw new functions.https.HttpsError('invalid-argument', 'Chỉ hỗ trợ factory ASM1.');
    }
    try {
      const { sendQcMonthlyReport } = await import('./qc-monthly-report');
      const r = await sendQcMonthlyReport(admin.firestore(), { factory, mode });
      return { ok: true, total: r.total };
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
      const { adminUpdateUserPassword } = await import('./admin-update-user-password');
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
      const { adminResetUserPassword } = await import('./admin-update-user-password');
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
export const adminSetUserPasswordByEmployeeIdFn = functions.https.onCall(
  async (data: { employeeId?: string; newPassword?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }

    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
    const newPassword = typeof data?.newPassword === 'string' ? data.newPassword : '';

    if (!employeeId || !newPassword) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId hoặc newPassword.');
    }

    try {
      const { adminSetUserPasswordByEmployeeId } = await import('./admin-update-user-password');
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

/** Admin: xóa user theo mã nhân viên (Auth + Firestore). */
export const adminDeleteUserByEmployeeIdFn = functions
  .https.onCall(async (data: { employeeId?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }

    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
    if (!employeeId) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId.');
    }

    try {
      const { adminDeleteUserByEmployeeId } = await import('./admin-sync-auth-users');
      const r = await adminDeleteUserByEmployeeId(context.auth.uid, employeeId);
      return r;
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới xóa được user.');
      }
      if (msg.includes('Không tìm thấy Firebase Auth user')) {
        throw new functions.https.HttpsError('not-found', msg);
      }
      if (msg.includes('Không thể xóa chính')) {
        throw new functions.https.HttpsError('failed-precondition', msg);
      }

      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  });

/** Admin: sửa tên, bộ phận, email đăng nhập (Auth + Firestore). */
export const adminUpdateUserProfileFn = functions.https.onCall(
  async (
    data: { uid?: string; displayName?: string; department?: string; email?: string; employeeId?: string },
    context
  ) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }

    const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';
    if (!uid) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu uid.');
    }

    try {
      const { adminUpdateUserProfile } = await import('./admin-update-user-profile');
      const r = await adminUpdateUserProfile(context.auth.uid, uid, {
        displayName: data.displayName,
        department: data.department,
        email: data.email,
        employeeId: data.employeeId
      });
      return { ok: true, email: r.email, employeeId: r.employeeId };
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Chỉ Admin/Quản lý mới sửa được hồ sơ.'
        );
      }
      if (msg.includes('đã được dùng')) {
        throw new functions.https.HttpsError('already-exists', msg);
      }
      if (msg.includes('không đúng định dạng') || msg.includes('không hợp lệ')) {
        throw new functions.https.HttpsError('invalid-argument', msg);
      }

      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  }
);

/** Admin: đăng ký user — mật khẩu 6 số gửi email (Auth + Firestore + SMTP). */
export const registerAspUserWithEmailFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data: { employeeId?: string; department?: string; email?: string; fullName?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }

    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
    const department = typeof data?.department === 'string' ? data.department : '';
    const email = typeof data?.email === 'string' ? data.email.trim() : '';
    const fullName = typeof data?.fullName === 'string' ? data.fullName.trim() : '';
    if (!employeeId || !email || !fullName) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId, email hoặc họ tên.');
    }

    try {
      const { registerAspUserWithEmail } = await import('./admin-register-user');
      return await registerAspUserWithEmail(context.auth.uid, employeeId, department, email, fullName);
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới đăng ký được.');
      }
      if (msg.includes('đã được dùng') || msg.includes('đã được đăng ký')) {
        throw new functions.https.HttpsError('already-exists', msg);
      }
      if (
        msg.includes('không đúng') ||
        msg.includes('không hợp lệ') ||
        msg.includes('Thiếu') ||
        msg.includes('phải có đuôi')
      ) {
        throw new functions.https.HttpsError('invalid-argument', msg);
      }

      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  });

/** Admin: đăng ký user không cần email — mật khẩu trả về cho admin (Auth + Firestore). */
export const registerAspUserWithoutEmailFn = functions.https.onCall(
  async (data: { employeeId?: string; department?: string; fullName?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }

    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
    const department = typeof data?.department === 'string' ? data.department : '';
    const fullName = typeof data?.fullName === 'string' ? data.fullName.trim() : '';
    if (!employeeId || !fullName) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId hoặc họ tên.');
    }

    try {
      const { registerAspUserWithoutEmail } = await import('./admin-register-user');
      return await registerAspUserWithoutEmail(context.auth.uid, employeeId, department, fullName);
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg === 'permission-denied' || code === 'permission-denied') {
        throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới đăng ký được.');
      }
      if (msg.includes('đã được dùng') || msg.includes('đã được đăng ký')) {
        throw new functions.https.HttpsError('already-exists', msg);
      }
      if (msg.includes('không đúng') || msg.includes('không hợp lệ') || msg.includes('Thiếu')) {
        throw new functions.https.HttpsError('invalid-argument', msg);
      }

      throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
  }
);

/**
 * Đăng ký từ trang login (không cần đăng nhập).
 * Cảnh báo: có thể bị lạm dụng — nên bật App Check / giới hạn IP nếu cần.
 */
export const publicRegisterAspUserFn = functions
  .runWith({ secrets: [emailPass] })
  .https.onCall(async (data: { employeeId?: string; department?: string; email?: string; fullName?: string }, _context) => {
    const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
    const department = typeof data?.department === 'string' ? data.department : '';
    const email = typeof data?.email === 'string' ? data.email.trim() : '';
    const fullName = typeof data?.fullName === 'string' ? data.fullName.trim() : '';
    if (!employeeId || !email || !fullName) {
      throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId, email hoặc họ tên.');
    }

    try {
      const { publicRegisterAspUserWithEmail } = await import('./admin-register-user');
      return await publicRegisterAspUserWithEmail(employeeId, department, email, fullName);
    } catch (e: unknown) {
      const anyErr = e as any;
      const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
      const code = typeof anyErr?.code === 'string' ? anyErr.code : '';

      if (msg.includes('đã được dùng') || msg.includes('đã được đăng ký')) {
        throw new functions.https.HttpsError('already-exists', msg);
      }
      if (
        msg.includes('không đúng') ||
        msg.includes('không hợp lệ') ||
        msg.includes('Thiếu') ||
        msg.includes('phải có đuôi')
      ) {
        throw new functions.https.HttpsError('invalid-argument', msg);
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
      const { adminDeleteAuthUsersNotInSettings } = await import('./admin-sync-auth-users');
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

/**
 * Đăng nhập bằng mã ASPxxxx: tra email thật trong Firestore (users.employeeId) để signIn đúng tài khoản
 * đăng ký qua mail (@airspeedmfgvn.com), không chỉ asp####@asp.com.
 */
export const lookupAuthLoginEmailByEmployeeIdFn = functions.https.onCall(async (data: { employeeId?: string }) => {
  const raw = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
  if (!raw) {
    throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId.');
  }

  try {
    const { lookupAuthLoginEmailByEmployeeId } = await import('./lookup-login-email');
    const email = await lookupAuthLoginEmailByEmployeeId(raw);
    return { email };
  } catch (e: unknown) {
    const anyErr = e as any;
    const msg = anyErr instanceof Error ? anyErr.message : anyErr?.message ?? String(e);
    throw new functions.https.HttpsError('internal', msg || 'Lỗi tra cứu email.');
  }
});

/** Đăng nhập tài xế app phụ Xe Tải: XETAI / 1234 */
export const truckDriverSignInFn = functions.https.onCall(async (data: { employeeId?: string; password?: string }) => {
  const employeeId = typeof data?.employeeId === 'string' ? data.employeeId.trim() : '';
  const password = typeof data?.password === 'string' ? data.password : '';
  if (!employeeId || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'Thiếu mã hoặc mật khẩu.');
  }

  try {
    const { signInTruckDriver } = await import('./truck-driver-auth');
    return await signInTruckDriver(employeeId, password);
  } catch (e: unknown) {
    const anyErr = e as any;
    const msg = (anyErr instanceof Error ? anyErr.message : anyErr?.message) ?? String(e);
    if (msg === 'permission-denied') {
      throw new functions.https.HttpsError('permission-denied', 'Mã hoặc mật khẩu không đúng.');
    }
    throw new functions.https.HttpsError('internal', msg || 'Đăng nhập thất bại.');
  }
});
