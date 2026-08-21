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
exports.woPxkBypassOtpDocId = woPxkBypassOtpDocId;
exports.requestWoPxkBypassOtp = requestWoPxkBypassOtp;
exports.verifyWoPxkBypassOtp = verifyWoPxkBypassOtp;
/**
 * Work Order Status: OTP 4 số gửi Zalo tới ASP0106
 * để vượt quyền đổi tình trạng khi PXK lệch — mỗi LSX một mã riêng.
 */
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COLLECTION = 'wo-pxk-bypass-otp';
function random4DigitCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
function woPxkBypassOtpDocId(lsxRaw) {
    return String(lsxRaw || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/\//g, '_')
        .replace(/[^A-Z0-9._-]/g, '')
        .slice(0, 80);
}
async function sendOtpToZalo(db, code, token, lsx, requestedBy, nextStatus, factory) {
    var _a;
    const linkSnap = await db.collection('zalo_links').where('memberId', '==', OTP_RECIPIENT_ID).limit(1).get();
    if (linkSnap.empty) {
        throw new Error(`Chưa có zalo_links cho ${OTP_RECIPIENT_ID}`);
    }
    const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error(`Thiếu chatId cho ${OTP_RECIPIENT_ID}`);
    }
    const lines = [
        `🔐 Vượt quyền PXK lệch (Work Order)`,
        `Thời điểm: ${vnNowLabel(new Date())}`,
        requestedBy ? `Người yêu cầu: ${requestedBy}` : '',
        factory ? `Nhà máy: ${factory}` : '',
        `LSX: ${lsx}`,
        nextStatus ? `Tình trạng: ${nextStatus}` : '',
        `Mã xác nhận: ${code}`,
        `Hiệu lực: 10 phút (một lần, chỉ LSX này)`
    ].filter(Boolean);
    const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
    }
}
async function requestWoPxkBypassOtp(db, opts) {
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const lsx = String((opts === null || opts === void 0 ? void 0 : opts.lsx) || '').trim().toUpperCase().slice(0, 40);
    const docId = woPxkBypassOtpDocId(lsx);
    if (!lsx || !docId) {
        throw new Error('Thiếu LSX để gửi OTP vượt quyền.');
    }
    const requestedBy = String((opts === null || opts === void 0 ? void 0 : opts.requestedBy) || '').trim().toUpperCase().slice(0, 20);
    const nextStatus = String((opts === null || opts === void 0 ? void 0 : opts.nextStatus) || '').trim().slice(0, 20);
    const factory = String((opts === null || opts === void 0 ? void 0 : opts.factory) || '').trim().toUpperCase().slice(0, 16);
    const code = random4DigitCode();
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
    await db.collection(OTP_COLLECTION).doc(docId).set({
        code,
        lsx,
        recipientId: OTP_RECIPIENT_ID,
        requestedBy: requestedBy || '',
        nextStatus,
        factory,
        expiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await sendOtpToZalo(db, code, token, lsx, requestedBy, nextStatus, factory);
}
async function verifyWoPxkBypassOtp(db, codeRaw, lsxRaw) {
    var _a, _b, _c;
    const code = String(codeRaw || '').trim();
    if (!/^\d{4}$/.test(code)) {
        throw new Error('Mã OTP phải gồm 4 chữ số.');
    }
    const lsx = String(lsxRaw || '').trim().toUpperCase().slice(0, 40);
    const docId = woPxkBypassOtpDocId(lsx);
    if (!lsx || !docId) {
        throw new Error('Thiếu LSX để xác nhận OTP.');
    }
    const ref = db.collection(OTP_COLLECTION).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new Error('Chưa có mã OTP cho LSX này. Vui lòng yêu cầu gửi lại qua Zalo.');
    }
    const data = snap.data();
    const storedLsx = String(data.lsx || '').trim().toUpperCase();
    if (storedLsx && storedLsx !== lsx) {
        throw new Error('Mã OTP không khớp LSX này.');
    }
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
    return { ok: true, lsx };
}
//# sourceMappingURL=wo-pxk-bypass-otp.js.map