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
exports.sendZaloToChat = sendZaloToChat;
exports.sendZaloToEmployee = sendZaloToEmployee;
exports.sendZaloPhotoByUrl = sendZaloPhotoByUrl;
exports.sendZaloFileToChat = sendZaloFileToChat;
exports.sendZaloFileToEmployee = sendZaloFileToEmployee;
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const ZALO_BOT_URL = (token, method) => `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/${method}`;
async function readBotToken() {
    try {
        return params_config_1.zaloBotToken.value().trim();
    }
    catch (_a) {
        return '';
    }
}
async function resolveZaloChatId(memberId) {
    var _a;
    const token = await readBotToken();
    if (!token || !memberId)
        return null;
    const linkSnap = await admin
        .firestore()
        .collection('zalo_links')
        .where('memberId', '==', memberId)
        .limit(1)
        .get();
    if (linkSnap.empty)
        return null;
    const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId)
        return null;
    return { token, chatId };
}
/**
 * Gửi một tin nhắn Zalo cho nhân viên theo mã ASP — chỉ khi nhân viên đã liên kết
 * bot (nhắn bot: /link → nhập mã ASPxxxx → /id, ghi vào `zalo_links`).
 *
 * Best-effort: chưa liên kết / thiếu ZALO_BOT_TOKEN / lỗi mạng → trả về false,
 * KHÔNG throw (không được làm hỏng luồng tạo tài khoản).
 *
 * Hàm gọi phải khai báo secret ZALO_BOT_TOKEN trong `runWith({ secrets: [zaloBotToken] })`.
 */
async function sendZaloToChat(chatIdRaw, text) {
    try {
        const chatId = String(chatIdRaw || '').trim();
        const token = await readBotToken();
        if (!token || !chatId || !text)
            return false;
        const res = await fetch(ZALO_BOT_URL(token, 'sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 2000) })
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error('sendZaloToChat: sendMessage failed', res.status, JSON.stringify(body));
            return false;
        }
        const body = await res.json().catch(() => ({ ok: true }));
        if (body && body.ok === false) {
            console.error('sendZaloToChat: Zalo ok=false', JSON.stringify(body));
            return false;
        }
        return true;
    }
    catch (e) {
        console.error('sendZaloToChat failed', e);
        return false;
    }
}
async function sendZaloToEmployee(memberIdRaw, text) {
    try {
        const memberId = String(memberIdRaw || '').trim().toUpperCase();
        if (!memberId || !text) {
            return false;
        }
        const link = await resolveZaloChatId(memberId);
        if (!link)
            return false;
        return sendZaloToChat(link.chatId, text);
    }
    catch (e) {
        console.error('sendZaloToEmployee failed', e);
        return false;
    }
}
function guessZaloFileMime(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png'))
        return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
        return 'image/jpeg';
    if (lower.endsWith('.pdf'))
        return 'application/pdf';
    if (lower.endsWith('.txt'))
        return 'text/plain; charset=utf-8';
    if (lower.endsWith('.xlsx')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    return 'application/octet-stream';
}
/** Gửi ảnh: Zalo Bot sendPhoto chỉ nhận URL công khai, không nhận file upload. */
async function sendZaloPhotoByUrl(chatIdRaw, photoUrl, caption) {
    try {
        const chatId = String(chatIdRaw || '').trim();
        const url = String(photoUrl || '').trim();
        const token = await readBotToken();
        if (!token || !chatId || !url)
            return false;
        const res = await fetch(ZALO_BOT_URL(token, 'sendPhoto'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ chat_id: chatId, photo: url }, (caption ? { caption: caption.slice(0, 2000) } : {})))
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || (body === null || body === void 0 ? void 0 : body.ok) === false) {
            console.warn('sendZaloPhotoByUrl failed', res.status, JSON.stringify(body).slice(0, 400));
            return false;
        }
        return true;
    }
    catch (e) {
        console.error('sendZaloPhotoByUrl failed', e);
        return false;
    }
}
/** Gửi file tới chatId (1-1 hoặc nhóm). Thử sendFile / sendDocument; ảnh thử sendPhoto. */
async function sendZaloFileToChat(chatIdRaw, buf, filename, caption) {
    try {
        const chatId = String(chatIdRaw || '').trim();
        const token = await readBotToken();
        if (!token || !chatId || !(buf === null || buf === void 0 ? void 0 : buf.length) || !filename)
            return false;
        const mime = guessZaloFileMime(filename);
        const blob = new Blob([new Uint8Array(buf)], { type: mime });
        const isImage = mime.startsWith('image/');
        const tryMethod = async (method, field) => {
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append(field, blob, filename);
            if (caption)
                form.append('caption', caption.slice(0, 2000));
            const res = await fetch(ZALO_BOT_URL(token, method), { method: 'POST', body: form });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.warn(`sendZaloFileToChat ${method} failed`, res.status, body.slice(0, 400));
                return false;
            }
            return true;
        };
        if (isImage && (await tryMethod('sendPhoto', 'photo')))
            return true;
        if (await tryMethod('sendFile', 'file'))
            return true;
        if (await tryMethod('sendDocument', 'file'))
            return true;
        return false;
    }
    catch (e) {
        console.error('sendZaloFileToChat failed', e);
        return false;
    }
}
/** Gửi file (xlsx/pdf…) qua Zalo bot. Thử sendFile rồi sendDocument. */
async function sendZaloFileToEmployee(memberIdRaw, buf, filename, caption) {
    try {
        const memberId = String(memberIdRaw || '').trim().toUpperCase();
        if (!memberId || !(buf === null || buf === void 0 ? void 0 : buf.length) || !filename)
            return false;
        const link = await resolveZaloChatId(memberId);
        if (!link)
            return false;
        return sendZaloFileToChat(link.chatId, buf, filename, caption);
    }
    catch (e) {
        console.error('sendZaloFileToEmployee failed', e);
        return false;
    }
}
//# sourceMappingURL=zalo-notify.util.js.map