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
exports.runDashboardKpiReport = runDashboardKpiReport;
/**
 * Dashboard KPI — báo cáo tự động 8:30 và 17:00 (T2–T7, Asia/Ho_Chi_Minh).
 * Đọc Work Order + Shipment hôm nay & mai, ước lượng tiếng cần xử lý, gửi file Excel
 * qua email (EMAIL_TO) và Zalo bot (ASP0106, có thể đổi trong dashboard-kpi-report-settings).
 */
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const XLSX = __importStar(require("xlsx"));
const params_config_1 = require("./params-config");
const zalo_notify_util_1 = require("./zalo-notify.util");
const ZALO_DEFAULT = 'ASP0106';
const SETTINGS_COL = 'dashboard-kpi-report-settings';
const SETTINGS_DOC = 'recipients';
const WO_LOOKBACK_DAYS = 45;
const DEFAULT_MIN_PER_WO = 40;
const MIN_PER_SHIPMENT = 15;
const MIN_PER_CARTON = 0.4;
function parseFsDate(v) {
    if (!v)
        return null;
    if (v instanceof Date)
        return Number.isNaN(v.getTime()) ? null : v;
    if (v instanceof admin.firestore.Timestamp)
        return v.toDate();
    const anyV = v;
    if (typeof (anyV === null || anyV === void 0 ? void 0 : anyV.toDate) === 'function') {
        const d = anyV.toDate();
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof (anyV === null || anyV === void 0 ? void 0 : anyV.seconds) === 'number')
        return new Date(anyV.seconds * 1000);
    if (typeof v === 'number')
        return new Date(v);
    if (typeof v === 'string') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}
