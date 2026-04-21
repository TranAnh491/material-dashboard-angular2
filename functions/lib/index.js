"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupAuthLoginEmailByEmployeeIdFn = exports.adminDeleteAuthUsersNotInSettingsFn = exports.publicRegisterAspUserFn = exports.registerAspUserWithEmailFn = exports.adminUpdateUserProfileFn = exports.adminDeleteUserByEmployeeIdFn = exports.adminSetUserPasswordByEmployeeIdFn = exports.adminResetUserPasswordFn = exports.adminUpdateUserPasswordFn = exports.sendQcMonthlyReportManualFn = exports.sendPrintLabelLateNotifyManualFn = exports.notifyPrintLabelLateItemsDaily = exports.sendQcMonthlyReportAtMonthStart = exports.sendQcPriorityStatusChangedZaloFn = exports.sendQcPriorityResolvedEmailFn = exports.sendControlBatchReportEmail = exports.notifyOutboundDuplicatesAt20 = exports.notifyOutboundDuplicatesEvery5MinAfternoon = exports.notifyOutboundDuplicatesEvery5MinNoon = exports.notifyOutboundDuplicatesEvery5MinMorning = exports.notifyOutboundDuplicatesAt17 = exports.notifyOutboundDuplicatesAt12 = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
admin.initializeApp();
/**
 * Control Batch: 12:00 và 17:00 (Asia/Ho_Chi_Minh) quét trùng xuất outbound; có trùng thì gửi email.
 * Secret: EMAIL_PASS — chuỗi: EMAIL_USER, EMAIL_TO, … (xem params-config.ts).
 */
exports.notifyOutboundDuplicatesAt12 = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .pubsub.schedule('0 12 * * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    const { runOutboundDupNotifyForSlot } = await Promise.resolve().then(() => __importStar(require('./outbound-dup-notify')));
    await runOutboundDupNotifyForSlot(admin.firestore(), '12');
});
exports.notifyOutboundDuplicatesAt17 = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .pubsub.schedule('0 17 * * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    const { runOutboundDupNotifyForSlot } = await Promise.resolve().then(() => __importStar(require('./outbound-dup-notify')));
    await runOutboundDupNotifyForSlot(admin.firestore(), '17');
});
/**
 * Control Batch: chạy mỗi 5 phút theo khung giờ (T2–T7):
 * - 08:00–12:15
 * - 13:15–20:00
 * Nhóm đã gửi sẽ không gửi lại.
 */
const runOutboundDupNotify5m = async () => {
    const { runOutboundDupNotifyEvery30Min } = await Promise.resolve().then(() => __importStar(require('./outbound-dup-notify')));
    await runOutboundDupNotifyEvery30Min(admin.firestore());
};
exports.notifyOutboundDuplicatesEvery5MinMorning = functions
    .runWith({ secrets: [params_config_1.emailPass, params_config_1.zaloBotToken] })
    .pubsub.schedule('*/5 8-11 * * 1-6')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(runOutboundDupNotify5m);
exports.notifyOutboundDuplicatesEvery5MinNoon = functions
    .runWith({ secrets: [params_config_1.emailPass, params_config_1.zaloBotToken] })
    .pubsub.schedule('0-15/5 12 * * 1-6')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(runOutboundDupNotify5m);
exports.notifyOutboundDuplicatesEvery5MinAfternoon = functions
    .runWith({ secrets: [params_config_1.emailPass, params_config_1.zaloBotToken] })
    .pubsub.schedule('*/5 13-19 * * 1-6')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(runOutboundDupNotify5m);
exports.notifyOutboundDuplicatesAt20 = functions
    .runWith({ secrets: [params_config_1.emailPass, params_config_1.zaloBotToken] })
    .pubsub.schedule('0 20 * * 1-6')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(runOutboundDupNotify5m);
