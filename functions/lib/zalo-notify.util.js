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
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const ZALO_SEND_MESSAGE_URL = (token) => `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
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
    var _a;
    try {
        const memberId = String(memberIdRaw || '').trim().toUpperCase();
        if (!memberId || !text) {
            return false;
        }
        let token = '';
        try {
            token = params_config_1.zaloBotToken.value().trim();
        }
        catch (_b) {
            token = '';
        }
        if (!token) {
            return false;
        }
        const linkSnap = await admin
            .firestore()
            .collection('zalo_links')
            .where('memberId', '==', memberId)
            .limit(1)
            .get();
        if (linkSnap.empty) {
            return false;
        }
        const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
        if (!chatId) {
            return false;
        }
        const res = await fetch(ZALO_SEND_MESSAGE_URL(token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text })
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
//# sourceMappingURL=zalo-notify.util.js.map