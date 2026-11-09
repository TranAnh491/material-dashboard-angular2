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
exports.notifyNegativeStockOnWrite = notifyNegativeStockOnWrite;
const admin = __importStar(require("firebase-admin"));
const zalo_notify_util_1 = require("./zalo-notify.util");
/**
 * Tồn NVL âm (≤ -1) → Zalo nhóm Kho: mã, PO, vị trí, tồn và các lần xuất gần nhất (LSX + người scan).
 * Chỉ báo khi tồn vừa xuống ≤ -1 (trước đó > -1), mỗi dòng tồn tối đa 1 lần / 6 giờ.
 */
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const DEDUPE_COLLECTION = 'negative-stock-zalo';
const DEDUPE_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_THRESHOLD = -1;
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function stockOf(d) {
    const opening = d['openingStock'] != null && d['openingStock'] !== '' ? num(d['openingStock']) : 0;
    return opening + num(d['quantity']) - num(d['exported']) - num(d['xt']);
}
function fmt(n) {
    return (Math.round(n * 1000) / 1000).toLocaleString('en-US');
}
function toDate(v) {
    if (!v)
        return null;
    if (v instanceof admin.firestore.Timestamp)
        return v.toDate();
    if (v instanceof Date)
        return v;
    const t = v;
    if (typeof t.toDate === 'function')
        return t.toDate();
    if (typeof t.seconds === 'number')
        return new Date(t.seconds * 1000);
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
}
function vnTime(d) {
    if (!d)
        return '';
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const normPo = (s) => String(s !== null && s !== void 0 ? s : '').trim().toUpperCase().replace(/\s+/g, '');
async function notifyNegativeStockOnWrite(db, docId, before, after) {
    var _a, _b, _c;
    if (!after)
        return;
    const code = String(after['materialCode'] || '').trim().toUpperCase();
    if (!code)
        return;
    const stockAfter = stockOf(after);
    if (stockAfter > NEGATIVE_THRESHOLD)
        return;
    // Chỉ khi vừa vượt ngưỡng (tránh báo lại mỗi lần ghi khi đã âm sẵn)
    if (before && stockOf(before) <= NEGATIVE_THRESHOLD)
        return;
    const dedupeRef = db.collection(DEDUPE_COLLECTION).doc(docId);
    const ok = await db.runTransaction(async (tx) => {
        var _a, _b;
        const snap = await tx.get(dedupeRef);
        const last = ((_b = toDate((_a = snap.data()) === null || _a === void 0 ? void 0 : _a['sentAt'])) === null || _b === void 0 ? void 0 : _b.getTime()) || 0;
        if (Date.now() - last < DEDUPE_MS)
            return false;
        tx.set(dedupeRef, { sentAt: admin.firestore.FieldValue.serverTimestamp(), materialCode: code, stock: stockAfter });
        return true;
    });
    if (!ok)
        return;
    const factory = String(after['factory'] || '').trim();
    const po = String(after['poNumber'] || '').trim();
    const location = String((_b = (_a = after['location']) !== null && _a !== void 0 ? _a : after['viTri']) !== null && _b !== void 0 ? _b : '').trim();
    // Các lần xuất mã + PO này (LSX, người scan) — lọc trong bộ nhớ để không cần index ghép
    const outSnap = await db.collection('outbound-materials').where('materialCode', '==', code).get();
    const outs = outSnap.docs
        .map((d) => d.data())
        .filter((o) => (!factory || String(o['factory'] || '') === factory) && (!po || normPo(o['poNumber']) === normPo(po)))
        .map((o) => {
        var _a;
        return ({
            at: toDate(o['exportDate']) || toDate(o['createdAt']),
            lsx: String(o['productionOrder'] || '').trim(),
            by: String(o['exportedBy'] || o['employeeId'] || '').trim(),
            qty: num((_a = o['exportQuantity']) !== null && _a !== void 0 ? _a : o['quantity']),
            method: String(o['scanMethod'] || '').trim()
        });
    })
        .sort((a, b) => { var _a, _b; return (((_a = b.at) === null || _a === void 0 ? void 0 : _a.getTime()) || 0) - (((_b = a.at) === null || _b === void 0 ? void 0 : _b.getTime()) || 0); });
    const recent = outs.slice(0, 6);
    const byLsx = new Map();
    for (const o of outs)
        byLsx.set(o.lsx || '(không LSX)', (byLsx.get(o.lsx || '(không LSX)') || 0) + o.qty);
    const opening = after['openingStock'] != null && after['openingStock'] !== '' ? num(after['openingStock']) : 0;
    const lines = [
        `⚠️ Tồn NVL âm (${factory || '—'})`,
        `Mã: ${code}${po ? ` · PO ${po}` : ''}`,
        `Vị trí: ${location || '(chưa có)'}`,
        `Tồn: ${fmt(stockAfter)} (đầu kỳ ${fmt(opening)} + nhập ${fmt(num(after['quantity']))} − xuất ${fmt(num(after['exported']))} − XT ${fmt(num(after['xt']))})`,
    ];
    if (recent.length) {
        lines.push('', 'Các lần xuất gần nhất (mới nhất trước):');
        recent.forEach((o, i) => {
            lines.push(`${i === 0 ? '👉' : '-'} ${vnTime(o.at)} · LSX ${o.lsx || '—'} · ${o.by || 'không rõ người scan'} · ${fmt(o.qty)}${o.method ? ` (${o.method})` : ''}`);
        });
        if (byLsx.size > 1) {
            lines.push('', 'Tổng xuất theo LSX:');
            [...byLsx.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
                .forEach(([lsx, q]) => lines.push(`- ${lsx}: ${fmt(q)}`));
        }
    }
    else {
        lines.push('', 'Không tìm thấy lần xuất nào của mã + PO này (có thể âm do sửa tay / XT).');
    }
    const groupSnap = await db.doc(KHO_GROUP_DOC).get();
    const chatId = String(((_c = groupSnap.data()) === null || _c === void 0 ? void 0 : _c['chatId']) || '').trim();
    if (!chatId) {
        console.warn('[negative-stock-zalo] Chưa gắn nhóm Kho (zalo_group_config/quanly_kho)');
        return;
    }
    await (0, zalo_notify_util_1.sendZaloToChat)(chatId, lines.join('\n').slice(0, 1990));
}
//# sourceMappingURL=negative-stock-zalo.js.map