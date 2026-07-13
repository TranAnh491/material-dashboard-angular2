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
exports.sendTruckDeliveryDecisionEmail = sendTruckDeliveryDecisionEmail;
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** Chỉ gửi cho email công ty thật (bỏ qua các email nội bộ giả asp####@asp.com). */
function isCompanyEmail(email) {
    const e = (email || '').trim().toLowerCase();
    return e.endsWith('@airspeedmfgvn.com') || e.endsWith('@airspeedmfg.com');
}
/**
 * Gửi email cho người đăng ký lệnh giao hàng (Xe Tải) khi kho Duyệt / Từ chối / Đổi ngày.
 * Đọc lại document từ Firestore (admin SDK) theo requestId thay vì tin dữ liệu client gửi lên,
 * để nội dung email luôn khớp đúng dữ liệu đã lưu.
 */
async function sendTruckDeliveryDecisionEmail(requestId, decision) {
    const snap = await admin.firestore().collection('truck-delivery-requests').doc(requestId).get();
    if (!snap.exists) {
        throw new Error('Không tìm thấy lệnh giao hàng.');
    }
    const d = snap.data();
    const to = String(d.createdByEmail || '').trim();
    if (!to || !isCompanyEmail(to)) {
        console.log('[TruckSchedule Email] Bỏ qua — không có email công ty hợp lệ:', to);
        return;
    }
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass) {
        throw new Error('Thiếu cấu hình SMTP (EMAIL_USER, EMAIL_PASS secret).');
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const from = params_config_1.emailFrom.value().trim() || user;
    const dateYmd = String(d.dateYmd || '');
    const employeeCode = String(d.employeeCode || '');
    const employeeName = String(d.employeeName || '');
    const warehouseNote = String(d.warehouseNote || '').trim();
    let subject;
    let statusLabel;
    let actionNote = '';
    if (decision === 'approved') {
        subject = `[Xe Tải] Lệnh giao hàng ngày ${dateYmd} đã được DUYỆT`;
        statusLabel = 'ĐÃ DUYỆT (Đã đặt)';
    }
    else if (decision === 'rejected') {
        subject = `[Xe Tải] Lệnh giao hàng ngày ${dateYmd} bị TỪ CHỐI`;
        statusLabel = 'TỪ CHỐI (Không đặt được)';
    }
    else {
        subject = `[Xe Tải] Lệnh giao hàng đã được ĐỔI NGÀY sang ${dateYmd}`;
        statusLabel = `ĐỔI NGÀY → ${dateYmd}`;
        actionNote =
            'Vui lòng vào app Xe Tải, mở lệnh này và bấm "Đồng ý đổi lịch" để xác nhận ngày mới — ' +
                'lệnh chỉ chính thức được duyệt sau khi bạn xác nhận.';
    }
    const text = `Xin chào ${employeeName || employeeCode},\n\n` +
        `Lệnh giao hàng của bạn (mã NV ${employeeCode}) vừa được cập nhật:\n` +
        `Trạng thái: ${statusLabel}\n` +
        (warehouseNote ? `Ghi chú kho: ${warehouseNote}\n` : '') +
        (actionNote ? `\n${actionNote}\n` : '') +
        `\nXem chi tiết trong app Xe Tải.\n`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p>Xin chào <strong>${esc(employeeName || employeeCode)}</strong>,</p>
<p>Lệnh giao hàng của bạn vừa được cập nhật:</p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="8" border="1">
<tr><td>Mã nhân viên</td><td>${esc(employeeCode)}</td></tr>
<tr><td>Ngày</td><td>${esc(dateYmd)}</td></tr>
<tr><td>Trạng thái</td><td><strong>${esc(statusLabel)}</strong></td></tr>
${warehouseNote ? `<tr><td>Ghi chú kho</td><td>${esc(warehouseNote)}</td></tr>` : ''}
</table>
${actionNote ? `<p style="color:#c0392b;font-weight:bold;">${esc(actionNote)}</p>` : ''}
<p style="color:#555;font-size:12px">Gửi tự động từ hệ thống Xe Tải — Warehouse.</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    await transporter.sendMail({
        from,
        to,
        subject: subject.slice(0, 250),
        text,
        html
    });
}
//# sourceMappingURL=truck-schedule-email.js.map