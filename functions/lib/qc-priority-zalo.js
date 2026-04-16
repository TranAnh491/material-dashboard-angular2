"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendQcPriorityStatusChangedZalo = sendQcPriorityStatusChangedZalo;
const params_config_1 = require("./params-config");
const TARGET_MEMBER_ID = 'ASP0609';
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
async function sendQcPriorityStatusChangedZalo(db, p) {
    var _a;
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const linkSnap = await db
        .collection('zalo_links')
        .where('memberId', '==', TARGET_MEMBER_ID)
        .limit(1)
        .get();
    if (linkSnap.empty) {
        throw new Error(`Chưa có zalo_links cho ${TARGET_MEMBER_ID}`);
    }
    const chatId = String(((_a = linkSnap.docs[0].data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error(`Thiếu chatId cho ${TARGET_MEMBER_ID}`);
    }
    const atStr = vnNowLabel(new Date());
    const msg = `⚠️ QC ưu tiên (ASM1) đã đổi trạng thái\n` +
        `Thời điểm: ${atStr}\n` +
        `Mã: ${p.materialCode}\n` +
        (p.poNumber ? `PO: ${p.poNumber}\n` : '') +
        (p.imd ? `IMD/Batch: ${p.imd}\n` : '') +
        (p.location ? `Vị trí: ${p.location}\n` : '') +
        `Trạng thái: ${p.oldStatus} → ${p.newStatus}\n` +
        (p.checkedBy ? `Người kiểm: ${p.checkedBy}` : '');
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
//# sourceMappingURL=qc-priority-zalo.js.map