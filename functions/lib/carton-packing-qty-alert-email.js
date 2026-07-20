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
exports.sendCartonPackingQtyAlertEmail = sendCartonPackingQtyAlertEmail;
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
/** Danh sách cố định nhận cảnh báo sai Lượng Đóng Thùng (FG In → nút "Sai Carton"). */
const ALERT_RECIPIENTS = [
    'wh1@airspeedmfgvn.com',
    'wh2@airspeedmfgvn.com',
    'wh3@airspeedmfgvn.com',
    'wh4@airspeedmfgvn.com',
    'engineer11@airspeedmfgvn.com',
    'engineer7@airspeedmfgvn.com',
    'ast7@airspeedmfgvn.com',
    'ast8@airspeedmfgvn.com'
].join(',');
function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function getSmtpConfig() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass) {
        return null;
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const from = params_config_1.emailFrom.value().trim() || user;
    return { host, port, user, pass, from };
}
/** FG In: gửi mail báo Mã TP có Lượng SP/thùng trong danh mục sai với thực tế (bấm "Sai Carton"). */
async function sendCartonPackingQtyAlertEmail(p) {
    const cfg = getSmtpConfig();
    if (!cfg) {
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
    }
    const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const oldQtyStr = p.oldQty > 0 ? String(p.oldQty) : '(chưa có)';
    const text = `Cảnh báo: Lượng sản phẩm/thùng của Mã TP dưới đây đang SAI so với thực tế khi nhận hàng.\n\n` +
        `Thời điểm: ${atStr}\n` +
        `Mã TP: ${p.materialCode}\n` +
        `Nhà máy: ${p.factory}\n` +
        `LSX: ${p.lsx}\n` +
        `LOT: ${p.lot}\n` +
        `Số lượng phiếu nhập: ${p.quantity}\n` +
        `Lượng/thùng trong danh mục (cũ): ${oldQtyStr}\n` +
        `Lượng/thùng thực tế (kho vừa xác nhận): ${p.newQty}\n` +
        `Người báo: ${p.reportedBy}\n\n` +
        `Vui lòng kiểm tra lại và cập nhật bản vẽ/thông số đóng gói cho đúng.`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>⚠️ Cảnh báo Lượng SP/thùng sai — FG In</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="6" border="1">
<tr><td>Mã TP</td><td><strong>${esc(p.materialCode)}</strong></td></tr>
<tr><td>Nhà máy</td><td>${esc(p.factory)}</td></tr>
<tr><td>LSX</td><td>${esc(p.lsx)}</td></tr>
<tr><td>LOT</td><td>${esc(p.lot)}</td></tr>
<tr><td>Số lượng phiếu nhập</td><td>${esc(String(p.quantity))}</td></tr>
<tr><td>Lượng/thùng trong danh mục (cũ)</td><td>${esc(oldQtyStr)}</td></tr>
<tr><td>Lượng/thùng thực tế (kho vừa xác nhận)</td><td><strong>${esc(String(p.newQty))}</strong></td></tr>
<tr><td>Người báo</td><td>${esc(p.reportedBy)}</td></tr>
</table>
<p style="color:#555;font-size:12px">Vui lòng kiểm tra lại và cập nhật bản vẽ/thông số đóng gói cho đúng.</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: ALERT_RECIPIENTS,
        subject: `[Cảnh báo] Mã TP ${p.materialCode} sai Lượng SP/thùng`.slice(0, 250),
        text,
        html
    });
}
//# sourceMappingURL=carton-packing-qty-alert-email.js.map