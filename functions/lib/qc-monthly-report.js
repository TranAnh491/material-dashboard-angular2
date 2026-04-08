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
exports.sendQcMonthlyReport = sendQcMonthlyReport;
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const XLSX = __importStar(require("xlsx"));
const params_config_1 = require("./params-config");
function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function vnRangeStartMs(ymd) {
    // ymd = YYYY-MM-01
    const t = Date.parse(`${ymd}T00:00:00+07:00`);
    if (Number.isNaN(t)) {
        throw new Error(`Invalid VN date: ${ymd}`);
    }
    return t;
}
function monthKey(y, m1) {
    return `${y}-${String(m1).padStart(2, '0')}`;
}
function formatVnDateTime(d) {
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}
function computeRange(mode) {
    const now = new Date();
    // "VN now" components (roughly) by shifting +7h and reading UTC fields.
    const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const y = vn.getUTCFullYear();
    const m0 = vn.getUTCMonth(); // 0..11 in VN time
    if (mode === 'previousMonth') {
        const prevM0 = m0 === 0 ? 11 : m0 - 1;
        const prevY = m0 === 0 ? y - 1 : y;
        const startYmd = `${prevY}-${String(prevM0 + 1).padStart(2, '0')}-01`;
        const endYmd = `${y}-${String(m0 + 1).padStart(2, '0')}-01`;
        return {
            label: `tháng ${String(prevM0 + 1).padStart(2, '0')}/${prevY}`,
            startMs: vnRangeStartMs(startYmd),
            endMs: vnRangeStartMs(endYmd),
            monthLabel: monthKey(prevY, prevM0 + 1)
        };
    }
    // currentMonthToDate
    const startYmd = `${y}-${String(m0 + 1).padStart(2, '0')}-01`;
    return {
        label: `từ đầu tháng ${String(m0 + 1).padStart(2, '0')}/${y} tới ${formatVnDateTime(now)}`,
        startMs: vnRangeStartMs(startYmd),
        endMs: now.getTime(),
        monthLabel: monthKey(y, m0 + 1)
    };
}
function getSmtp() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    const to = params_config_1.qcMonthlyReportEmailTo.value().trim();
    if (!user || !pass || !to) {
        return null;
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    return { host, port, user, pass, from, to };
}
function parseFsDate(v) {
    if (!v)
        return null;
    if (v instanceof Date)
        return v;
    if (v instanceof admin.firestore.Timestamp)
        return v.toDate();
    if (v === null || v === void 0 ? void 0 : v.toDate)
        return v.toDate();
    if (v === null || v === void 0 ? void 0 : v.seconds)
        return new Date(v.seconds * 1000);
    if (typeof v === 'number')
        return new Date(v);
    if (typeof v === 'string') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}
