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
exports.sendTpCatalogPackingMismatchEmail = sendTpCatalogPackingMismatchEmail;
const nodemailer = __importStar(require("nodemailer"));
const carton_packing_qty_alert_email_1 = require("./carton-packing-qty-alert-email");
/** Danh mục TP: bấm icon "Gửi mail" ở dòng lệch SL SP/thùng ≠ Lượng Đóng Thùng → báo Kho + Kỹ thuật. */
async function sendTpCatalogPackingMismatchEmail(p) {
    const cfg = (0, carton_packing_qty_alert_email_1.getSmtpConfig)();
    if (!cfg) {
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
    }
    const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const text = `Cảnh báo: Mã TP dưới đây đang lệch SL SP/thùng so với Lượng Đóng Thùng trong Danh mục TP.\n\n` +
        `Thời điểm: ${atStr}\n` +
        `Mã TP: ${p.materialCode}\n` +
        `SL SP/thùng: ${p.standardQty}\n` +
        `Lượng Đóng Thùng: ${p.cartonPackingQty}\n` +
        `Người báo: ${p.reportedBy}\n\n` +
        `Vui lòng kiểm tra lại và cập nhật cho khớp.`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>⚠️ Cảnh báo lệch SL SP/thùng ≠ Lượng Đóng Thùng — Danh mục TP</strong></p>
<p>Thời điểm: <strong>${(0, carton_packing_qty_alert_email_1.esc)(atStr)}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="6" border="1">
<tr><td>Mã TP</td><td><strong>${(0, carton_packing_qty_alert_email_1.esc)(p.materialCode)}</strong></td></tr>
<tr><td>SL SP/thùng</td><td>${(0, carton_packing_qty_alert_email_1.esc)(String(p.standardQty))}</td></tr>
<tr><td>Lượng Đóng Thùng</td><td>${(0, carton_packing_qty_alert_email_1.esc)(String(p.cartonPackingQty))}</td></tr>
<tr><td>Người báo</td><td>${(0, carton_packing_qty_alert_email_1.esc)(p.reportedBy)}</td></tr>
</table>
<p style="color:#555;font-size:12px">Vui lòng kiểm tra lại và cập nhật cho khớp.</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: carton_packing_qty_alert_email_1.ALERT_RECIPIENTS,
        subject: `[Cảnh báo] Mã TP ${p.materialCode} lệch SL SP/thùng`.slice(0, 250),
        text,
        html
    });
}
//# sourceMappingURL=tp-catalog-packing-mismatch-email.js.map