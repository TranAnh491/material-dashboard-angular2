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
exports.adminUpdateUserPassword = adminUpdateUserPassword;
exports.adminResetUserPassword = adminResetUserPassword;
exports.adminSetUserPasswordByEmployeeId = adminSetUserPasswordByEmployeeId;
const admin = __importStar(require("firebase-admin"));
const authz_1 = require("./authz");
/**
 * Đổi password cho user theo uid, chỉ dùng Admin SDK nên KHÔNG cần biết password hiện tại.
 * Không lưu password vào Firestore; mật khẩu mới được gửi về Zalo ASP0106 để chuyển cho nhân viên.
 * Trả về true nếu đã gửi Zalo.
 */
async function adminUpdateUserPassword(callerUid, targetUid, newPassword) {
    if (!callerUid || !targetUid) {
        throw new Error('Thiếu callerUid hoặc targetUid.');
    }
    if (!newPassword || newPassword.length < 6) {
        throw new Error('Password mới phải có ít nhất 6 ký tự.');
    }
    await (0, authz_1.assertAdmin)(callerUid);
    console.log('🔐 adminUpdateUserPassword', { callerUid, targetUid });
    await admin.auth().updateUser(targetUid, { password: newPassword });
    // Phiên đăng nhập cũ của user bị buộc đăng nhập lại.
    await admin.auth().revokeRefreshTokens(targetUid);
    // Xóa password cũ còn sót trong Firestore (dữ liệu trước khi ngừng lưu).
    const clear = { password: admin.firestore.FieldValue.delete(), updatedAt: new Date() };
    await admin.firestore().collection('users').doc(targetUid).set(clear, { merge: true });
    await admin.firestore().collection('user-permissions').doc(targetUid).set(clear, { merge: true });
    const profile = (await admin.firestore().collection('users').doc(targetUid).get()).data() || {};
    return (0, authz_1.sendNewPasswordsToAdminZalo)('Mật khẩu mới (đặt lại)', [{
            employeeId: String(profile.employeeId || targetUid),
            fullName: String(profile.displayName || ''),
            password: newPassword
        }]);
}
/**
 * Admin: sinh mật khẩu mới 6 số ngẫu nhiên rồi đổi cho user theo uid.
 * Trả về password mới để Admin hiển thị/sao chép.
 */
async function adminResetUserPassword(callerUid, targetUid) {
    const newPassword = (0, authz_1.randomSixDigitPassword)();
    await adminUpdateUserPassword(callerUid, targetUid, newPassword);
    return newPassword;
}
function normalizeAspEmployeeId(input) {
    const t = (input || '').trim().toUpperCase();
    if (!t)
        return null;
    const m1 = t.match(/^ASP(\d{4})$/);
    if (m1)
        return `ASP${m1[1]}`;
    const m2 = t.match(/^(\d{4})$/);
    if (m2)
        return `ASP${m2[1]}`;
    return null;
}
/**
 * Admin: đặt password cho user theo mã nhân viên ASP (ASPxxxx hoặc xxxx).
 * Lookup user bằng Firebase Auth (getUserByEmail) rồi update password theo uid.
 * Đồng thời cập nhật Firestore để UI hiển thị đúng.
 */
async function adminSetUserPasswordByEmployeeId(callerUid, employeeIdRaw, newPassword) {
    if (!callerUid)
        throw new Error('Thiếu callerUid.');
    if (!employeeIdRaw)
        throw new Error('Thiếu employeeId.');
    if (!newPassword || newPassword.length < 6) {
        throw new Error('Password mới phải có ít nhất 6 ký tự.');
    }
    const employeeId = normalizeAspEmployeeId(employeeIdRaw);
    if (!employeeId)
        throw new Error('employeeId không đúng định dạng (ASPxxxx hoặc xxxx).');
    await (0, authz_1.assertAdmin)(callerUid);
    const digits = employeeId.replace(/^ASP/, '');
    const emailCandidates = [
        // Legacy/đang dùng trong app Settings: asp0609@asp.com
        `asp${digits.toLowerCase()}@asp.com`,
        `asp${digits.toLowerCase()}@gmail.com`,
        // Một số môi trường cũ: 0609@asp.com
        `${digits.toLowerCase()}@asp.com`,
        `${digits.toLowerCase()}@gmail.com`
    ];
    let foundUid = null;
    let foundEmail = null;
    for (const email of emailCandidates) {
        try {
            const userRecord = await admin.auth().getUserByEmail(email);
            if (userRecord === null || userRecord === void 0 ? void 0 : userRecord.uid) {
                foundUid = userRecord.uid;
                foundEmail = email;
                break;
            }
        }
        catch (e) {
            // Nếu không tìm thấy email này thì thử candidate khác
            if ((e === null || e === void 0 ? void 0 : e.code) === 'auth/user-not-found')
                continue;
            throw e;
        }
    }
    // Đăng ký bằng email thật: tìm theo field employeeId trên Firestore
    if (!foundUid) {
        const fsSnap = await admin
            .firestore()
            .collection('users')
            .where('employeeId', '==', employeeId)
            .limit(1)
            .get();
        if (!fsSnap.empty) {
            foundUid = fsSnap.docs[0].id;
        }
    }
    if (!foundUid) {
        throw new Error(`Không tìm thấy Firebase Auth user theo mã ${employeeId}.`);
    }
    if (!foundEmail) {
        const authUser = await admin.auth().getUser(foundUid);
        foundEmail = authUser.email || '';
    }
    const zaloSent = await adminUpdateUserPassword(callerUid, foundUid, newPassword);
    return { uid: foundUid, email: foundEmail, zaloSent };
}
//# sourceMappingURL=admin-update-user-password.js.map