function normalizeStatus(raw) {
    return String(raw !== null && raw !== void 0 ? raw : '').trim().toUpperCase();
}
function isEligibleUserCheckedRow(d) {
    var _a;
    const status = normalizeStatus(d === null || d === void 0 ? void 0 : d.iqcStatus);
    if (!status || status === 'CHỜ KIỂM')
        return false;
    const checkedBy = String((_a = d === null || d === void 0 ? void 0 : d.qcCheckedBy) !== null && _a !== void 0 ? _a : '').trim();
    if (!checkedBy)
        return false; // only "user checked"
    return true;
}
async function loadQcRowsInRange(db, factory, startMs, endMs) {
    // Keep query simple to avoid index needs: filter by factory only, then in-memory.
    const snap = await db.collection('inventory-materials').where('factory', '==', factory).get();
    const out = [];
    snap.docs.forEach(doc => {
        var _a, _b, _c, _d, _e;
        const d = doc.data();
        if (!isEligibleUserCheckedRow(d))
            return;
        const t = parseFsDate(d === null || d === void 0 ? void 0 : d.qcCheckedAt) || parseFsDate(d === null || d === void 0 ? void 0 : d.updatedAt);
        if (!t)
            return;
        const ms = t.getTime();
        if (ms < startMs || ms >= endMs)
            return;
        out.push({
            materialCode: String((_a = d === null || d === void 0 ? void 0 : d.materialCode) !== null && _a !== void 0 ? _a : '').trim(),
            poNumber: String((_b = d === null || d === void 0 ? void 0 : d.poNumber) !== null && _b !== void 0 ? _b : '').trim(),
            batchNumber: String((_c = d === null || d === void 0 ? void 0 : d.batchNumber) !== null && _c !== void 0 ? _c : '').trim(),
            location: String((_d = d === null || d === void 0 ? void 0 : d.location) !== null && _d !== void 0 ? _d : '').trim(),
            iqcStatus: normalizeStatus(d === null || d === void 0 ? void 0 : d.iqcStatus),
            qcCheckedBy: String((_e = d === null || d === void 0 ? void 0 : d.qcCheckedBy) !== null && _e !== void 0 ? _e : '').trim(),
            qcCheckedAt: t
        });
    });
    out.sort((a, b) => b.qcCheckedAt.getTime() - a.qcCheckedAt.getTime());
    return out;
}
function buildCounts(rows) {
    let pass = 0;
    let ng = 0;
    let lock = 0;
    let other = 0;
    for (const r of rows) {
        if (r.iqcStatus === 'PASS')
            pass++;
        else if (r.iqcStatus === 'NG')
            ng++;
        else if (r.iqcStatus === 'LOCK')
            lock++;
        else
            other++;
    }
    return { pass, ng, lock, other };
}
function buildHtml(rows, rangeLabel, factory, sentAt) {
    const counts = buildCounts(rows);
    const maxRows = 300;
    const shown = rows.slice(0, maxRows);
    const tr = shown
        .map((r, i) => `<tr>
<td style="text-align:right">${i + 1}</td>
<td>${esc(r.materialCode)}</td>
<td>${esc(r.poNumber)}</td>
<td>${esc(r.batchNumber)}</td>
<td>${esc(r.location)}</td>
<td>${esc(r.iqcStatus)}</td>
<td>${esc(r.qcCheckedBy)}</td>
<td>${esc(formatVnDateTime(r.qcCheckedAt))}</td>
</tr>`)
        .join('');
    const moreNote = rows.length > maxRows
        ? `<p style="color:#555;font-size:12px">Ghi chú: email chỉ hiển thị ${maxRows} dòng mới nhất (tổng ${rows.length} dòng).</p>`
        : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>QC Report (${esc(factory)})</strong></p>
<p>Phạm vi: <strong>${esc(rangeLabel)}</strong></p>
<p>Thời điểm gửi: <strong>${esc(sentAt)}</strong></p>
<p>Tổng: <strong>${rows.length}</strong> — PASS: <strong>${counts.pass}</strong>, NG: <strong>${counts.ng}</strong>, LOCK: <strong>${counts.lock}</strong>, Khác: <strong>${counts.other}</strong></p>
${moreNote}
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<thead>
<tr>
<th>STT</th><th>Mã hàng</th><th>PO</th><th>Batch</th><th>Vị trí</th><th>Trạng thái</th><th>NV kiểm</th><th>Thời gian</th>
</tr>
</thead>
<tbody>${tr}</tbody>
</table>
<p style="color:#555;font-size:12px">Gửi từ Tuấn Anh</p>
</body></html>`;
}
function buildText(rows, rangeLabel, factory, sentAt) {
    const counts = buildCounts(rows);
    const lines = rows.slice(0, 200).map(r => `- ${r.materialCode} | PO ${r.poNumber} | Batch ${r.batchNumber} | ${r.location} | ${r.iqcStatus} | ${r.qcCheckedBy} | ${formatVnDateTime(r.qcCheckedAt)}`);
    return (`QC Report (${factory})\n` +
        `Phạm vi: ${rangeLabel}\n` +
        `Thời điểm gửi: ${sentAt}\n` +
        `Tổng: ${rows.length} (PASS ${counts.pass}, NG ${counts.ng}, LOCK ${counts.lock}, Khác ${counts.other})\n\n` +
        lines.join('\n'));
}
function buildExcelBuffer(rows, rangeLabel, factory) {
    const wsData = [
        ['QC Report', '', '', '', '', '', '', ''],
        ['Factory', factory, 'Range', rangeLabel, '', '', '', ''],
        [],
        ['STT', 'MaterialCode', 'PO', 'Batch', 'Location', 'Status', 'CheckedBy', 'CheckedAt (VN)']
    ];
    rows.forEach((r, idx) => {
        wsData.push([
            idx + 1,
            r.materialCode,
            r.poNumber,
            r.batchNumber,
            r.location,
            r.iqcStatus,
            r.qcCheckedBy,
            formatVnDateTime(r.qcCheckedAt)
        ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
        { wch: 6 },
        { wch: 16 },
        { wch: 14 },
        { wch: 18 },
        { wch: 12 },
        { wch: 10 },
        { wch: 12 },
        { wch: 22 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'QC Report');
    // type: 'buffer' is supported in Node
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    return buf;
}
async function sendQcMonthlyReport(db, opts) {
    const cfg = getSmtp();
    if (!cfg) {
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS) hoặc QC_MONTHLY_REPORT_EMAIL_TO');
    }
    const range = computeRange(opts.mode);
    const rows = await loadQcRowsInRange(db, opts.factory, range.startMs, range.endMs);
    const sentAt = formatVnDateTime(new Date());
    const excelBuf = buildExcelBuffer(rows, range.label, opts.factory);
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    const subject = opts.mode === 'previousMonth'
        ? `[QC] Monthly report ${opts.factory} — ${range.monthLabel}`
        : `[QC] Report ${opts.factory} — current month to date`;
    const fileName = opts.mode === 'previousMonth'
        ? `QC_Report_${opts.factory}_${range.monthLabel}.xlsx`
        : `QC_Report_${opts.factory}_MTD_${range.monthLabel}.xlsx`;
    await transporter.sendMail({
        from: cfg.from,
        to: cfg.to,
        subject: subject.slice(0, 250),
        text: buildText(rows, range.label, opts.factory, sentAt),
        html: buildHtml(rows, range.label, opts.factory, sentAt),
        attachments: [
            {
                filename: fileName,
                content: excelBuf,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
        ]
    });
    return { total: rows.length };
}
//# sourceMappingURL=qc-monthly-report.js.map