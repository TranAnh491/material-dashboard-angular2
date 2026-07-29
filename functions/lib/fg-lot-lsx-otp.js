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
exports.requestFgLotLsxOtp = requestFgLotLsxOtp;
exports.verifyFgLotLsxOtp = verifyFgLotLsxOtp;
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_DOC_ID = 'current';
const OTP_COLLECTION = 'fg-lot-lsx-otp';
function random4DigitCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
async function sendOtpToZalo(db, code, token, meta) {
    var _a;
    const linkSnap = await db.collection('zalo_links').where('memberId', '==', OTP_RECIPIENT_ID).limit(1).get();
    if (linkSnap.empty) {
        throw new Error(`Chưa có zalo_links cho ${OTP_RECIPIENT_ID}`);
    }
    const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error(`Thiếu chatId cho ${OTP_RECIPIENT_ID}`);
    }
    const atStr = vnNowLabel(new Date());
    const fieldLabel = String(meta.field || '').toUpperCase() === 'LSX' ? 'LSX' : 'LOT';
    const lines = [
        `🔐 Yêu cầu sửa ${fieldLabel} (FG Inventory)`,
        `Thời điểm: ${atStr}`,
        meta.requestedBy ? `Người yêu cầu: ${meta.requestedBy}` : '',
        meta.materialCode ? `Mã TP: ${meta.materialCode}` : '',
        meta.batchNumber ? `Batch: ${meta.batchNumber}` : '',
        `Sửa ${fieldLabel}: ${meta.oldValue || '—'} → ${meta.newValue || '—'}`,
        `Mã xác nhận: ${code}`,
        `Hiệu lực: 10 phút (một lần dùng)`
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
async function requestFgLotLsxOtp(db, metaRaw) {
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const meta = {
        requestedBy: String((metaRaw === null || metaRaw === void 0 ? void 0 : metaRaw.requestedBy) || '').trim().toUpperCase().slice(0, 20),
        materialCode: String((metaRaw === null || metaRaw === void 0 ? void 0 : metaRaw.materialCode) || '').trim().toUpperCase().slice(0, 40),
        batchNumber: String((metaRaw === null || metaRaw === void 0 ? void 0 : metaRaw.batchNumber) || '').trim().toUpperCase().slice(0, 40),
        field: String((metaRaw === null || metaRaw === void 0 ? void 0 : metaRaw.field) || 'LOT').trim().toUpperCase().slice(0, 8),
        oldValue: String((metaRaw === null || metaRaw === void 0 ? void 0 : metaRaw.oldValue) || '').trim().slice(0, 80),
        newValue: String((metaRaw === null || metaRaw === void 0 ? void 0 : metaRaw.newValue) || '').trim().slice(0, 80)
    };
    const code = random4DigitCode();
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
    await db.collection(OTP_COLLECTION).doc(OTP_DOC_ID).set(Object.assign(Object.assign({ code, recipientId: OTP_RECIPIENT_ID }, meta), { expiresAt, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
    await sendOtpToZalo(db, code, token, meta);
}
async function verifyFgLotLsxOtp(db, codeRaw) {
    var _a, _b, _c;
    const code = String(codeRaw || '').trim();
    if (!/^\d{4}$/.test(code)) {
        throw new Error('Mã OTP phải gồm 4 chữ số.');
    }
    const ref = db.collection(OTP_COLLECTION).doc(OTP_DOC_ID);
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
    return { ok: true };
}
//# sourceMappingURL=fg-lot-lsx-otp.js.map