"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyInventoryStockReport = notifyInventoryStockReport;
const params_config_1 = require("./params-config");
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
function clip(value, max) {
    return String(value !== null && value !== void 0 ? value : '').trim().slice(0, max);
}
async function notifyInventoryStockReport(db, opts) {
    var _a;
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token)
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    const groupSnap = await db.doc(KHO_GROUP_DOC).get();
    const chatId = String(((_a = groupSnap.data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId)
        throw new Error('Chưa gắn nhóm Quản lý kho trong zalo_group_config/quanly_kho.');
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const lines = [
        `📦 Báo cáo tồn kho: ${clip(opts.status, 40) || 'Đã hết stock'}`,
        `Thời điểm: ${now}`,
        clip(opts.reportedBy, 20) ? `Người báo: ${clip(opts.reportedBy, 20)}` : '',
        clip(opts.factory, 10) ? `Nhà máy: ${clip(opts.factory, 10)}` : '',
        `Mã hàng: ${clip(opts.materialCode, 40)}`,
        clip(opts.po, 80) ? `PO: ${clip(opts.po, 80)}` : '',
        clip(opts.imd, 20) ? `IMD: ${clip(opts.imd, 20)}` : '',
        clip(opts.stock, 20) ? `Tồn trên web: ${clip(opts.stock, 20)}` : '',
        clip(opts.location, 40) ? `Vị trí: ${clip(opts.location, 40)}` : '',
        clip(opts.detail, 500) || 'Thực tế đã hết hàng nhưng web còn tồn — kiểm tra và điều chỉnh tồn kho.'
    ].filter(Boolean);
    const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
}
//# sourceMappingURL=inventory-stock-report.js.map