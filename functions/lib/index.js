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
exports.notifyWaitingWorkOrdersTomorrow = exports.sendTelegramNotification = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
function normalizeNameKey(s) {
    return (s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function pad2(n) {
    return String(n).padStart(2, '0');
}
/** Convert VN local date-time to a UTC Date (VN = UTC+7, no DST). */
function vnToUtcDate(y, m1, d, hh = 0, mm = 0, ss = 0, ms = 0) {
    return new Date(Date.UTC(y, m1 - 1, d, hh - 7, mm, ss, ms));
}
function getTomorrowVnRangeUtc(now = new Date()) {
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const y = vnNow.getUTCFullYear();
    const m1 = vnNow.getUTCMonth() + 1;
    const d = vnNow.getUTCDate();
    const tomorrowD = d + 1;
    const startUtc = vnToUtcDate(y, m1, tomorrowD, 0, 0, 0, 0);
    const endUtc = vnToUtcDate(y, m1, tomorrowD, 23, 59, 59, 999);
    const dateKey = `${y}-${pad2(m1)}-${pad2(tomorrowD)}`;
    return { startUtc, endUtc, dateKey };
}
function parseDeliveryDateToDate(v) {
    if (!v)
        return null;
    if (v instanceof admin.firestore.Timestamp)
        return v.toDate();
    if (v instanceof Date)
        return v;
    if (typeof v === 'string') {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    try {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    catch (_a) {
        return null;
    }
}
function fmtVnDate(d) {
    if (!d)
        return '';
    // Convert to VN date display without bringing in heavy deps
    const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const y = vn.getUTCFullYear();
    const m = vn.getUTCMonth() + 1;
    const day = vn.getUTCDate();
    return `${pad2(day)}/${pad2(m)}/${y}`;
}
function buildWorkOrderLine(wo) {
    const lsx = (wo.productionOrder || '').toString().trim();
    const product = (wo.productCode || '').toString().trim();
    const qty = typeof wo.quantity === 'number' ? wo.quantity : wo.quantity;
    const line = (wo.productionLine || '').toString().trim();
    const delivery = parseDeliveryDateToDate(wo.deliveryDate);
    const deliveryText = fmtVnDate(delivery);
    const bits = [
        lsx ? `LSX: ${lsx}` : '',
        product ? `Mã: ${product}` : '',
        qty != null && qty !== '' ? `Qty: ${qty}` : '',
        line ? `Line: ${line}` : '',
        deliveryText ? `Giao: ${deliveryText}` : ''
    ].filter(Boolean);
    return `- ${bits.join(' | ')}`.slice(0, 4000);
}
function getTelegramCfg() {
    const cfg = functions.config().telegram || {};
    const botToken = cfg.bot_token || '';
    const chatId = cfg.chat_id || '';
    if (!botToken || !chatId) {
        throw new Error('Missing telegram.bot_token / telegram.chat_id');
    }
    return { botToken, chatId };
}
async function sendTelegramToGroup(text) {
    const { botToken, chatId } = getTelegramCfg();
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }),
    });
    if (!res.ok) {
        const errBody = await res.text();
        console.error('Telegram API error', res.status, errBody);
        throw new Error('Telegram send failed');
    }
}
// Map “Người soạn” -> telegram username mention in group
const DEFAULT_MENTIONS = {
    [normalizeNameKey('Tình')]: '@Huutinh789',
    [normalizeNameKey('Tinh')]: '@Huutinh789',
};
/**
 * Gửi tin nhắn Telegram (bot → group) — token chỉ nằm trên server.
 * Cấu hình: firebase functions:config:set telegram.bot_token="..." telegram.chat_id="-100..."
 * Gọi từ Angular: httpsCallable(getFunctions(app), 'sendTelegramNotification')({ text: '...' })
 */
