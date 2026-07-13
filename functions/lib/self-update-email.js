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
exports.selfUpdateCompanyEmail = selfUpdateCompanyEmail;
const admin = __importStar(require("firebase-admin"));
function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
/** Chỉ chấp nhận email công ty thật khi tự cập nhật (không phải admin thao tác hộ). */
function isCompanyEmail(email) {
    const e = (email || '').trim().toLowerCase();
    return e.endsWith('@airspeedmfgvn.com') || e.endsWith('@airspeedmfg.com');
}
/**
 * Tự cập nhật email công ty cho chính tài khoản đang đăng nhập (Firebase Auth + Firestore).
 * Dùng cho popup bắt buộc "Cập nhật email công ty" ở lần đăng nhập tiếp theo (tài khoản
 * không thuộc bộ phận WH và chưa có email công ty thật).
 */
async function selfUpdateCompanyEmail(uid, emailRaw) {
    if (!uid) {
        throw new Error('Thiếu uid.');
    }
    const email = (emailRaw || '').trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
        throw new Error('Email không hợp lệ.');
    }
    if (!isCompanyEmail(email)) {
        throw new Error('Chỉ chấp nhận email công ty (@airspeedmfgvn.com hoặc @airspeedmfg.com).');
    }
    try {
        const existing = await admin.auth().getUserByEmail(email);
        if (existing.uid !== uid) {
            throw new Error('Email đã được dùng cho tài khoản khác.');
        }
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.message) && e.message.includes('đã được dùng')) {
            throw e;
        }
        if ((e === null || e === void 0 ? void 0 : e.code) !== 'auth/user-not-found') {
            throw e;
        }
    }
    await admin.auth().updateUser(uid, { email });
    const now = new Date();
    const merge = { email, updatedAt: now };
    await admin.firestore().collection('users').doc(uid).set(merge, { merge: true });
    await admin.firestore().collection('user-permissions').doc(uid).set(merge, { merge: true });
    await admin.firestore().collection('user-tab-permissions').doc(uid).set(merge, { merge: true });
    return { email };
}
//# sourceMappingURL=self-update-email.js.map