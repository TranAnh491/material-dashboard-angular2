"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEquipmentChecklistZaloRemind = sendEquipmentChecklistZaloRemind;
const zalo_notify_util_1 = require("./zalo-notify.util");
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
/** Ngày lễ cố định hằng năm: Tết Dương lịch, 30/4, 1/5, 2/9. */
const FIXED_HOLIDAYS = ['01-01', '04-30', '05-01', '09-02'];
/**
 * Ngày nghỉ thêm theo thông báo nghỉ lễ.
 * 2026: Tết 16–20/2, Giỗ Tổ 25 và 27/4, Quốc khánh thêm 1/9.
 */
const EXTRA_HOLIDAYS = new Set([
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
    '2026-04-25', '2026-04-27',
    '2026-09-01'
]);
function todayKey(now = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return fmt.format(now);
}
function isSunday(now = new Date()) {
    const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh',
        weekday: 'short'
    }).format(now);
    return weekday === 'Sun';
}
function weekStart(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return date.toISOString().slice(0, 10);
}
function weekdayOf(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}
function isDue(eq, records, day) {
    const id = String(eq.equipmentId || eq.managementCode || '');
    const closed = records.filter(r => r.equipmentId === id && (r.result === 'PASS' || r.result === 'FAIL' || r.result === 'NA'));
    const frequency = eq.frequency || 'daily';
    if (frequency === 'monthly')
        return !closed.some(r => String(r.inspectionDate || '').slice(0, 7) === day.slice(0, 7));
    if (frequency === 'weekly') {
        if (weekdayOf(day) !== 1)
            return false;
        const start = weekStart(day);
        const end = isoAdd(start, 6);
        return !closed.some(r => {
            const date = String(r.inspectionDate || '');
            return date >= start && date <= end;
        });
    }
    return !closed.some(r => r.inspectionDate === day);
}
async function isHoliday(db, day) {
    var _a;
    if (FIXED_HOLIDAYS.includes(day.slice(5)) || EXTRA_HOLIDAYS.has(day))
        return true;
    const snap = await db.collection('warehouse-equipment-meta').doc('holidays').get();
    const dates = ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.dates) || [];
    return dates.includes(day);
}
function isoAdd(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function viDay(iso) {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
}
function overdueDates(eq, records, today, extra) {
    const frequency = eq.frequency || 'daily';
    if (frequency === 'monthly')
        return [];
    let cursor = `${today.slice(0, 7)}-01`;
    const end = isoAdd(today, -1);
    const out = [];
    while (cursor <= end) {
        const off = weekdayOf(cursor) === 0 || FIXED_HOLIDAYS.includes(cursor.slice(5)) || EXTRA_HOLIDAYS.has(cursor) || extra.has(cursor);
        const required = frequency === 'weekly' ? weekdayOf(cursor) === 1 : !off;
        if (required && !off && isDue(eq, records, cursor))
            out.push(cursor);
        cursor = isoAdd(cursor, 1);
    }
    return out;
}
function chunkZaloText(title, lines) {
    const chunks = [];
    let current = title;
    lines.forEach(line => {
        const next = `${current}\n${line}`;
        if (next.length > 1700 && current !== title) {
            chunks.push(current);
            current = `${title}\n${line}`;
            return;
        }
        current = next;
    });
    if (current.trim())
        chunks.push(current);
    return chunks;
}
async function sendEquipmentChecklistZaloRemind(db, now = new Date(), slot = '1100') {
    var _a, _b;
    const day = todayKey(now);
    const offDay = isSunday(now) || await isHoliday(db, day);
    if (offDay && isSunday(now))
        return { sent: 0, due: 0, offDay: true };
    const month = day.slice(0, 7);
    const from = isoAdd(`${month}-01`, -6);
    const [eqSnap, recSnap, holidaySnap] = await Promise.all([
        db.collection('warehouse-equipment').get(),
        db.collection('warehouse-equipment-inspections')
            .where('inspectionDate', '>=', from)
            .where('inspectionDate', '<=', `${month}-31`)
            .get(),
        db.collection('warehouse-equipment-meta').doc('holidays').get()
    ]);
    const extra = new Set((((_a = holidaySnap.data()) === null || _a === void 0 ? void 0 : _a.dates) || []));
    const records = recSnap.docs.map(d => d.data());
    const active = eqSnap.docs
        .map(d => {
        const data = d.data();
        return Object.assign(Object.assign({}, data), { equipmentId: data.equipmentId || d.id });
    })
        .filter(eq => eq.status !== 'DISPOSED' && eq.status !== 'INACTIVE' && eq.status !== 'SPARE');
    const late = active
        .map(eq => ({ eq, dates: overdueDates(eq, records, day, extra) }))
        .filter(row => row.dates.length);
    const due = offDay ? [] : active.filter(eq => isDue(eq, records, day));
    if (!late.length && !due.length)
        return { sent: 0, due: 0, offDay };
    const groupSnap = await db.doc(KHO_GROUP_DOC).get();
    const chatId = String(((_b = groupSnap.data()) === null || _b === void 0 ? void 0 : _b.chatId) || '').trim();
    if (!chatId)
        throw new Error('Chưa gắn nhóm Kho trong zalo_group_config/quanly_kho.');
    const title = slot === '1315'
        ? `Nhắc lại kiểm tra thiết bị kho (${viDay(day)}/${day.slice(0, 4)})`
        : slot === 'push'
            ? `Push nhắc kiểm tra thiết bị kho (${viDay(day)}/${day.slice(0, 4)})`
            : `Nhắc kiểm tra thiết bị kho (${viDay(day)}/${day.slice(0, 4)})`;
    const lines = [];
    if (late.length) {
        lines.push('Trễ hạn:');
        late.forEach(row => {
            const who = String(row.eq.responsibleEmployeeId || '').trim();
            const code = row.eq.managementCode || row.eq.equipmentId || '';
            const days = row.dates.map(viDay).join(', ');
            lines.push(who ? `- ${code} (${who}): ${days}` : `- ${code}: ${days}`);
        });
        lines.push('Quét thiết bị và bấm ngày trễ hạn để hoàn thành ngày cũ.');
    }
    if (due.length) {
        lines.push(slot === '1315' ? 'Đến 13:15 vẫn chưa kiểm:' : 'Sau 11:00 hôm nay chưa kiểm:');
        due.forEach(eq => {
            const who = String(eq.responsibleEmployeeId || '').trim();
            const code = eq.managementCode || eq.equipmentId || '';
            lines.push(who ? `- ${code} (${who})` : `- ${code}`);
        });
    }
    let sent = 0;
    for (const text of chunkZaloText(title, lines)) {
        if (await (0, zalo_notify_util_1.sendZaloToChat)(chatId, text))
            sent += 1;
    }
    return { sent, due: due.length + late.length, offDay };
}
//# sourceMappingURL=equipment-checklist-zalo.js.map