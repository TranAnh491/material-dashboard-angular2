"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMaterialLocationAlertZalo = sendMaterialLocationAlertZalo;
const params_config_1 = require("./params-config");
const TARGET_MEMBER_ID = 'ASP0106';
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
async function sendMaterialLocationAlertZalo(db, p) {
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
    const factory = String(p.factory || '').trim() || '—';
    const materialCode = String(p.materialCode || '').trim() || '—';
    const poNumber = String(p.poNumber || '').trim();
    const reportedLocation = String(p.reportedLocation || '').trim();
    const reportedBy = String(p.reportedBy || '').trim();
    const note = String(p.message || 'Sai vị trí').trim();
    const msg = `⚠️ Cảnh báo NVL — sai vị trí (Location)\n` +
        `Thời điểm: ${atStr}\n` +
        `Nhà máy: ${factory}\n` +
        `Mã hàng: ${materialCode}\n` +
        (poNumber ? `PO: ${poNumber}\n` : '') +
        (reportedLocation ? `Vị trí báo cáo: ${reportedLocation}\n` : '') +
        `Nội dung: ${note}\n` +
        (reportedBy ? `Người báo: ${reportedBy}` : '');
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
//# sourceMappingURL=material-location-alert-zalo.js.map