/** Callable: gửi mail báo cáo trùng xuất tại thời điểm gọi (nút Send Mail — Control Batch). */
exports.sendControlBatchReportEmail = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
        const { buildControlBatchDupSettingsFromCallablePayload, loadControlBatchDupSettings, sendOutboundDupReportManual } = await Promise.resolve().then(() => __importStar(require('./outbound-dup-notify')));
        const db = admin.firestore();
        const fromUi = buildControlBatchDupSettingsFromCallablePayload(data);
        const settings = fromUi !== null && fromUi !== void 0 ? fromUi : (await loadControlBatchDupSettings(db));
        const r = await sendOutboundDupReportManual(db, settings);
        return { ok: true, dupGroups: r.dupGroups };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError(msg.includes('Thiếu cấu hình') ? 'failed-precondition' : 'internal', msg);
    }
});
/** QC: mã ưu tiên trong Chờ kiểm, từ CHỜ KIỂM → trạng thái khác → gửi mail QC_PRIORITY_EMAIL_TO. */
exports.sendQcPriorityResolvedEmailFn = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const materialCode = typeof (data === null || data === void 0 ? void 0 : data.materialCode) === 'string' ? data.materialCode.trim().slice(0, 120) : '';
    const poNumber = typeof (data === null || data === void 0 ? void 0 : data.poNumber) === 'string' ? data.poNumber.trim().slice(0, 120) : '';
    const imd = typeof (data === null || data === void 0 ? void 0 : data.imd) === 'string' ? data.imd.trim().slice(0, 120) : '';
    const location = typeof (data === null || data === void 0 ? void 0 : data.location) === 'string' ? data.location.trim().slice(0, 120) : '';
    const factory = typeof (data === null || data === void 0 ? void 0 : data.factory) === 'string' ? data.factory.trim().slice(0, 40) : 'ASM1';
    const oldStatus = typeof (data === null || data === void 0 ? void 0 : data.oldStatus) === 'string' ? data.oldStatus.trim().slice(0, 80) : '';
    const newStatus = typeof (data === null || data === void 0 ? void 0 : data.newStatus) === 'string' ? data.newStatus.trim().slice(0, 80) : '';
    const checkedBy = typeof (data === null || data === void 0 ? void 0 : data.checkedBy) === 'string' ? data.checkedBy.trim().slice(0, 80) : '';
    if (!materialCode || !newStatus) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu materialCode hoặc newStatus.');
    }
    const payload = {
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
        const { sendQcPriorityResolvedEmail } = await Promise.resolve().then(() => __importStar(require('./qc-priority-email')));
        await sendQcPriorityResolvedEmail(payload);
        return { ok: true };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError(msg.includes('Thiếu') ? 'failed-precondition' : 'internal', msg);
    }
});
/** QC (ASM1): nếu mã đang bật ưu tiên và bị đổi trạng thái → nhắn Zalo cho ASP0609. */
exports.sendQcPriorityStatusChangedZaloFn = functions
    .runWith({ secrets: [params_config_1.zaloBotToken] })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const materialCode = typeof (data === null || data === void 0 ? void 0 : data.materialCode) === 'string' ? data.materialCode.trim().slice(0, 120) : '';
    const poNumber = typeof (data === null || data === void 0 ? void 0 : data.poNumber) === 'string' ? data.poNumber.trim().slice(0, 120) : '';
    const imd = typeof (data === null || data === void 0 ? void 0 : data.imd) === 'string' ? data.imd.trim().slice(0, 120) : '';
    const location = typeof (data === null || data === void 0 ? void 0 : data.location) === 'string' ? data.location.trim().slice(0, 120) : '';
    const factory = typeof (data === null || data === void 0 ? void 0 : data.factory) === 'string' ? data.factory.trim().slice(0, 40) : 'ASM1';
    const oldStatus = typeof (data === null || data === void 0 ? void 0 : data.oldStatus) === 'string' ? data.oldStatus.trim().slice(0, 80) : '';
    const newStatus = typeof (data === null || data === void 0 ? void 0 : data.newStatus) === 'string' ? data.newStatus.trim().slice(0, 80) : '';
    const checkedBy = typeof (data === null || data === void 0 ? void 0 : data.checkedBy) === 'string' ? data.checkedBy.trim().slice(0, 80) : '';
    if (!materialCode || !newStatus) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu materialCode hoặc newStatus.');
    }
    if (factory.toUpperCase() !== 'ASM1') {
        throw new functions.https.HttpsError('invalid-argument', 'Chỉ hỗ trợ factory ASM1.');
    }
    const payload = {
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
        const { sendQcPriorityStatusChangedZalo } = await Promise.resolve().then(() => __importStar(require('./qc-priority-zalo')));
        await sendQcPriorityStatusChangedZalo(admin.firestore(), payload);
        return { ok: true };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError(msg.includes('Thiếu') || msg.includes('zalo_links') ? 'failed-precondition' : 'internal', msg);
    }
});
/**
 * QC Monthly Report:
 * - Schedule: 08:00 ngày 1 hằng tháng (VN) → gửi report tháng vừa rồi
 * - Manual: callable từ UI → gửi report từ đầu tháng tới thời điểm bấm
 */
