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
exports.sendTelegramNotification = exports.placeholder = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
// Stub: health check khi deploy Functions.
exports.placeholder = functions.https.onRequest((req, res) => {
    res.status(200).send('OK');
});
/**
 * Gửi tin nhắn Telegram (bot → group) — token chỉ nằm trên server.
 * Cấu hình: firebase functions:config:set telegram.bot_token="..." telegram.chat_id="-100..."
 * Gọi từ Angular: httpsCallable(getFunctions(app), 'sendTelegramNotification')({ text: '...' })
 */
exports.sendTelegramNotification = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const text = typeof (data === null || data === void 0 ? void 0 : data.text) === 'string' ? data.text.trim() : '';
    if (!text) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu nội dung.');
    }
    const cfg = functions.config().telegram || {};
    const botToken = cfg.bot_token;
    const chatId = cfg.chat_id;
    if (!botToken || !chatId) {
        throw new functions.https.HttpsError('failed-precondition', 'Chưa cấu hình telegram.bot_token / telegram.chat_id trên Functions.');
    }
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
    });
    if (!res.ok) {
        const errBody = await res.text();
        console.error('Telegram API error', res.status, errBody);
        throw new functions.https.HttpsError('internal', 'Gửi Telegram thất bại.');
    }
    return { ok: true };
});
//# sourceMappingURL=index.js.map