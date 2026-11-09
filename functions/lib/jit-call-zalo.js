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
exports.onJitCallLogCreated = onJitCallLogCreated;
exports.runJitScheduledCalls = runJitScheduledCalls;
const admin = __importStar(require("firebase-admin"));
const zalo_notify_util_1 = require("./zalo-notify.util");
/**
 * JIT (Production): gọi kho lấy hàng cho LSX.
 * - jit-call-log/{id} mới (nút Gọi hoặc hẹn giờ) → Zalo bot nhắn nhóm Kho.
 * - jit-calls/{woId}.nextCallAt tới giờ → tự tạo log gọi (auto) + hẹn lần sau theo mẫu của mã TP.
 */
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const ROUNDS = 3;
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
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
async function onJitCallLogCreated(db, ref, d) {
    var _a;
    const lsx = String(d['lsx'] || '').trim();
    if (!lsx)
        return;
    const round = Number(d['round']) || 1;
    const auto = !!d['auto'];
    const qty = Number(d['quantity']) || 0;
    const lines = [
        `📦 JIT — GỌI KHO LẤY HÀNG${auto ? ' (hẹn giờ)' : ''}`,
        `LSX: ${lsx}${d['factory'] ? ` (${d['factory']})` : ''}`,
        `Mã TP: ${d['productCode'] || '—'}${qty ? ` · SL ${qty.toLocaleString('en-US')}` : ''}`,
        d['customer'] ? `Khách: ${d['customer']}` : '',
        d['line'] ? `Line: ${d['line']}` : '',
        `Lần lấy: ${round}/${ROUNDS}`,
        auto ? 'Gọi tự động theo giờ hẹn' : `Người gọi: ${d['by'] || '—'}`,
        `Lúc: ${vnTime(toDate(d['at']) || new Date())}`
    ].filter(Boolean);
    const items = (Array.isArray(d['items']) ? d['items'] : []);
    if (items.length) {
        lines.push('', `NVL đưa lên line lần ${round} (${items.length} mã):`);
        const MAX = 40;
        items.slice(0, MAX).forEach((it, i) => {
            const rolls = Number(it.rolls) || 0;
            const qty = `${(Number(it.qty) || 0).toLocaleString('en-US')} ${it.unit || ''}`.trim();
            lines.push(`${i + 1}. ${it.code || ''}${it.po ? ' · ' + it.po : ''}: ${rolls > 0 ? `${rolls} cuộn (${qty})` : qty}`);
        });
        if (items.length > MAX)
            lines.push(`… và ${items.length - MAX} mã khác (xem trang JIT)`);
    }
    const groupSnap = await db.doc(KHO_GROUP_DOC).get();
    const chatId = String(((_a = groupSnap.data()) === null || _a === void 0 ? void 0 : _a['chatId']) || '').trim();
    if (!chatId) {
        await ref.set({ sent: false, error: 'Chưa gắn nhóm Kho (zalo_group_config/quanly_kho)' }, { merge: true });
        return;
    }
    const ok = await (0, zalo_notify_util_1.sendZaloToChat)(chatId, lines.join('\n').slice(0, 1990));
    await ref.set({ sent: ok, sentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}
/** Mỗi 5 phút: LSX tới giờ hẹn → tạo log gọi (trigger gửi Zalo), hẹn lần sau theo mẫu mã TP. */
async function runJitScheduledCalls(db) {
    var _a;
    const now = new Date();
    const snap = await db.collection('jit-calls').where('nextCallAt', '<=', now).get();
    for (const doc of snap.docs) {
        const d = doc.data();
        if (!toDate(d['nextCallAt']))
            continue;
        const picks = Array.isArray(d['picks']) ? d['picks'] : [];
        const idx = picks.findIndex((x) => !x);
        const round = idx < 0 ? ROUNDS : idx + 1;
        const calls = Array.isArray(d['calls']) ? d['calls'] : [];
        const newCalls = [...calls, { at: now, round, by: 'BOT', auto: true }];
        let next = null;
        const code = String(d['productCode'] || '').trim();
        if (code && newCalls.length < ROUNDS && !picks.every(Boolean)) {
            const pat = (await db.collection('jit-product-pattern').doc(code).get()).data();
            const gap = Number((_a = pat === null || pat === void 0 ? void 0 : pat.gapsMin) === null || _a === void 0 ? void 0 : _a[newCalls.length - 1]) || 0;
            if (gap > 0)
                next = new Date(now.getTime() + gap * 60000);
        }
        await db.collection('jit-call-log').add({
            woId: doc.id, lsx: d['lsx'] || '', productCode: code, factory: d['factory'] || '',
            quantity: d['quantity'] || 0, customer: d['customer'] || '', line: d['line'] || '',
            round, by: 'BOT', auto: true, at: now,
            // NVL của lần lấy này theo sắp xếp đã lưu
            items: Object.values((d['plan'] || {}))
                .filter((p) => { var _a; return (Number((_a = p === null || p === void 0 ? void 0 : p.q) === null || _a === void 0 ? void 0 : _a[round - 1]) || 0) > 0; })
                .map((p) => { var _a; return ({ code: p.code || '', po: p.po || '', qty: Number(p.q[round - 1]) || 0, unit: p.unit || '', rolls: Number((_a = p === null || p === void 0 ? void 0 : p.rolls) === null || _a === void 0 ? void 0 : _a[round - 1]) || 0 }); })
        });
        await doc.ref.set({ calls: newCalls, lastCallAt: now, nextCallAt: next, updatedAt: now }, { merge: true });
    }
}
//# sourceMappingURL=jit-call-zalo.js.map