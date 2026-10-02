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
exports.requestInboundLdvOtp = requestInboundLdvOtp;
exports.verifyInboundLdvOtp = verifyInboundLdvOtp;
exports.sendInboundLdvMismatchEmail = sendInboundLdvMismatchEmail;
/**
 * Inbound: OTP 4 số Zalo → nhóm Quản lý kho để sửa lượng đơn vị đã nhập.
 * Mail khi lượng đơn vị khác Standard Packing.
 */
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
const carton_packing_qty_alert_email_1 = require("./carton-packing-qty-alert-email");
/** Mail lệch lượng đơn vị / Standard Packing — chỉ kho, không gửi engineer/AST. */
const LDV_MISMATCH_RECIPIENTS = [
    'wh1@airspeedmfgvn.com',
    'wh2@airspeedmfgvn.com',
    'wh3@airspeedmfgvn.com',
    'wh4@airspeedmfgvn.com'
].join(',');
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const OTP_RECIPIENT_ID = 'quanly_kho';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_DOC_ID = 'current';
const OTP_COLLECTION = 'inbound-ldv-otp';
function random4DigitCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
async function sendOtpToZalo(db, code, token, requestedBy, materialCode, factory) {
    var _a;
    const groupSnap = await db.doc(KHO_GROUP_DOC).get();
    const chatId = String(((_a = groupSnap.data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error('Chưa gắn nhóm Quản lý kho trong zalo_group_config/quanly_kho.');
    }
    const msg = `🔐 Sửa lượng đơn vị (Nhận hàng)\n` +
        `Thời điểm: ${vnNowLabel()}\n` +
        (requestedBy ? `Người yêu cầu: ${requestedBy}\n` : '') +
        (factory ? `Nhà máy: ${factory}\n` : '') +
        (materialCode ? `Mã hàng: ${materialCode}\n` : '') +
        `Mã xác nhận: ${code}\n` +
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
async function requestInboundLdvOtp(db, opts) {
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token)
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    const requestedBy = String((opts === null || opts === void 0 ? void 0 : opts.requestedBy) || '').trim().toUpperCase().slice(0, 20);
    const materialCode = String((opts === null || opts === void 0 ? void 0 : opts.materialCode) || '').trim().slice(0, 80);
    const factory = String((opts === null || opts === void 0 ? void 0 : opts.factory) || '').trim().toUpperCase().slice(0, 10);
    const code = random4DigitCode();
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
    await db.collection(OTP_COLLECTION).doc(OTP_DOC_ID).set({
        code,
        recipientId: OTP_RECIPIENT_ID,
        requestedBy,
        materialCode,
        factory,
        expiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await sendOtpToZalo(db, code, token, requestedBy, materialCode, factory);
}
async function verifyInboundLdvOtp(db, codeRaw) {
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
async function sendInboundLdvMismatchEmail(p) {
    const cfg = (0, carton_packing_qty_alert_email_1.getSmtpConfig)();
    if (!cfg)
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
    const atStr = vnNowLabel();
    const text = `Lượng đơn vị khi nhận hàng khác Standard Packing.\n\n` +
        `Thời điểm: ${atStr}\n` +
        `Nhà máy: ${p.factory}\n` +
        `Mã hàng: ${p.materialCode}\n` +
        `P.O: ${p.poNumber}\n` +
        `Lô: ${p.batchNumber}\n` +
        `Lượng đơn vị: ${p.rollsOrBags}\n` +
        `Standard Packing: ${p.standardPacking}\n` +
        `Người nhập: ${p.reportedBy}\n`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Lượng đơn vị khác Standard Packing</strong></p>
<p>Thời điểm: <strong>${(0, carton_packing_qty_alert_email_1.esc)(atStr)}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="6" border="1">
<tr><td>Nhà máy</td><td>${(0, carton_packing_qty_alert_email_1.esc)(p.factory)}</td></tr>
<tr><td>Mã hàng</td><td><strong>${(0, carton_packing_qty_alert_email_1.esc)(p.materialCode)}</strong></td></tr>
<tr><td>P.O</td><td>${(0, carton_packing_qty_alert_email_1.esc)(p.poNumber)}</td></tr>
<tr><td>Lô</td><td>${(0, carton_packing_qty_alert_email_1.esc)(p.batchNumber)}</td></tr>
<tr><td>Lượng đơn vị</td><td><strong>${(0, carton_packing_qty_alert_email_1.esc)(String(p.rollsOrBags))}</strong></td></tr>
<tr><td>Standard Packing</td><td><strong>${(0, carton_packing_qty_alert_email_1.esc)(String(p.standardPacking))}</strong></td></tr>
<tr><td>Người nhập</td><td>${(0, carton_packing_qty_alert_email_1.esc)(p.reportedBy)}</td></tr>
</table>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: LDV_MISMATCH_RECIPIENTS,
        subject: `[Nhận hàng] ${p.materialCode} lệch lượng đơn vị / Standard Packing`.slice(0, 250),
        text,
        html
    });
}
//# sourceMappingURL=inbound-ldv-guard.js.map