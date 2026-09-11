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
exports.sendQcPriorityResolvedEmail = sendQcPriorityResolvedEmail;
exports.sendQcPriorityResolvedZalo = sendQcPriorityResolvedZalo;
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
const zalo_notify_util_1 = require("./zalo-notify.util");
function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function getSmtpForQcNotify() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    const to = params_config_1.qcPriorityEmailTo.value().trim();
    if (!user || !pass || !to) {
        return null;
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    return { host, port, user, pass, from, to };
}
/** Mail khi mã ưu tiên (danh sách Chờ kiểm) đổi từ CHỜ KIỂM sang trạng thái khác. */
async function sendQcPriorityResolvedEmail(p) {
    const cfg = getSmtpForQcNotify();
    if (!cfg) {
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS) hoặc QC_PRIORITY_EMAIL_TO');
    }
    const atStr = new Date().toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false
    });
    const text = `Mã ưu tiên (Chờ kiểm) vừa được cập nhật trạng thái IQC.\n\n` +
        `Thời điểm: ${atStr}\n` +
        `Nhà máy: ${p.factory}\n` +
        `Mã hàng: ${p.materialCode}\n` +
        `PO: ${p.poNumber}\n` +
        `IMD/Batch: ${p.imd}\n` +
        `Vị trí: ${p.location}\n` +
        `Trạng thái cũ: ${p.oldStatus}\n` +
        `Trạng thái mới: ${p.newStatus}\n` +
        `Người kiểm: ${p.checkedBy}\n`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>QC — Mã ưu tiên (Chờ kiểm) đã xử lý</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="6" border="1">
<tr><td>Nhà máy</td><td>${esc(p.factory)}</td></tr>
<tr><td>Mã hàng</td><td>${esc(p.materialCode)}</td></tr>
<tr><td>PO</td><td>${esc(p.poNumber)}</td></tr>
<tr><td>IMD/Batch</td><td>${esc(p.imd)}</td></tr>
<tr><td>Vị trí</td><td>${esc(p.location)}</td></tr>
<tr><td>Trạng thái cũ</td><td>${esc(p.oldStatus)}</td></tr>
<tr><td>Trạng thái mới</td><td>${esc(p.newStatus)}</td></tr>
<tr><td>Người kiểm</td><td>${esc(p.checkedBy)}</td></tr>
</table>
<p style="color:#555;font-size:12px">Gửi từ Tuấn Anh</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: cfg.to,
        subject: `[QC Ưu tiên] ${p.materialCode} — ${p.oldStatus} → ${p.newStatus}`.slice(0, 250),
        text,
        html
    });
}
// ── Zalo: thông báo khi MÃ ƯU TIÊN được PASS ────────────────────────────────
/** Doc cấu hình danh sách mã NV nhận Zalo (tab QC → More). Trống → dùng mặc định. */
const QC_PRIORITY_ZALO_RECIPIENTS_DOC = 'qc-settings/priority-zalo-recipients';
/** Mặc định: đầu mối Zalo cố định của app (giống outbound-dup-notify). */
const QC_PRIORITY_ZALO_DEFAULT = ['ASP0106'];
function isQcPassStatus(s) {
    const t = String(s || '').trim().toUpperCase();
    return t === 'PASS' || t === 'ĐẠT' || t.startsWith('PASS');
}
async function resolveQcPriorityZaloRecipients() {
    var _a;
    try {
        const snap = await admin.firestore().doc(QC_PRIORITY_ZALO_RECIPIENTS_DOC).get();
        const raw = snap.exists ? (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.memberIds : null;
        const list = Array.isArray(raw)
            ? raw.map((x) => String(x || '').trim().toUpperCase()).filter((x) => /^ASP\d{4}$/.test(x))
            : [];
        return list.length ? [...new Set(list)] : QC_PRIORITY_ZALO_DEFAULT;
    }
    catch (e) {
        console.error('[qc-priority] đọc recipients Zalo lỗi, dùng mặc định:', e);
        return QC_PRIORITY_ZALO_DEFAULT;
    }
}
/**
 * Gửi Zalo khi mã ưu tiên (Chờ kiểm) được **PASS**. Best-effort — không throw.
 * Người nhận: doc `qc-settings/priority-zalo-recipients` (memberIds[]), mặc định ASP0106.
 * Yêu cầu function gọi khai báo secret ZALO_BOT_TOKEN.
 */
async function sendQcPriorityResolvedZalo(p) {
    if (!isQcPassStatus(p.newStatus)) {
        return;
    }
    const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const text = `✅ QC — Mã ưu tiên đã PASS\n` +
        `Thời điểm: ${atStr}\n` +
        `Nhà máy: ${p.factory}\n` +
        `Mã hàng: ${p.materialCode}\n` +
        `PO: ${p.poNumber || '-'}\n` +
        `IMD/Batch: ${p.imd || '-'}\n` +
        `Vị trí: ${p.location || '-'}\n` +
        `${p.oldStatus || 'CHỜ KIỂM'} → ${p.newStatus}\n` +
        `Người kiểm: ${p.checkedBy || '-'}`;
    const recipients = await resolveQcPriorityZaloRecipients();
    const sent = await Promise.all(recipients.map((m) => (0, zalo_notify_util_1.sendZaloToEmployee)(m, text).catch(() => false)));
    console.log(`[qc-priority] Zalo PASS ${p.materialCode}: gửi ${sent.filter(Boolean).length}/${recipients.length} (${recipients.join(', ')})`);
}
//# sourceMappingURL=qc-priority-email.js.map