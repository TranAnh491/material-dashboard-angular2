"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCreatedByEmpty = isCreatedByEmpty;
exports.normalizeAspEmployeeId = normalizeAspEmployeeId;
exports.findLatestOutboundEmployeeId = findLatestOutboundEmployeeId;
exports.sendWorkOrderKittingZalo = sendWorkOrderKittingZalo;
exports.handleWorkOrderKittingZaloNotify = handleWorkOrderKittingZaloNotify;
const params_config_1 = require("./params-config");
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
/** Người soạn chưa gán (trống / placeholder import). */
function isCreatedByEmpty(createdBy) {
    const s = String(createdBy !== null && createdBy !== void 0 ? createdBy : '').trim();
    if (!s)
        return true;
    const lower = s.toLowerCase();
    if (lower === 'excel import' || lower === 'chưa có')
        return true;
    return false;
}
function normalizeAspEmployeeId(raw) {
    const s = String(raw !== null && raw !== void 0 ? raw : '').trim().toUpperCase().replace(/\s+/g, '');
    if (!s)
        return '';
    if (/^\d{4}$/.test(s))
        return `ASP${s}`;
    if (/^ASP\d{4}$/.test(s))
        return s;
    return '';
}
function toMillis(v) {
    if (!v)
        return 0;
    if (typeof v.toDate === 'function') {
        return v.toDate().getTime();
    }
    if (v instanceof Date)
        return v.getTime();
    const n = new Date(v).getTime();
    return Number.isNaN(n) ? 0 : n;
}
function pickEmployeeIdFromOutbound(data) {
    const fromEmp = normalizeAspEmployeeId(data.employeeId);
    if (fromEmp)
        return fromEmp;
    return normalizeAspEmployeeId(data.exportedBy);
}
/**
 * Cách B: người quét outbound gần nhất của LSX (theo createdAt trên outbound-materials).
 */
async function findLatestOutboundEmployeeId(db, productionOrder, factory) {
    var _a, _b;
    const lsx = String(productionOrder !== null && productionOrder !== void 0 ? productionOrder : '').trim();
    if (!lsx)
        return null;
    const factoryNorm = String(factory !== null && factory !== void 0 ? factory : '').trim().toUpperCase();
    const candidates = [lsx, lsx.toUpperCase()];
    const seenLsx = new Set();
    let best = null;
    for (const qLsx of candidates) {
        if (!qLsx || seenLsx.has(qLsx))
            continue;
        seenLsx.add(qLsx);
        const snap = await db
            .collection('outbound-materials')
            .where('productionOrder', '==', qLsx)
            .limit(300)
            .get();
        for (const doc of snap.docs) {
            const data = doc.data();
            if (factoryNorm && factoryNorm !== 'ALL') {
                const rowFactory = String((_a = data.factory) !== null && _a !== void 0 ? _a : '').trim().toUpperCase();
                if (rowFactory && rowFactory !== factoryNorm)
                    continue;
            }
            const employeeId = pickEmployeeIdFromOutbound(data);
            if (!employeeId)
                continue;
            const at = Math.max(toMillis(data.createdAt), toMillis(data.updatedAt), toMillis(data.exportDate));
            if (!best || at >= best.at) {
                best = { employeeId, at };
            }
        }
    }
    return (_b = best === null || best === void 0 ? void 0 : best.employeeId) !== null && _b !== void 0 ? _b : null;
}
async function resolveZaloChatId(db, memberId) {
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
async function sendWorkOrderKittingZalo(db, ctx) {
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const memberId = normalizeAspEmployeeId(ctx.employeeId);
    if (!memberId) {
        throw new Error('employeeId outbound không hợp lệ');
    }
    const chatId = await resolveZaloChatId(db, memberId);
    const atStr = vnNowLabel(new Date());
    const lsx = String(ctx.productionOrder || '').trim() || '—';
    const factory = String(ctx.factory || '').trim() || '—';
    const msg = `📦 Lệnh Kitting — chưa có người soạn\n` +
        `Thời điểm: ${atStr}\n` +
        `LSX: ${lsx}\n` +
        `Nhà máy: ${factory}\n` +
        `Bạn là người quét outbound gần nhất của lệnh này.\n` +
        `Vui lòng cập nhật cột「Người soạn」trên Work Order Status.`;
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
/** Firestore onUpdate: status → kitting, chưa có người soạn → Zalo người outbound gần nhất. */
async function handleWorkOrderKittingZaloNotify(db, before, after, workOrderId) {
    var _a, _b, _c, _d;
    const oldStatus = String((_a = before.status) !== null && _a !== void 0 ? _a : '').trim().toLowerCase();
    const newStatus = String((_b = after.status) !== null && _b !== void 0 ? _b : '').trim().toLowerCase();
    if (newStatus !== 'kitting' || oldStatus === 'kitting') {
        return;
    }
    if (!isCreatedByEmpty(after.createdBy)) {
        return;
    }
    const productionOrder = String((_c = after.productionOrder) !== null && _c !== void 0 ? _c : '').trim();
    if (!productionOrder) {
        console.warn('work-order-kitting-zalo: thiếu productionOrder', workOrderId);
        return;
    }
    const factory = String((_d = after.factory) !== null && _d !== void 0 ? _d : '').trim();
    const employeeId = await findLatestOutboundEmployeeId(db, productionOrder, factory);
    if (!employeeId) {
        console.warn('work-order-kitting-zalo: không tìm thấy outbound gần nhất', workOrderId, productionOrder);
        return;
    }
    await sendWorkOrderKittingZalo(db, {
        workOrderId,
        productionOrder,
        factory,
        employeeId
    });
    console.log('work-order-kitting-zalo: sent', workOrderId, productionOrder, employeeId);
}
//# sourceMappingURL=work-order-kitting-zalo.js.map