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
exports.adminDeleteAuthUsersNotInSettingsFn = exports.adminSetUserPasswordByEmployeeIdFn = exports.adminResetUserPasswordFn = exports.adminUpdateUserPasswordFn = exports.sendQcPriorityResolvedEmailFn = exports.sendControlBatchReportEmail = exports.notifyOutboundDuplicatesAt17 = exports.notifyOutboundDuplicatesAt12 = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const outbound_dup_notify_1 = require("./outbound-dup-notify");
const qc_priority_email_1 = require("./qc-priority-email");
const params_config_1 = require("./params-config");
const admin_update_user_password_1 = require("./admin-update-user-password");
const admin_sync_auth_users_1 = require("./admin-sync-auth-users");
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
    await (0, outbound_dup_notify_1.runOutboundDupNotifyForSlot)(admin.firestore(), '12');
});
exports.notifyOutboundDuplicatesAt17 = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .pubsub.schedule('0 17 * * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    await (0, outbound_dup_notify_1.runOutboundDupNotifyForSlot)(admin.firestore(), '17');
});
/** Callable: gửi mail báo cáo trùng xuất tại thời điểm gọi (nút Send Mail — Control Batch). */
exports.sendControlBatchReportEmail = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
        const r = await (0, outbound_dup_notify_1.sendOutboundDupReportManual)(admin.firestore());
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
        await (0, qc_priority_email_1.sendQcPriorityResolvedEmail)(payload);
        return { ok: true };
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
        await (0, admin_update_user_password_1.adminUpdateUserPassword)(context.auth.uid, uid, newPassword);
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
        const newPassword = await (0, admin_update_user_password_1.adminResetUserPassword)(context.auth.uid, uid);
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
exports.adminSetUserPasswordByEmployeeIdFn = functions
    .runWith({ secrets: [params_config_1.emailPass] })
    .https.onCall(async (data, context) => {
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
        const r = await (0, admin_update_user_password_1.adminSetUserPasswordByEmployeeId)(context.auth.uid, employeeId, newPassword);
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
/** Admin: xóa Firebase Auth users không nằm trong danh sách Settings (collection users/user-permissions). */
exports.adminDeleteAuthUsersNotInSettingsFn = functions
    .https.onCall(async (_data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    try {
        const r = await (0, admin_sync_auth_users_1.adminDeleteAuthUsersNotInSettings)(context.auth.uid);
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
//# sourceMappingURL=index.js.map