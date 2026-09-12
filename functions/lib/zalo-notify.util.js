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
exports.sendZaloToEmployee = sendZaloToEmployee;
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
async function sendZaloToEmployee(memberIdRaw, text) {
    try {
        const memberId = String(memberIdRaw || '').trim().toUpperCase();
        if (!memberId || !text) {
            return false;
        }
        const link = await resolveZaloChatId(memberId);
        if (!link)
            return false;
        const res = await fetch(ZALO_BOT_URL(link.token, 'sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: link.chatId, text: text.slice(0, 2000) })
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error('sendZaloToEmployee: Zalo sendMessage failed', res.status, JSON.stringify(body));
            return false;
        }
        return true;
    }
    catch (e) {
        console.error('sendZaloToEmployee failed', e);
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
        const mime = filename.toLowerCase().endsWith('.xlsx')
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/octet-stream';
        const blob = new Blob([new Uint8Array(buf)], { type: mime });
        const tryMethod = async (method) => {
            const form = new FormData();
            form.append('chat_id', link.chatId);
            form.append('file', blob, filename);
            if (caption)
                form.append('caption', caption.slice(0, 2000));
            const res = await fetch(ZALO_BOT_URL(link.token, method), { method: 'POST', body: form });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.warn(`sendZaloFileToEmployee ${method} failed`, res.status, body.slice(0, 400));
                return false;
            }
            return true;
        };
        if (await tryMethod('sendFile'))
            return true;
        if (await tryMethod('sendDocument'))
            return true;
        return false;
    }
    catch (e) {
        console.error('sendZaloFileToEmployee failed', e);
        return false;
    }
}
//# sourceMappingURL=zalo-notify.util.js.map