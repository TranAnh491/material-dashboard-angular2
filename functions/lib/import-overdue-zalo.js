"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runImportOverdueZalo = runImportOverdueZalo;
const zalo_notify_util_1 = require("./zalo-notify.util");
/**
 * Nhắc import dữ liệu tồn kho qua Zalo (nhóm Quản lý kho).
 *
 * Lịch: thứ 2 / 4 / 6 phải import bản mới. Sáng hôm sau (thứ 3 / 5 / 7) lúc 9h, 12h, 15h, 17h:
 * nguồn nào chưa có bản import từ 00:00 ngày hôm trước thì nhắn nhóm. Import xong là lần sau tự hết nhắc.
 */
const ZALO_KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const SOURCES = [
    // FG Overview: import 1 tuần 1 lần vào thứ 5 → nhắc thứ 6
    { label: 'Báo cáo tồn kho TP', tab: 'FG Overview', factory: 'ASM1', doc: 'fg-overview-import-cache/current-asm1', fields: ['updatedAt'], remindDays: [5], schedule: 'thứ 5 hằng tuần' },
    { label: 'Báo cáo tồn kho TP', tab: 'FG Overview', factory: 'ASM2', doc: 'fg-overview-import-cache/current-asm2', fields: ['updatedAt'], remindDays: [5], schedule: 'thứ 5 hằng tuần' },
    { label: 'LinkQ', tab: 'Inventory Overview', factory: 'ASM1', doc: 'linkQFiles/ASM1', fields: ['uploadDate', 'importedAt'], remindDays: [2, 4, 6], schedule: 'thứ 2, 4, 6' },
    { label: 'LinkQ', tab: 'Inventory Overview', factory: 'ASM2', doc: 'linkQFiles/ASM2', fields: ['uploadDate', 'importedAt'], remindDays: [2, 4, 6], schedule: 'thứ 2, 4, 6' }
];
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
function toDate(v) {
    if (!v)
        return null;
    if (typeof v.toDate === 'function')
        return v.toDate();
    const d = v instanceof Date ? v : new Date(v);
    return isFinite(d.getTime()) ? d : null;
}
/** 00:00 (giờ VN) của ngày hôm trước so với `now`. */
function startOfYesterdayVn(now) {
    const vn = new Date(now.getTime() + VN_OFFSET_MS);
    const midnightVnUtcMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN_OFFSET_MS;
    return new Date(midnightVnUtcMs - 24 * 60 * 60 * 1000);
}
function fmtVn(d) {
    if (!d)
        return 'chưa có';
    return d.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}
const WEEKDAY_VN = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
async function runImportOverdueZalo(db, now = new Date(), opts = {}) {
    var _a;
    const since = startOfYesterdayVn(now);
    const overdue = [];
    const todayVn = new Date(now.getTime() + VN_OFFSET_MS).getUTCDay();
    for (const s of SOURCES.filter((x) => x.remindDays.includes(todayVn))) {
        const snap = await db.doc(s.doc).get();
        const data = (snap.exists ? snap.data() : null) || {};
        let last = null;
        for (const f of s.fields) {
            last = toDate(data[f]);
            if (last)
                break;
        }
        if (!last || last.getTime() < since.getTime())
            overdue.push({ s, last });
    }
    if (!overdue.length)
        return { overdue: [], sent: false, message: '' };
    const dueDay = new Date(since.getTime() + VN_OFFSET_MS);
    const dueLabel = `${WEEKDAY_VN[dueDay.getUTCDay()]} ${String(dueDay.getUTCDate()).padStart(2, '0')}/${String(dueDay.getUTCMonth() + 1).padStart(2, '0')}`;
    const lines = [
        '⚠️ CHƯA IMPORT DỮ LIỆU TỒN KHO',
        `Chưa có bản cập nhật của ${dueLabel}:`,
        ...overdue.map(o => `• ${o.s.tab} – ${o.s.label} ${o.s.factory} (lịch import: ${o.s.schedule}): lần gần nhất ${fmtVn(o.last)}`),
        '',
        'Vui lòng import bản mới. Bot nhắc lại lúc 9h, 12h, 15h, 17h hôm nay cho tới khi có bản cập nhật.'
    ];
    const message = lines.join('\n');
    if (opts.dryRun)
        return { overdue: overdue.map(o => `${o.s.tab} ${o.s.factory}`), sent: false, message };
    const groupDoc = await db.doc(ZALO_KHO_GROUP_DOC).get();
    const chatId = String(((_a = groupDoc.data()) === null || _a === void 0 ? void 0 : _a.chatId) || '').trim();
    if (!chatId) {
        console.error('import-overdue-zalo: chưa gắn nhóm Quản lý kho trong', ZALO_KHO_GROUP_DOC);
        return { overdue: overdue.map(o => `${o.s.tab} ${o.s.factory}`), sent: false, message };
    }
    const sent = await (0, zalo_notify_util_1.sendZaloToChat)(chatId, message);
    return { overdue: overdue.map(o => `${o.s.tab} ${o.s.factory}`), sent, message };
}
//# sourceMappingURL=import-overdue-zalo.js.map