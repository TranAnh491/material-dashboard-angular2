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
exports.notifyReadyPhotoRequired = notifyReadyPhotoRequired;
/**
 * LSX chuyển Ready ở Line cần chụp hình (WHA / WHB / WHG / WHH, USB C):
 * Zalo riêng cho từng người trong team soạn (khớp tên / mã ASP với zalo_links).
 */
const admin = __importStar(require("firebase-admin"));
const zalo_notify_util_1 = require("./zalo-notify.util");
const NOTICE_COLLECTION = 'ready-photo-zalo';
function fold(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function lsxDocId(lsx) {
    return lsx
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/\//g, '_')
        .replace(/[^A-Z0-9._-]/g, '')
        .slice(0, 80);
}
/** Khớp tên đúng trước ("Tuấn" ↔ "Tuấn"); không có thì khớp chữ đầu nếu chỉ 1 người ("Tình" ↔ "Tình mlem"). */
function matchLinks(names, links) {
    const out = new Map();
    for (const raw of names) {
        const n = fold(raw);
        if (!n)
            continue;
        const exact = links.filter((l) => fold(l.name) === n);
        const pick = exact.length ? exact : links.filter((l) => fold(l.name).split(' ')[0] === n);
        if (pick.length === 1)
            out.set(pick[0].memberId, pick[0]);
    }
    return out;
}
async function notifyReadyPhotoRequired(db, opts) {
    var _a, _b, _c;
    const lsx = String(opts.lsx || '').trim().slice(0, 40);
    const docId = lsxDocId(lsx);
    if (!lsx || !docId)
        throw new Error('Thiếu LSX.');
    const line = String(opts.line || '').trim().slice(0, 40);
    const noticeRef = db.collection(NOTICE_COLLECTION).doc(docId);
    const prev = await noticeRef.get();
    const prevAt = ((_c = (_b = (_a = prev.data()) === null || _a === void 0 ? void 0 : _a.notifiedAt) === null || _b === void 0 ? void 0 : _b.toMillis) === null || _c === void 0 ? void 0 : _c.call(_b)) || 0;
    // Đổi qua lại Ready trong 12h → không nhắn lại.
    if (prevAt && Date.now() - prevAt < 12 * 3600 * 1000)
        return { sentTo: [], skipped: true };
    const snap = await db.collection('zalo_links').get();
    const links = snap.docs
        .map((d) => d.data())
        .filter((d) => (d === null || d === void 0 ? void 0 : d.enabled) !== false && (d === null || d === void 0 ? void 0 : d.chatId) && (d === null || d === void 0 ? void 0 : d.memberId))
        .map((d) => ({
        memberId: String(d.memberId).trim().toUpperCase(),
        name: String(d.name || '').trim(),
        chatId: String(d.chatId).trim()
    }));
    const targets = matchLinks((opts.names || []).slice(0, 20), links);
    for (const id of (opts.memberIds || []).slice(0, 5)) {
        const m = links.find((l) => l.memberId === String(id || '').trim().toUpperCase());
        if (m)
            targets.set(m.memberId, m);
    }
    if (!targets.size)
        return { sentTo: [], skipped: false };
    const factory = String(opts.factory || '').trim().slice(0, 16);
    const productCode = String(opts.productCode || '').trim().slice(0, 40);
    const team = String(opts.team || '').trim().slice(0, 40);
    const text = [
        `📸 CẦN CHỤP HÌNH — LSX ${lsx} đã READY`,
        `Line nhận: ${line}${factory ? ` · ${factory}` : ''}`,
        productCode ? `Mã TP: ${productCode}` : '',
        team ? `Team soạn: ${team}` : '',
        'Line này yêu cầu chụp hình hàng khi giao — nhớ chụp trước khi giao LSX.'
    ]
        .filter(Boolean)
        .join('\n');
    const sentTo = [];
    for (const t of targets.values()) {
        if (await (0, zalo_notify_util_1.sendZaloToChat)(t.chatId, text))
            sentTo.push(`${t.name} (${t.memberId})`);
    }
    if (sentTo.length) {
        await noticeRef.set({
            lsx,
            line,
            factory,
            team,
            sentTo,
            notifiedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    return { sentTo, skipped: false };
}
//# sourceMappingURL=ready-photo-zalo.js.map