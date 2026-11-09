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
exports.signInFromScan = signInFromScan;
const admin = __importStar(require("firebase-admin"));
const crypto_1 = require("crypto");
const authz_1 = require("./authz");
const zalo_notify_util_1 = require("./zalo-notify.util");
/**
 * Đăng nhập bằng quét thẻ nhân viên: thẻ chỉ chứa mã ASP, không có mật khẩu,
 * nên phiên này bị giới hạn:
 * - Tài khoản admin không được đăng nhập bằng thẻ.
 * - Token mang claim `scan: true`; Firestore rules không cho phiên quét thẻ làm việc quản trị.
 * - Chống dò mã (thử lần lượt ASP0001, ASP0002…): đếm số lần quét SAI theo địa chỉ IP;
 *   quá FAIL_LIMIT lần trong FAIL_WINDOW_MS → khóa IP đó, báo admin qua Zalo.
 *   Nhân viên quét đúng thẻ của mình không bị ảnh hưởng.
 */
const THROTTLE_COLLECTION = 'scan-login-throttle';
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
function ipKey(ip) {
    return (0, crypto_1.createHash)('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32);
}
async function assertNotThrottled(db, ip) {
    const snap = await db.collection(THROTTLE_COLLECTION).doc(ipKey(ip)).get();
    const d = snap.data();
    if ((d === null || d === void 0 ? void 0 : d.blockedUntil) && d.blockedUntil > Date.now()) {
        throw new Error('throttled');
    }
}
/** Ghi 1 lần quét sai; vượt ngưỡng → khóa IP + báo admin (1 lần). */
async function recordFailure(db, ip, tried) {
    var _a;
    const ref = db.collection(THROTTLE_COLLECTION).doc(ipKey(ip));
    const now = Date.now();
    let justBlocked = false;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = (snap.data() || {});
        const inWindow = d.windowStart && now - d.windowStart < FAIL_WINDOW_MS;
        const fails = (inWindow ? d.fails || 0 : 0) + 1;
        const update = {
            fails,
            windowStart: inWindow ? d.windowStart : now,
            lastTried: tried.slice(0, 12),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (fails >= FAIL_LIMIT && !(d.blockedUntil && d.blockedUntil > now)) {
            update['blockedUntil'] = now + FAIL_WINDOW_MS;
            justBlocked = true;
        }
        tx.set(ref, update, { merge: true });
    });
    if (justBlocked) {
        try {
            const links = await db.collection('zalo_links').where('memberId', '==', authz_1.ADMIN_EMPLOYEE_ID).limit(1).get();
            const chatId = links.empty ? '' : String(((_a = links.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || links.docs[0].id).trim();
            if (chatId) {
                await (0, zalo_notify_util_1.sendZaloToChat)(chatId, `⚠️ Đăng nhập quét thẻ: ${FAIL_LIMIT} lần quét sai liên tiếp từ cùng 1 máy/mạng — đã khóa 15 phút.\n` +
                    `Có thể có người đang dò mã nhân viên. Mã thử gần nhất: ${tried.slice(0, 12)}`);
            }
        }
        catch (e) {
            console.error('scan-login: báo Zalo thất bại', e);
        }
    }
}
async function signInFromScan(raw, ip = '') {
    const db = admin.firestore();
    await assertNotThrottled(db, ip);
    const text = String(raw || '').trim().toUpperCase();
    const key = text.slice(0, 7);
    const fail = async () => {
        try {
            await recordFailure(db, ip, key || text);
        }
        catch (e) {
            console.error('scan-login: ghi lần sai thất bại', e);
        }
        throw new Error('permission-denied');
    };
    if (!/^ASP\d{4}$/.test(key)) {
        return fail();
    }
    const snap = await db.collection('users').where('employeeId', '==', key).limit(1).get();
    if (snap.empty) {
        return fail();
    }
    const uid = snap.docs[0].id;
    try {
        await admin.auth().getUser(uid);
    }
    catch (_a) {
        return fail();
    }
    if (await (0, authz_1.isAdminAccount)(uid)) {
        throw new Error('permission-denied');
    }
    const token = await admin.auth().createCustomToken(uid, { scan: true });
    return { token };
}
//# sourceMappingURL=scan-login.js.map