function vnParts(d = new Date()) {
    var _a;
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23'
    });
    const map = {};
    for (const p of fmt.formatToParts(d)) {
        if (p.type !== 'literal')
            map[p.type] = p.value;
    }
    const ymd = `${map.year}-${map.month}-${map.day}`;
    const wdMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
    const weekday = (_a = wdMap[map.weekday || '']) !== null && _a !== void 0 ? _a : 1;
    const label = `${map.day}/${map.month}/${map.year}`;
    return { ymd, h: Number(map.hour), min: Number(map.minute), weekday, label };
}
function addDaysYmd(ymd, days) {
    const t = Date.parse(`${ymd}T12:00:00+07:00`) + days * 86400000;
    return vnParts(new Date(t)).ymd;
}
function ymdToLabel(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}
function weekdayName(ymd) {
    const names = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    const t = Date.parse(`${ymd}T12:00:00+07:00`);
    return names[vnParts(new Date(t)).weekday] || '';
}
function isWorkYmd(ymd) {
    return vnParts(new Date(Date.parse(`${ymd}T12:00:00+07:00`))).weekday !== 0;
}
/** Phút ca làm việc chồng lên [from, to] trong một ngày VN: 08–12 và 13–20. */
function workMinutesOnYmd(ymd, fromH, fromM, toH, toM) {
    const windows = [
        { h1: 8, m1: 0, h2: 12, m2: 0 },
        { h1: 13, m1: 0, h2: 20, m2: 0 }
    ];
    const dayStart = Date.parse(`${ymd}T00:00:00+07:00`);
    const from = dayStart + (fromH * 60 + fromM) * 60000;
    const to = dayStart + (toH * 60 + toM) * 60000;
    let total = 0;
    for (const w of windows) {
        const ws = dayStart + (w.h1 * 60 + w.m1) * 60000;
        const we = dayStart + (w.h2 * 60 + w.m2) * 60000;
        const a = Math.max(from, ws);
        const b = Math.min(to, we);
        if (b > a)
            total += (b - a) / 60000;
    }
    return Math.max(0, total);
}
function remainingWorkHoursToday(slot, todayYmd) {
    if (!isWorkYmd(todayYmd))
        return 0;
    if (slot === '08')
        return workMinutesOnYmd(todayYmd, 8, 30, 20, 0) / 60;
    return workMinutesOnYmd(todayYmd, 17, 0, 20, 0) / 60;
}
function fullWorkHoursYmd(ymd) {
    if (!isWorkYmd(ymd))
        return 0;
    return workMinutesOnYmd(ymd, 8, 0, 20, 0) / 60;
}
function formatHours(h) {
    if (!Number.isFinite(h) || h <= 0)
        return '0 tiếng';
    const v = Math.round(h * 10) / 10;
    return Number.isInteger(v) ? `${v} tiếng` : `${v.toFixed(1)} tiếng`;
}
function normStatus(s) {
    return String(s || '').trim().toLowerCase();
}
function woNeedsWarehouseWork(status, isCompleted) {
    if (isCompleted)
        return false;
    return status === 'waiting' || status === 'kitting' || status === 'delay';
}
function shipIsDone(status) {
    const s = status.toLowerCase();
    return s.includes('đã ship') || s.includes('da ship') || s.includes('đã xong') || s.includes('da xong') || s === 'done';
}
function factoryGroup(raw) {
    const f = String(raw || 'ASM1').trim().toLowerCase().replace(/\s+/g, ' ');
    if (f === 'asm1' || f === 'sample 1')
        return 'ASM1';
    if (f === 'asm2' || f === 'sample 2')
        return 'ASM2';
    return 'OTHER';
}
function workingMsInShiftWindows(start, end) {
    if (end.getTime() <= start.getTime())
        return 0;
    let total = 0;
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const startMs = start.getTime();
    const endMs = end.getTime();
    while (day.getTime() <= last.getTime()) {
        for (const w of [
            { h1: 8, m1: 0, h2: 12, m2: 0 },
            { h1: 13, m1: 0, h2: 20, m2: 0 }
        ]) {
            const ws = new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.h1, w.m1, 0, 0).getTime();
            const we = new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.h2, w.m2, 0, 0).getTime();
            const a = Math.max(startMs, ws);
            const b = Math.min(endMs, we);
            if (b > a)
                total += b - a;
        }
        day.setDate(day.getDate() + 1);
    }
    return total;
}
function getSmtp() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    const toRaw = params_config_1.emailTo.value().trim();
    if (!user || !pass)
        return null;
    const to = toRaw
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (!to.length)
        return null;
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const from = params_config_1.emailFrom.value().trim() || user;
    return { host, port, user, pass, from, to };
}
async function loadRecipients(db) {
    const snap = await db.collection(SETTINGS_COL).doc(SETTINGS_DOC).get();
    const d = snap.data() || {};
    const zaloIds = Array.isArray(d.zaloMemberIds)
        ? d.zaloMemberIds.map((x) => String(x || '').trim().toUpperCase()).filter((x) => /^ASP\d{4}$/.test(x))
        : [ZALO_DEFAULT];
    if (!zaloIds.length)
        zaloIds.push(ZALO_DEFAULT);
    const extraEmails = Array.isArray(d.emails)
        ? d.emails.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
    return { zaloIds: [...new Set(zaloIds)], extraEmails };
}
function shipmentRefDate(s) {
    return s.actualShipDate || s.requestDate || s.importDate || null;
}
async function loadWorkOrders(db) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - WO_LOOKBACK_DAYS);
    const snap = await db.collection('work-orders').where('createdDate', '>=', cutoff).limit(3000).get();
    return snap.docs;
}
async function loadShipments(db) {
    const start = new Date();
    start.setDate(start.getDate() - 10);
    const end = new Date();
    end.setDate(end.getDate() + 14);
    const snap = await db
        .collection('shipments')
        .where('requestDate', '>=', start)
        .where('requestDate', '<=', end)
        .limit(3000)
        .get();
    return snap.docs;
}
function avgKittingMinutes(docs) {
    const samples = [];
    for (const doc of docs) {
        const d = doc.data();
        const start = parseFsDate(d.kittingStartedAt);
        const ready = parseFsDate(d.readyAt);
        if (!start || !ready)
            continue;
        const mins = workingMsInShiftWindows(start, ready) / 60000;
        if (mins >= 10 && mins <= 180)
            samples.push(mins);
    }
    if (!samples.length)
        return DEFAULT_MIN_PER_WO;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return Math.max(20, Math.min(90, Math.round(avg)));
}
function woHoursForDoc(d, avgMin, now) {
    const status = normStatus(d.status);
    const completed = d.isCompleted === true || status === 'done';
    if (completed || status === 'ready' || status === 'transfer')
        return 0;
    if (status === 'kitting') {
        const start = parseFsDate(d.kittingStartedAt);
        if (start) {
            const worked = workingMsInShiftWindows(start, now) / 60000;
            return Math.max(10, avgMin - worked) / 60;
        }
        return avgMin / 60;
    }
    if (status === 'waiting' || status === 'delay')
        return avgMin / 60;
    return 0;
}
async function runDashboardKpiReport(db, slot) {
    const now = new Date();
    const today = vnParts(now);
    const todayYmd = today.ymd;
    const tomorrowYmd = addDaysYmd(todayYmd, 1);
    const slotLabel = slot === '08' ? 'Sáng 8:30' : 'Chiều 17:00';
    const remainTodayH = remainingWorkHoursToday(slot, todayYmd);
    const tomorrowH = fullWorkHoursYmd(tomorrowYmd);
    const [woDocs, shipDocs, recipients] = await Promise.all([
        loadWorkOrders(db),
        loadShipments(db),
        loadRecipients(db)
    ]);
    const avgMin = avgKittingMinutes(woDocs);
    const woRows = [];
    for (const doc of woDocs) {
        const d = doc.data();
        const delivery = parseFsDate(d.deliveryDate);
        if (!delivery)
            continue;
        const deliveryYmd = vnParts(delivery).ymd;
        if (deliveryYmd !== todayYmd && deliveryYmd !== tomorrowYmd)
            continue;
        const fg = factoryGroup(d.factory);
        if (fg === 'OTHER')
            continue;
        const status = normStatus(d.status);
        const completed = d.isCompleted === true;
        const qty = Number(d.quantity) || 0;
        woRows.push({
            factory: fg,
            lsx: String(d.productionOrder || '').trim(),
            sku: String(d.productCode || '').trim(),
            qty,
            status: status || '—',
            line: String(d.productionLine || '').trim(),
            deliveryYmd,
            needWork: woNeedsWarehouseWork(status, completed),
            hours: woHoursForDoc(d, avgMin, now)
        });
    }
    const shipAgg = new Map();
    for (const doc of shipDocs) {
        const d = doc.data();
        if (d.hidden === true)
            continue;
        const fg = factoryGroup(d.factory);
        if (fg === 'OTHER')
            continue;
        const ref = shipmentRefDate({
            actualShipDate: parseFsDate(d.actualShipDate),
            requestDate: parseFsDate(d.requestDate),
            importDate: parseFsDate(d.importDate)
        });
        if (!ref)
            continue;
        const shipYmd = vnParts(ref).ymd;
        if (shipYmd !== todayYmd && shipYmd !== tomorrowYmd)
            continue;
        const code = String(d.shipmentCode || '').trim().toUpperCase() || '—';
        const status = String(d.status || '').trim() || '—';
        const key = `${fg}|${shipYmd}|${code}|${status}`;
        const carton = Number(d.carton) || 0;
        const prev = shipAgg.get(key);
        if (!prev) {
            const done = shipIsDone(status);
            shipAgg.set(key, {
                factory: fg,
                shipmentCode: code,
                carton: carton > 0 ? Math.round(carton) : 0,
                status,
                shipYmd,
                done,
                hours: done ? 0 : MIN_PER_SHIPMENT / 60 + (carton > 0 ? (carton * MIN_PER_CARTON) / 60 : 0)
            });
        }
        else {
            const add = carton > 0 ? Math.round(carton) : 0;
            prev.carton += add;
            if (!prev.done)
                prev.hours += (add * MIN_PER_CARTON) / 60;
        }
    }
    const shipRows = Array.from(shipAgg.values());
    const summarize = (factory, ymd) => {
        const wos = woRows.filter((r) => r.factory === factory && r.deliveryYmd === ymd);
        const ships = shipRows.filter((r) => r.factory === factory && r.shipYmd === ymd);
        const need = wos.filter((r) => r.needWork);
        const openShips = ships.filter((r) => !r.done);
        const woH = need.reduce((a, r) => a + r.hours, 0);
        const shipH = openShips.reduce((a, r) => a + r.hours, 0);
        const byStatus = {};
        for (const r of wos)
            byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        return {
            woTotal: wos.length,
            woNeed: need.length,
            woQty: need.reduce((a, r) => a + r.qty, 0),
            woHours: woH,
            byStatus,
            shipOpen: openShips.length,
            shipCarton: openShips.reduce((a, r) => a + r.carton, 0),
            shipHours: shipH,
            hours: woH + shipH
        };
    };
    const factories = ['ASM1', 'ASM2'];
    const days = [
        { ymd: todayYmd, title: 'Hôm nay', avail: remainTodayH },
        { ymd: tomorrowYmd, title: 'Mai', avail: tomorrowH }
    ];
    const summaryLines = [];
    const summaryRows = [
        ['Nhà máy', 'Ngày', 'LSX cần xử lý', 'Lượng SP', 'Shipment chưa xong', 'Carton', 'Tiếng cần', 'Tiếng ca còn', 'Ghi chú']
    ];
    for (const fac of factories) {
        for (const day of days) {
            const s = summarize(fac, day.ymd);
            const gap = day.avail - s.hours;
            const note = !isWorkYmd(day.ymd)
                ? 'Ngày nghỉ'
                : gap >= 0
                    ? `Đủ thời gian, dư ${formatHours(gap)}`
                    : `THIẾU ${formatHours(-gap)} — ưu tiên Delay + đang Kitting`;
            summaryLines.push(`${fac} · ${day.title} ${ymdToLabel(day.ymd)} (${weekdayName(day.ymd)}): ` +
                `${s.woNeed} LSX cần xử lý (SL ${s.woQty.toLocaleString('vi-VN')}), ` +
                `${s.shipOpen} shipment / ${s.shipCarton} carton, cần ${formatHours(s.hours)} / ca ${formatHours(day.avail)}. ${note}`);
            summaryRows.push([
                fac,
                `${day.title} ${ymdToLabel(day.ymd)} ${weekdayName(day.ymd)}`,
                s.woNeed,
                s.woQty,
                s.shipOpen,
                s.shipCarton,
                Math.round(s.hours * 10) / 10,
                Math.round(day.avail * 10) / 10,
                note
            ]);
        }
    }
    const actionParts = [];
    for (const fac of factories) {
        const todayS = summarize(fac, todayYmd);
        if (todayS.woNeed + todayS.shipOpen === 0)
            continue;
        const st = Object.entries(todayS.byStatus)
            .map(([k, n]) => `${k}: ${n}`)
            .join(', ');
        actionParts.push(`${fac} hôm nay: xử lý ${todayS.woNeed} LSX (${st || '—'}) và ${todayS.shipOpen} shipment chưa ship.`);
    }
    if (!actionParts.length)
        actionParts.push('Không còn LSX/shipment tồn hôm nay.');
    const header = `BÁO CÁO KPI KHO — ${slotLabel}\n` +
        `${weekdayName(todayYmd)} ${ymdToLabel(todayYmd)} (VN)\n` +
        `Định mức LSX: ~${avgMin} phút/WO (trung bình Kitting→Ready).\n` +
        `Ca còn lại hôm nay: ${formatHours(remainTodayH)}. Mai: ${formatHours(tomorrowH)}` +
        (isWorkYmd(tomorrowYmd) ? '' : ' (Chủ nhật — nghỉ)');
    const textBody = [header, '', 'TÓM TẮT', ...summaryLines, '', 'CẦN LÀM', ...actionParts].join('\n');
    const woSheet = (ymd) => {
        const rows = [['Nhà máy', 'LSX', 'SKU', 'Lượng', 'Trạng thái', 'Line', 'Cần xử lý', 'Ước tính tiếng']];
        woRows
            .filter((r) => r.deliveryYmd === ymd)
            .sort((a, b) => a.factory.localeCompare(b.factory) || a.lsx.localeCompare(b.lsx))
            .forEach((r) => {
            rows.push([
                r.factory,
                r.lsx,
                r.sku,
                r.qty,
                r.status,
                r.line,
                r.needWork ? 'Có' : 'Không',
                Math.round(r.hours * 10) / 10
            ]);
        });
        return rows;
    };
    const shipSheet = (ymd) => {
        const rows = [['Nhà máy', 'Shipment', 'Carton', 'Trạng thái', 'Đã ship', 'Ước tính tiếng']];
        shipRows
            .filter((r) => r.shipYmd === ymd)
            .sort((a, b) => a.factory.localeCompare(b.factory) || a.shipmentCode.localeCompare(b.shipmentCode))
            .forEach((r) => {
            rows.push([
                r.factory,
                r.shipmentCode,
                r.carton,
                r.status,
                r.done ? 'Có' : 'Chưa',
                Math.round(r.hours * 10) / 10
            ]);
        });
        return rows;
    };
    const wb = XLSX.utils.book_new();
    const cover = XLSX.utils.aoa_to_sheet([
        ['Báo cáo KPI Dashboard — Work Order & Shipment'],
        [header.replace(/\n/g, ' | ')],
        [],
        ...summaryRows,
        [],
        ['Cần làm'],
        ...actionParts.map((x) => [x])
    ]);
    cover['!cols'] = [
        { wch: 10 },
        { wch: 28 },
        { wch: 16 },
        { wch: 12 },
        { wch: 20 },
        { wch: 10 },
        { wch: 12 },
        { wch: 14 },
        { wch: 48 }
    ];
    XLSX.utils.book_append_sheet(wb, cover, 'Tom tat');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(woSheet(todayYmd)), 'WO hom nay');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(woSheet(tomorrowYmd)), 'WO mai');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shipSheet(todayYmd)), 'Shipment hom nay');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shipSheet(tomorrowYmd)), 'Shipment mai');
    const excelBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const fileName = `KPI_Kho_${todayYmd.replace(/-/g, '')}_${slot === '08' ? '0830' : '1700'}.xlsx`;
    const subject = `[KPI Kho] ${slotLabel} ${ymdToLabel(todayYmd)} — hôm nay & mai`;
    const smtp = getSmtp();
    let emailOk = false;
    if (smtp) {
        const to = [...smtp.to, ...recipients.extraEmails.filter((e) => !smtp.to.includes(e))];
        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.port === 465,
            auth: { user: smtp.user, pass: smtp.pass }
        });
        await transporter.sendMail({
            from: smtp.from,
            to: to.join(', '),
            subject: subject.slice(0, 250),
            text: textBody,
            html: `<pre style="font-family:Segoe UI,system-ui,sans-serif;font-size:13px;white-space:pre-wrap">${textBody
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')}</pre>`,
            attachments: [
                {
                    filename: fileName,
                    content: excelBuf,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            ]
        });
        emailOk = true;
    }
    else {
        console.error('dashboard-kpi-report: thiếu SMTP / EMAIL_TO');
    }
    const zaloCaption = `${subject}\nFile đính kèm.`;
    let zaloFileOk = false;
    let zaloTextOk = false;
    for (const mid of recipients.zaloIds) {
        const sentFile = await (0, zalo_notify_util_1.sendZaloFileToEmployee)(mid, excelBuf, fileName, zaloCaption);
        zaloFileOk = zaloFileOk || sentFile;
        if (!sentFile) {
            const sentText = await (0, zalo_notify_util_1.sendZaloToEmployee)(mid, textBody.slice(0, 2000));
            zaloTextOk = zaloTextOk || sentText;
        }
        else {
            zaloTextOk = true;
        }
    }
    if (!zaloFileOk) {
        try {
            const bucket = admin.storage().bucket();
            const path = `dashboard-kpi-reports/${fileName}`;
            const file = bucket.file(path);
            await file.save(excelBuf, {
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                resumable: false
            });
            const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 3600 * 1000 });
            for (const mid of recipients.zaloIds) {
                await (0, zalo_notify_util_1.sendZaloToEmployee)(mid, `${textBody.slice(0, 1600)}\n\nFile: ${url}`.slice(0, 2000));
            }
            zaloTextOk = true;
        }
        catch (e) {
            console.warn('dashboard-kpi-report: không upload Storage / gửi link Zalo', e);
        }
    }
    await db.collection('dashboard-cache').doc('kpi-report').set({
        lastSlot: slot,
        lastAt: admin.firestore.FieldValue.serverTimestamp(),
        fileName,
        emailOk,
        zaloFileOk,
        zaloTextOk,
        todayYmd,
        tomorrowYmd
    });
    if (!emailOk && !zaloFileOk && !zaloTextOk) {
        throw new Error('Không gửi được email lẫn Zalo (kiểm tra EMAIL_* và ZALO_BOT_TOKEN / zalo_links ASP0106).');
    }
    return { fileName, emailOk, zaloOk: zaloFileOk || zaloTextOk };
}
//# sourceMappingURL=dashboard-kpi-report.js.map