exports.sendQcMonthlyReportAtMonthStart = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .pubsub.schedule('0 8 1 * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    const { sendQcMonthlyReport } = await Promise.resolve().then(() => __importStar(require('./qc-monthly-report')));
    await sendQcMonthlyReport(admin.firestore(), { factory: 'ASM1', mode: 'previousMonth' });
});
/**
 * Print Label: 08:00 hằng ngày (VN) — gửi mail danh sách mã chưa Done và đã quá Ngày nhận kế hoạch.
 * Danh sách người nhận: Firestore `print-label-settings/late-notification-emails` (emails[]).
 */
exports.notifyPrintLabelLateItemsDaily = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .pubsub.schedule('0 8 * * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    const { runPrintLabelLateNotify } = await Promise.resolve().then(() => __importStar(require('./print-label-late-notify')));
    await runPrintLabelLateNotify(admin.firestore());
});
/** Callable: chạy thủ công cùng logic báo tem trễ kế hoạch (More → Danh sách mail). */
exports.sendPrintLabelLateNotifyManualFn = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
        const { runPrintLabelLateNotify } = await Promise.resolve().then(() => __importStar(require('./print-label-late-notify')));
        const r = await runPrintLabelLateNotify(admin.firestore());
        return {
            ok: true,
            sent: r.sent,
            lateCount: r.lateCount,
            recipientCount: r.recipientCount
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError(msg.includes('Thiếu') ? 'failed-precondition' : 'internal', msg);
    }
});
exports.sendQcMonthlyReportManualFn = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const factory = (typeof (data === null || data === void 0 ? void 0 : data.factory) === 'string' ? data.factory.trim().toUpperCase() : 'ASM1');
    const modeRaw = typeof (data === null || data === void 0 ? void 0 : data.mode) === 'string' ? data.mode.trim() : 'currentMonthToDate';
    const mode = (modeRaw === 'previousMonth' ? 'previousMonth' : 'currentMonthToDate');
    if (factory !== 'ASM1') {
        throw new functions.https.HttpsError('invalid-argument', 'Chỉ hỗ trợ factory ASM1.');
    }
    try {
        const { sendQcMonthlyReport } = await Promise.resolve().then(() => __importStar(require('./qc-monthly-report')));
        const r = await sendQcMonthlyReport(admin.firestore(), { factory, mode });
        return { ok: true, total: r.total };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError(msg.includes('Thiếu') ? 'failed-precondition' : 'internal', msg);
    }
});
/** Admin: đổi password user theo uid (không cần password hiện tại). */
exports.adminUpdateUserPasswordFn = functions
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const uid = typeof (data === null || data === void 0 ? void 0 : data.uid) === 'string' ? data.uid.trim() : '';
    const newPassword = typeof (data === null || data === void 0 ? void 0 : data.newPassword) === 'string' ? data.newPassword : '';
    if (!uid || !newPassword) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu uid hoặc newPassword.');
    }
    try {
        const { adminUpdateUserPassword } = await Promise.resolve().then(() => __importStar(require('./admin-update-user-password')));
        await adminUpdateUserPassword(context.auth.uid, uid, newPassword);
        return { ok: true };
    }
    catch (e) {
        const anyErr = e;
        const msg = (_a = (anyErr instanceof Error ? anyErr.message : anyErr === null || anyErr === void 0 ? void 0 : anyErr.message)) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
        if (msg === 'permission-denied' || code === 'permission-denied') {
            throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới đổi được password.');
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
exports.adminResetUserPasswordFn = functions
    .https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const uid = typeof (data === null || data === void 0 ? void 0 : data.uid) === 'string' ? data.uid.trim() : '';
    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu uid.');
    }
    try {
        const { adminResetUserPassword } = await Promise.resolve().then(() => __importStar(require('./admin-update-user-password')));
        const newPassword = await adminResetUserPassword(context.auth.uid, uid);
        return { ok: true, newPassword };
    }
    catch (e) {
        const anyErr = e;
        const msg = (_a = (anyErr instanceof Error ? anyErr.message : anyErr === null || anyErr === void 0 ? void 0 : anyErr.message)) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
        console.error('❌ adminResetUserPasswordFn error:', {
            callerUid: (_b = context.auth) === null || _b === void 0 ? void 0 : _b.uid,
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
exports.adminSetUserPasswordByEmployeeIdFn = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const employeeId = typeof (data === null || data === void 0 ? void 0 : data.employeeId) === 'string' ? data.employeeId.trim() : '';
    const newPassword = typeof (data === null || data === void 0 ? void 0 : data.newPassword) === 'string' ? data.newPassword : '';
    if (!employeeId || !newPassword) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId hoặc newPassword.');
    }
    try {
        const { adminSetUserPasswordByEmployeeId } = await Promise.resolve().then(() => __importStar(require('./admin-update-user-password')));
        const r = await adminSetUserPasswordByEmployeeId(context.auth.uid, employeeId, newPassword);
        return { ok: true, uid: r.uid, email: r.email };
    }
    catch (e) {
        const anyErr = e;
        const msg = (_a = (anyErr instanceof Error ? anyErr.message : anyErr === null || anyErr === void 0 ? void 0 : anyErr.message)) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
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
exports.adminDeleteUserByEmployeeIdFn = functions
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const employeeId = typeof (data === null || data === void 0 ? void 0 : data.employeeId) === 'string' ? data.employeeId.trim() : '';
    if (!employeeId) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId.');
    }
    try {
        const { adminDeleteUserByEmployeeId } = await Promise.resolve().then(() => __importStar(require('./admin-sync-auth-users')));
        const r = await adminDeleteUserByEmployeeId(context.auth.uid, employeeId);
        return r;
    }
    catch (e) {
        const anyErr = e;
        const msg = (_a = (anyErr instanceof Error ? anyErr.message : anyErr === null || anyErr === void 0 ? void 0 : anyErr.message)) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
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
exports.adminUpdateUserProfileFn = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const uid = typeof (data === null || data === void 0 ? void 0 : data.uid) === 'string' ? data.uid.trim() : '';
    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu uid.');
    }
    try {
        const { adminUpdateUserProfile } = await Promise.resolve().then(() => __importStar(require('./admin-update-user-profile')));
        const r = await adminUpdateUserProfile(context.auth.uid, uid, {
            displayName: data.displayName,
            department: data.department,
            email: data.email
        });
        return { ok: true, email: r.email };
    }
    catch (e) {
        const anyErr = e;
        const msg = (_a = (anyErr instanceof Error ? anyErr.message : anyErr === null || anyErr === void 0 ? void 0 : anyErr.message)) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
        if (msg === 'permission-denied' || code === 'permission-denied') {
            throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới sửa được hồ sơ.');
        }
        if (msg.includes('đã được dùng')) {
            throw new functions.https.HttpsError('already-exists', msg);
        }
        if (msg.includes('không hợp lệ')) {
            throw new functions.https.HttpsError('invalid-argument', msg);
        }
        throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
});
/** Admin: đăng ký user — mật khẩu 6 số gửi email (Auth + Firestore + SMTP). */
exports.registerAspUserWithEmailFn = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const employeeId = typeof (data === null || data === void 0 ? void 0 : data.employeeId) === 'string' ? data.employeeId.trim() : '';
    const department = typeof (data === null || data === void 0 ? void 0 : data.department) === 'string' ? data.department : '';
    const email = typeof (data === null || data === void 0 ? void 0 : data.email) === 'string' ? data.email.trim() : '';
    const fullName = typeof (data === null || data === void 0 ? void 0 : data.fullName) === 'string' ? data.fullName.trim() : '';
    if (!employeeId || !email || !fullName) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId, email hoặc họ tên.');
    }
    try {
        const { registerAspUserWithEmail } = await Promise.resolve().then(() => __importStar(require('./admin-register-user')));
        return await registerAspUserWithEmail(context.auth.uid, employeeId, department, email, fullName);
    }
    catch (e) {
        const anyErr = e;
        const msg = (_a = (anyErr instanceof Error ? anyErr.message : anyErr === null || anyErr === void 0 ? void 0 : anyErr.message)) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
        if (msg === 'permission-denied' || code === 'permission-denied') {
            throw new functions.https.HttpsError('permission-denied', 'Chỉ Admin/Quản lý mới đăng ký được.');
        }
        if (msg.includes('đã được dùng') || msg.includes('đã được đăng ký')) {
            throw new functions.https.HttpsError('already-exists', msg);
        }
        if (msg.includes('không đúng') ||
            msg.includes('không hợp lệ') ||
            msg.includes('Thiếu') ||
            msg.includes('phải có đuôi')) {
            throw new functions.https.HttpsError('invalid-argument', msg);
        }
        throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
});
/**
 * Đăng ký từ trang login (không cần đăng nhập).
 * Cảnh báo: có thể bị lạm dụng — nên bật App Check / giới hạn IP nếu cần.
 */
