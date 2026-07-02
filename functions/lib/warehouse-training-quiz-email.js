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
exports.sendWarehouseTrainingQuizPdfEmail = sendWarehouseTrainingQuizPdfEmail;
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
function safeText(s, max = 200) {
    return String(s !== null && s !== void 0 ? s : '').trim().slice(0, max);
}
function decodePdfDataUrl(pdfDataUrl) {
    const m = /^data:application\/pdf;base64,(.+)$/i.exec(pdfDataUrl || '');
    if (!(m === null || m === void 0 ? void 0 : m[1])) {
        throw new Error('pdfDataUrl không hợp lệ (cần data:application/pdf;base64,...)');
    }
    return Buffer.from(m[1], 'base64');
}
/** Cùng SMTP + người nhận với mail QC ưu tiên (QC_PRIORITY_EMAIL_TO). */
function getSmtpForWarehouseQuiz() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    const to = params_config_1.qcPriorityEmailTo.value().trim();
    if (!user || !pass || !to)
        return null;
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    return { host, port, user, pass, from, to };
}
async function sendWarehouseTrainingQuizPdfEmail(payload) {
    const cfg = getSmtpForWarehouseQuiz();
    if (!cfg) {
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS) hoặc QC_PRIORITY_EMAIL_TO');
    }
    const pdfBuf = decodePdfDataUrl(payload.pdfDataUrl);
    if (!(pdfBuf === null || pdfBuf === void 0 ? void 0 : pdfBuf.length)) {
        throw new Error('PDF rỗng');
    }
    const employeeId = safeText(payload.employeeId, 40);
    const fullName = safeText(payload.fullName, 120);
    const joinDate = safeText(payload.joinDate, 40);
    const sectionId = safeText(payload.sectionId, 40);
    const resultText = safeText(payload.resultText, 600);
    const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const subject = `[WH] Kết quả kiểm tra đào tạo kho` +
        (sectionId ? ` (${sectionId})` : '') +
        (employeeId ? ` — ${employeeId}` : '') +
        (fullName ? ` — ${fullName}` : '');
    const text = `Bài kiểm tra đào tạo kho đã hoàn thành.\n\n` +
        `Thời điểm: ${atStr}\n` +
        (sectionId ? `Bài: ${sectionId}\n` : '') +
        (fullName ? `Họ tên: ${fullName}\n` : '') +
        (employeeId ? `Mã NV: ${employeeId}\n` : '') +
        (joinDate ? `Ngày vào làm: ${joinDate}\n` : '') +
        (resultText ? `Kết quả: ${resultText}\n` : '');
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    const safeFileName = `${employeeId || 'NV'}_${(fullName || 'nhan-vien').replace(/\s+/g, '_')}.pdf`.replace(/[^\w.\-()]+/g, '_');
    await transporter.sendMail({
        from: cfg.from,
        to: cfg.to,
        subject: subject.slice(0, 250),
        text,
        attachments: [
            {
                filename: safeFileName,
                content: pdfBuf,
                contentType: 'application/pdf'
            }
        ]
    });
    return { ok: true };
}
//# sourceMappingURL=warehouse-training-quiz-email.js.map