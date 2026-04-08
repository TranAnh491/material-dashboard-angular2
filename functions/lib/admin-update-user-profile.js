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
exports.adminUpdateUserProfile = adminUpdateUserProfile;
const admin = __importStar(require("firebase-admin"));
function isAdminOrManager(role) {
    const r = (role || '').toString().trim().toLowerCase();
    const normalized = r
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
    return (normalized === 'admin' ||
        normalized === 'quan ly' ||
        r === 'admin' ||
        r === 'quản lý');
}
function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
/**
 * Admin: cập nhật tên, bộ phận, email đăng nhập (Firebase Auth + Firestore).
 */
async function adminUpdateUserProfile(callerUid, targetUid, patch) {
    var _a;
    if (!callerUid || !targetUid) {
        throw new Error('Thiếu callerUid hoặc targetUid.');
    }
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    const callerRole = (_a = callerDoc.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (!isAdminOrManager(callerRole)) {
        throw new Error('permission-denied');
    }
    const emailRaw = typeof patch.email === 'string' ? patch.email.trim().toLowerCase() : undefined;
    if (emailRaw !== undefined && emailRaw.length > 0 && !isValidEmail(emailRaw)) {
        throw new Error('Email không hợp lệ.');
    }
    if (emailRaw) {
        try {
            const existing = await admin.auth().getUserByEmail(emailRaw);
            if (existing.uid !== targetUid) {
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
        await admin.auth().updateUser(targetUid, { email: emailRaw });
    }
    const usersMerge = { updatedAt: new Date() };
    if (typeof patch.displayName === 'string') {
        usersMerge.displayName = patch.displayName.trim();
    }
    if (typeof patch.department === 'string') {
        usersMerge.department = patch.department.trim();
    }
    if (emailRaw) {
        usersMerge.email = emailRaw;
    }
    await admin.firestore().collection('users').doc(targetUid).set(usersMerge, { merge: true });
    const permMerge = { updatedAt: new Date() };
    if (typeof patch.displayName === 'string') {
        permMerge.displayName = patch.displayName.trim();
    }
    if (emailRaw) {
        permMerge.email = emailRaw;
    }
    await admin.firestore().collection('user-permissions').doc(targetUid).set(permMerge, { merge: true });
    const tabMerge = { updatedAt: new Date() };
    if (typeof patch.displayName === 'string') {
        tabMerge.displayName = patch.displayName.trim();
    }
    if (emailRaw) {
        tabMerge.email = emailRaw;
    }
    await admin.firestore().collection('user-tab-permissions').doc(targetUid).set(tabMerge, { merge: true });
    const after = await admin.auth().getUser(targetUid);
    return { email: (after.email || emailRaw || '').toLowerCase() };
}
//# sourceMappingURL=admin-update-user-profile.js.map