exports.publicRegisterAspUserFn = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, _context) => {
    var _a;
    const employeeId = typeof (data === null || data === void 0 ? void 0 : data.employeeId) === 'string' ? data.employeeId.trim() : '';
    const department = typeof (data === null || data === void 0 ? void 0 : data.department) === 'string' ? data.department : '';
    const email = typeof (data === null || data === void 0 ? void 0 : data.email) === 'string' ? data.email.trim() : '';
    const fullName = typeof (data === null || data === void 0 ? void 0 : data.fullName) === 'string' ? data.fullName.trim() : '';
    if (!employeeId || !email || !fullName) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId, email hoặc họ tên.');
    }
    try {
        const { publicRegisterAspUserWithEmail } = await Promise.resolve().then(() => __importStar(require('./admin-register-user')));
        return await publicRegisterAspUserWithEmail(employeeId, department, email, fullName);
    }
    catch (e) {
        const anyErr = e;
        const msg = (_a = (anyErr instanceof Error ? anyErr.message : anyErr === null || anyErr === void 0 ? void 0 : anyErr.message)) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
        if (msg.includes('đã được dùng') || msg.includes('đã được đăng ký')) {
            throw new functions.https.HttpsError('already-exists', msg);
        }
        if (msg.includes('không đúng') ||
            msg.includes('không hợp lệ') ||
            msg.includes('Thiếu') ||
            msg.includes('phải có đuôi')) {
            throw new functions.https.HttpsError('invalid-argument', msg);
        }
        throw new functions.https.HttpsError('internal', msg || code || 'Lỗi không xác định.');
    }
});
/** Admin: xóa Firebase Auth users không nằm trong danh sách Settings (collection users/user-permissions). */
exports.adminDeleteAuthUsersNotInSettingsFn = functions
    .https.onCall(async (_data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
        const { adminDeleteAuthUsersNotInSettings } = await Promise.resolve().then(() => __importStar(require('./admin-sync-auth-users')));
        const r = await adminDeleteAuthUsersNotInSettings(context.auth.uid);
        return r;
    }
    catch (e) {
        const anyErr = e;
        const msg = anyErr instanceof Error ? anyErr.message : (_a = anyErr === null || anyErr === void 0 ? void 0 : anyErr.message) !== null && _a !== void 0 ? _a : String(e);
        const code = typeof (anyErr === null || anyErr === void 0 ? void 0 : anyErr.code) === 'string' ? anyErr.code : '';
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
exports.lookupAuthLoginEmailByEmployeeIdFn = functions.https.onCall(async (data) => {
    var _a;
    const raw = typeof (data === null || data === void 0 ? void 0 : data.employeeId) === 'string' ? data.employeeId.trim() : '';
    if (!raw) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu employeeId.');
    }
    try {
        const { lookupAuthLoginEmailByEmployeeId } = await Promise.resolve().then(() => __importStar(require('./lookup-login-email')));
        const email = await lookupAuthLoginEmailByEmployeeId(raw);
        return { email };
    }
    catch (e) {
        const anyErr = e;
        const msg = anyErr instanceof Error ? anyErr.message : (_a = anyErr === null || anyErr === void 0 ? void 0 : anyErr.message) !== null && _a !== void 0 ? _a : String(e);
        throw new functions.https.HttpsError('internal', msg || 'Lỗi tra cứu email.');
    }
});
//# sourceMappingURL=index.js.map