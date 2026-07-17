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
exports.requestCatalogDeleteOtp = requestCatalogDeleteOtp;
exports.verifyCatalogDeleteOtp = verifyCatalogDeleteOtp;
const admin = __importStar(require("firebase-admin"));
const params_config_1 = require("./params-config");
const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COLLECTION = 'catalog-delete-otp';
const SCOPE_LABEL = {
    nvl: 'Danh mục NVL',
    tp: 'Danh mục TP & Mapping KH'
};
function normalizeScope(raw) {
    return raw === 'tp' ? 'tp' : 'nvl';
}
function random4DigitCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
async function sendOtpToZalo(db, code, token, scope, requestedBy) {
    var _a;
    const linkSnap = await db.collection('zalo_links').where('memberId', '==', OTP_RECIPIENT_ID).limit(1).get();
    if (linkSnap.empty) {
        throw new Error(`Chưa có zalo_links cho ${OTP_RECIPIENT_ID}`);
    }
    const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error(`Thiếu chatId cho ${OTP_RECIPIENT_ID}`);
    }
    const atStr = vnNowLabel(new Date());
    const requesterLine = requestedBy ? `Người yêu cầu: ${requestedBy}\n` : '';
    const msg = `🚨 Yêu cầu XÓA TOÀN BỘ ${SCOPE_LABEL[scope]}\n` +
        `Thời điểm: ${atStr}\n` +
        requesterLine +
        `Mã xác nhận: ${code}\n` +
        `Hiệu lực: 10 phút (một lần dùng)\n` +
        `⚠️ Hành động không thể hoàn tác — chỉ cung cấp mã nếu bạn chắc chắn yêu cầu này hợp lệ.`;
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
}
async function requestCatalogDeleteOtp(db, scopeRaw, requestedByRaw) {
    const scope = normalizeScope(scopeRaw);
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const requestedBy = String(requestedByRaw || '').trim().toUpperCase().slice(0, 20);
    const code = random4DigitCode();
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
    await db.collection(OTP_COLLECTION).doc(scope).set({
        code,
        scope,
        recipientId: OTP_RECIPIENT_ID,
        requestedBy,
        expiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await sendOtpToZalo(db, code, token, scope, requestedBy);
}
async function verifyCatalogDeleteOtp(db, scopeRaw, codeRaw) {
    var _a, _b, _c;
    const scope = normalizeScope(scopeRaw);
    const code = String(codeRaw || '').trim();
    if (!/^\d{4}$/.test(code)) {
        throw new Error('Mã OTP phải gồm 4 chữ số.');
    }
    const ref = db.collection(OTP_COLLECTION).doc(scope);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new Error('Chưa có mã OTP. Vui lòng yêu cầu gửi lại qua Zalo.');
    }
    const data = snap.data();
    const stored = String(data.code || '').trim();
    const expiresMs = (_c = (_b = (_a = data.expiresAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0;
    if (Date.now() > expiresMs) {
        await ref.delete().catch(() => undefined);
        throw new Error('Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.');
    }
    if (stored !== code) {
        throw new Error('Mã OTP không đúng.');
    }
    await ref.delete();
    return { ok: true };
}
//# sourceMappingURL=catalog-delete-otp.js.map