exports.sendTelegramNotification = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Cần đăng nhập.');
    }
    const text = typeof (data === null || data === void 0 ? void 0 : data.text) === 'string' ? data.text.trim() : '';
    if (!text) {
        throw new functions.https.HttpsError('invalid-argument', 'Thiếu nội dung.');
    }
    try {
        await sendTelegramToGroup(text);
    }
    catch (e) {
        const msg = (e === null || e === void 0 ? void 0 : e.message) || ((_a = e === null || e === void 0 ? void 0 : e.toString) === null || _a === void 0 ? void 0 : _a.call(e)) || 'Unknown error';
        throw new functions.https.HttpsError(msg.includes('Missing telegram.bot_token / telegram.chat_id') ? 'failed-precondition' : 'internal', msg.includes('Missing telegram.bot_token / telegram.chat_id')
            ? 'Chưa cấu hình telegram.bot_token / telegram.chat_id trên Functions.'
            : 'Gửi Telegram thất bại.');
    }
    return { ok: true };
});
/**
 * 16:00 mỗi ngày (giờ VN): nhắc các LSX WAITING có ngày giao = ngày mai.
 * Gửi vào group và mention đúng “Người soạn”.
 */
exports.notifyWaitingWorkOrdersTomorrow = functions.pubsub
    .schedule('55 16 * * *')
    .timeZone('Asia/Ho_Chi_Minh')
    .onRun(async () => {
    const db = admin.firestore();
    const { startUtc, endUtc, dateKey } = getTomorrowVnRangeUtc(new Date());
    const startTs = admin.firestore.Timestamp.fromDate(startUtc);
    const endTs = admin.firestore.Timestamp.fromDate(endUtc);
    // Idempotency: avoid duplicate sends on retries
    const lockRef = db.collection('telegram-notify-locks').doc(`wo-waiting-${dateKey}`);
    const canProceed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef);
        if (snap.exists) {
            const data = snap.data();
            if ((data === null || data === void 0 ? void 0 : data.status) === 'sent' || (data === null || data === void 0 ? void 0 : data.status) === 'sending')
                return false;
        }
        tx.set(lockRef, { status: 'sending', startedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return true;
    });
    if (!canProceed)
        return null;
    try {
        const q = db
            .collection('work-orders')
            .where('status', '==', 'WAITING')
            .where('deliveryDate', '>=', startTs)
            .where('deliveryDate', '<=', endTs);
        const snap = await q.get();
        const rows = snap.docs.map(d => d.data());
        if (rows.length === 0) {
            await lockRef.set({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp(), count: 0 }, { merge: true });
            return null;
        }
        // group by createdBy
        const byAuthor = new Map();
        for (const wo of rows) {
            const author = (wo.createdBy || '').toString().trim() || 'Không rõ';
            const list = byAuthor.get(author) || [];
            list.push(wo);
            byAuthor.set(author, list);
        }
        // Build message blocks; keep each message <= 4096 chars
        const header = `📌 NHẮC VIỆC (LSX WAITING) — Giao ngày mai (${dateKey})`;
        const blocks = [];
        let current = header;
        for (const [author, list] of byAuthor.entries()) {
            const key = normalizeNameKey(author);
            const mention = DEFAULT_MENTIONS[key] || (author === 'Không rõ' ? '' : author);
            const sectionTitle = `\n\n👤 ${author}${mention && mention !== author ? ` (${mention})` : mention ? ` — ${mention}` : ''}`;
            const lines = list
                .slice()
                .sort((a, b) => {
                var _a, _b, _c, _d;
                const da = (_b = (_a = parseDeliveryDateToDate(a.deliveryDate)) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0;
                const dbb = (_d = (_c = parseDeliveryDateToDate(b.deliveryDate)) === null || _c === void 0 ? void 0 : _c.getTime()) !== null && _d !== void 0 ? _d : 0;
                return da - dbb;
            })
                .map(buildWorkOrderLine);
            const section = `${sectionTitle}\n${lines.join('\n')}`;
            if ((current + section).length > 3800) {
                blocks.push(current);
                current = header + section;
            }
            else {
                current += section;
            }
        }
        if (current.trim())
            blocks.push(current);
        for (const msg of blocks) {
            await sendTelegramToGroup(msg);
        }
        await lockRef.set({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp(), count: rows.length }, { merge: true });
        return null;
    }
    catch (e) {
        console.error('notifyWaitingWorkOrdersTomorrow failed', e);
        await lockRef.set({ status: 'error', errorAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return null;
    }
});
//# sourceMappingURL=index.js.map