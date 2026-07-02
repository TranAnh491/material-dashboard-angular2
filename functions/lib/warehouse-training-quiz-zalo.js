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
exports.sendWarehouseTrainingQuizPdfZalo = sendWarehouseTrainingQuizPdfZalo;
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const TARGET_MEMBER_ID = 'ASP0119';
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
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
async function lookupChatId(db, memberId) {
    var _a;
    const linkSnap = await db.collection('zalo_links').where('memberId', '==', memberId).limit(1).get();
    if (linkSnap.empty) {
        throw new Error(`Chưa có zalo_links cho ${memberId}`);
    }
    const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error(`Thiếu chatId cho ${memberId}`);
    }
    return chatId;
}
async function uploadPdfAndGetSignedUrl(buf, fileName) {
    const bucket = admin.storage().bucket();
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const path = `warehouse-training-quiz/${yyyy}${mm}${dd}/${hh}${mi}${ss}_${fileName}`.replace(/[^\w./-]/g, '_');
    const file = bucket.file(path);
    await file.save(buf, {
        contentType: 'application/pdf',
        resumable: false,
        metadata: { cacheControl: 'private, max-age=0, no-transform' }
    });
    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    return url;
}
async function sendWarehouseTrainingQuizPdfZalo(db, payload) {
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const buf = decodePdfDataUrl(payload.pdfDataUrl);
    if (!(buf === null || buf === void 0 ? void 0 : buf.length))
        throw new Error('PDF rỗng');
    const employeeId = safeText(payload.employeeId, 40);
    const fullName = safeText(payload.fullName, 120);
    const joinDate = safeText(payload.joinDate, 40);
    const resultText = safeText(payload.resultText, 600);
    const baseName = `${employeeId || 'NV'}_${fullName || 'nhan-vien'}`.replace(/\s+/g, '_');
    const signedUrl = await uploadPdfAndGetSignedUrl(buf, `${baseName}.pdf`);
    const chatId = await lookupChatId(db, TARGET_MEMBER_ID);
    const atStr = vnNowLabel(new Date());
    const msg = `✅ KT đào tạo kho — Hoàn thành\n` +
        `Thời điểm: ${atStr}\n` +
        (fullName ? `Họ tên: ${fullName}\n` : '') +
        (employeeId ? `Mã NV: ${employeeId}\n` : '') +
        (joinDate ? `Ngày vào làm: ${joinDate}\n` : '') +
        (resultText ? `Kết quả: ${resultText}\n` : '') +
        `PDF: ${signedUrl}`;
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
    return { ok: true, url: signedUrl };
}
//# sourceMappingURL=warehouse-training-quiz-zalo.js.map