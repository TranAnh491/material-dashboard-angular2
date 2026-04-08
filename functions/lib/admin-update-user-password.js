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
function isAdminOrManager(role) {
    const r = (role || '').toString().trim().toLowerCase();
    const normalized = r
        // bỏ dấu tiếng Việt để so sánh ổn định
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
    return (normalized === 'admin' ||
        normalized === 'quan ly' ||
        normalized === 'quan ly ' ||
        normalized === 'quan ly\n' ||
        r === 'admin' ||
        r === 'quản lý' // fallback nếu môi trường không hỗ trợ regex diacritics
    );
}
/**
 * Đổi password cho user theo uid, chỉ dùng Admin SDK nên KHÔNG cần biết password hiện tại.
 * Đồng thời cập nhật field password trong Firestore để UI Settings hiển thị đúng.
 */
async function adminUpdateUserPassword(callerUid, targetUid, newPassword) {
    var _a;
    if (!callerUid || !targetUid) {
        throw new Error('Thiếu callerUid hoặc targetUid.');
    }
    if (!newPassword || newPassword.length < 6) {
        throw new Error('Password mới phải có ít nhất 6 ký tự.');
    }
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    const callerRole = (_a = callerDoc.data()) === null || _a === void 0 ? void 0 : _a.role;
    console.log('🔐 adminUpdateUserPassword', {
        callerUid,
        callerRole,
        targetUid,
        passwordLen: newPassword === null || newPassword === void 0 ? void 0 : newPassword.length
    });
    if (!isAdminOrManager(callerRole)) {
        throw new Error('permission-denied');
    }
    // Update Firebase Auth password
    await admin.auth().updateUser(targetUid, { password: newPassword });
    // Cập nhật lại password ở Firestore để màn hình Settings hiển thị đồng bộ.
    await admin.firestore().collection('users').doc(targetUid).set({ password: newPassword, updatedAt: new Date() }, { merge: true });
    await admin.firestore().collection('user-permissions').doc(targetUid).set({ password: newPassword, updatedAt: new Date() }, { merge: true });
}
function generateSixDigitPassword() {
    const n = Math.floor(100000 + Math.random() * 900000);
    return String(n);
}
/**
 * Admin: sinh mật khẩu mới 6 số ngẫu nhiên rồi đổi cho user theo uid.
 * Trả về password mới để Admin hiển thị/sao chép.
 */
async function adminResetUserPassword(callerUid, targetUid) {
    const newPassword = generateSixDigitPassword();
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
    await adminUpdateUserPassword(callerUid, foundUid, newPassword);
    return { uid: foundUid, email: foundEmail };
}
//# sourceMappingURL=admin-update-user-password.js.map