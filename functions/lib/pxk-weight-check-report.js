"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyPxkWeightCheckReport = notifyPxkWeightCheckReport;
const params_config_1 = require("./params-config");
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
function vnNowLabel(d = new Date()) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
function clip(value, max) {
    return String(value || '').trim().slice(0, max);
}
async function notifyPxkWeightCheckReport(db, opts) {
    var _a;
    const token = params_config_1.zaloBotToken.value().trim();
    if (!token) {
        throw new Error('Thiếu ZALO_BOT_TOKEN');
    }
    const groupSnap = await db.doc(KHO_GROUP_DOC).get();
    const chatId = String(((_a = groupSnap.data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        throw new Error('Chưa gắn nhóm Quản lý kho trong zalo_group_config/quanly_kho.');
    }
    const lines = [
        '📋 Báo cáo Check lượng PXK',
        `Thời điểm: ${vnNowLabel(new Date())}`,
        clip(opts === null || opts === void 0 ? void 0 : opts.reportedBy, 20) ? `Người gửi: ${clip(opts === null || opts === void 0 ? void 0 : opts.reportedBy, 20)}` : '',
        clip(opts === null || opts === void 0 ? void 0 : opts.lsx, 40) ? `LSX: ${clip(opts === null || opts === void 0 ? void 0 : opts.lsx, 40)}` : '',
        clip(opts === null || opts === void 0 ? void 0 : opts.materialCode, 40) ? `Mã hàng: ${clip(opts === null || opts === void 0 ? void 0 : opts.materialCode, 40)}` : '',
        clip(opts === null || opts === void 0 ? void 0 : opts.maKho, 40) ? `Kho: ${clip(opts === null || opts === void 0 ? void 0 : opts.maKho, 40)}` : '',
        clip(opts === null || opts === void 0 ? void 0 : opts.po, 80) ? `PO: ${clip(opts === null || opts === void 0 ? void 0 : opts.po, 80)}` : '',
        clip(opts === null || opts === void 0 ? void 0 : opts.reason, 400) ? `Lý do: ${clip(opts === null || opts === void 0 ? void 0 : opts.reason, 400)}` : '',
        'Nhóm Quản lý kho: Work Order Status → KHÁC → Danh mục check lượng → Duyệt hoặc Từ chối.'
    ].filter(Boolean);
    const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
    }
}
//# sourceMappingURL=pxk-weight-check-report.js.map