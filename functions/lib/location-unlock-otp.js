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
exports.requestLocationUnlockOtp = requestLocationUnlockOtp;
exports.verifyLocationUnlockOtp = verifyLocationUnlockOtp;
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const ALLOWED_EMPLOYEE_IDS = new Set(['ASP0106', 'ASP0119', 'ASP0538', 'ASP1761']);
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COLLECTION = 'location-unlock-otp';
function normalizeEmployeeId(raw) {
    const compact = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = /^ASP(\d{4})$/.exec(compact);
    return m ? `ASP${m[1]}` : null;
}
function random4DigitCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
async function sendOtpToZalo(db, memberId, code, token) {
    var _a;
    const linkSnap = await db.collection('zalo_links').where('memberId', '==', memberId).limit(1).get();
    if (linkSnap.empty) {
        throw new Error(`Chưa có zalo_links cho ${memberId}`);
    }
    const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error(`Thiếu chatId cho ${memberId}`);
    }
    const atStr = vnNowLabel(new Date());
    const msg = `🔐 Mã mở khóa cột Vị trí (Materials)\n` +
        `Thời điểm: ${atStr}\n` +
        `Mã nhân viên: ${memberId}\n` +
        `Mã đăng nhập: ${code}\n` +
        `Hiệu lực: 10 phút (một lần dùng)`;
    const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
    }
}
async function requestLocationUnlockOtp(db, employeeIdRaw) {
    const employeeId = normalizeEmployeeId(employeeIdRaw);
    if (!employeeId || !ALLOWED_EMPLOYEE_IDS.has(employeeId)) {
        throw new Error('Mã nhân viên không được phép mở khóa cột Vị trí.');
    }
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const code = random4DigitCode();
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
    await db.collection(OTP_COLLECTION).doc(employeeId).set({
        employeeId,
        code,
        expiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await sendOtpToZalo(db, employeeId, code, token);
}
async function verifyLocationUnlockOtp(db, employeeIdRaw, codeRaw) {
    var _a, _b, _c;
    const employeeId = normalizeEmployeeId(employeeIdRaw);
    if (!employeeId || !ALLOWED_EMPLOYEE_IDS.has(employeeId)) {
        throw new Error('Mã nhân viên không được phép mở khóa cột Vị trí.');
    }
    const code = String(codeRaw || '').trim();
    if (!/^\d{4}$/.test(code)) {
        throw new Error('Mã OTP phải gồm 4 chữ số.');
    }
    const ref = db.collection(OTP_COLLECTION).doc(employeeId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new Error('Chưa có mã OTP. Vui lòng yêu cầu gửi lại qua Zalo.');
    }
    const data = snap.data();
    const stored = String(data.code || '').trim();
    const expiresMs = (_c = (_b = (_a = data.expiresAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0;
    if (Date.now() > expiresMs) {
        await ref.delete().catch(() => undefined);
        throw new Error('Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.');
    }
    if (stored !== code) {
        throw new Error('Mã OTP không đúng.');
    }
    await ref.delete();
    return { ok: true, employeeId };
}
//# sourceMappingURL=location-unlock-otp.js.map