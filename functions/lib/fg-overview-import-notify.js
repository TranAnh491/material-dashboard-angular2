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
exports.runFgOverviewImportNotify = runFgOverviewImportNotify;
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
const FG_OVERVIEW_IMPORT_CACHE_COLLECTION = 'fg-overview-import-cache';
const FACTORY_DOCS = [
    { factory: 'ASM1', docId: 'current-asm1' },
    { factory: 'ASM2', docId: 'current-asm2' }
];
const DEFAULT_RECIPIENTS = [
    'wh1@airspeedmfgvn.com',
    'wh2@airspeedmfgvn.com',
    'wh3@airspeedmfgvn.com',
    'wh4@airspeedmfgvn.com'
];
function getEmailCfgFixedRecipients() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass)
        return null;
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    return { host, port, user, pass, from, to: DEFAULT_RECIPIENTS.slice() };
}
function esc(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function fmtDdMmYyyy(d) {
    if (!d || !isFinite(d.getTime()))
        return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear());
    return `${dd}/${mm}/${yy}`;
}
function daysSince(d) {
    if (!d || !isFinite(d.getTime()))
        return null;
    const a = new Date(d);
    a.setHours(0, 0, 0, 0);
    const b = new Date();
    b.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)));
}
async function loadImportCacheInfo(db, factory, docId) {
    const snap = await db.collection(FG_OVERVIEW_IMPORT_CACHE_COLLECTION).doc(docId).get();
    if (!snap.exists) {
        return {
            factory,
            fileName: null,
            updatedAt: null,
            importRows: null,
            daysSinceImport: null,
            overdue: true
        };
    }
    const d = snap.data() || {};
    const fileName = typeof d.fileName === 'string' && d.fileName.trim() ? d.fileName.trim() : null;
    const ua = d.updatedAt;
    let updatedAt = null;
    if (ua && typeof ua.toDate === 'function') {
        const dt = ua.toDate();
        updatedAt = dt instanceof Date && isFinite(dt.getTime()) ? dt : null;
    }
    else if (ua instanceof Date) {
        updatedAt = isFinite(ua.getTime()) ? ua : null;
    }
    const importRows = Array.isArray(d.lines) && d.lines.length ? d.lines.length : typeof d.importRowCount === 'number' ? d.importRowCount : null;
    const ds = daysSince(updatedAt);
    // "Quá 1 ngày" = > 1 ngày (ví dụ: 2 ngày trở lên)
    const overdue = ds === null ? true : ds > 1;
    return { factory, fileName, updatedAt, importRows, daysSinceImport: ds, overdue };
}
function buildEmailSubject(overdueCount) {
    return `[FG Overview] Cảnh báo: quá 1 ngày chưa import tồn kho (${overdueCount} nhà máy)`;
}
function buildEmailHtml(now, items) {
    const rows = items
        .map(i => {
        const ds = i.daysSinceImport === null ? '—' : String(i.daysSinceImport);
        const status = i.overdue ? 'CHƯA IMPORT (>1 ngày)' : 'OK';
        return `<tr>
  <td>${esc(i.factory)}</td>
  <td>${esc(i.fileName || '—')}</td>
  <td>${esc(fmtDdMmYyyy(i.updatedAt))}</td>
  <td style="text-align:right">${esc(i.importRows === null ? '—' : i.importRows)}</td>
  <td style="text-align:right">${esc(ds)}</td>
  <td><strong>${esc(status)}</strong></td>
</tr>`;
    })
        .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>FG Overview</strong> — kiểm tra import tồn kho (T2–T6).</p>
<p>Thời điểm quét: <strong>${esc(now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }))}</strong></p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<thead>
  <tr>
    <th>Nhà máy</th>
    <th>File</th>
    <th>Ngày import</th>
    <th>Số dòng</th>
    <th>Số ngày</th>
    <th>Tình trạng</th>
  </tr>
</thead>
<tbody>${rows}</tbody>
</table>
<p style="color:#555;font-size:12px">Gửi tự động từ Cloud Functions (FG Overview Import Notify).</p>
</body></html>`;
}
function buildEmailText(now, items) {
    const header = `FG Overview — kiểm tra import tồn kho (T2–T6)\nThời điểm quét: ${now.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false
    })}\n`;
    const lines = items.map(i => {
        const ds = i.daysSinceImport === null ? '—' : String(i.daysSinceImport);
        const status = i.overdue ? 'CHƯA IMPORT (>1 ngày)' : 'OK';
        return `- ${i.factory} | File: ${i.fileName || '—'} | Import: ${fmtDdMmYyyy(i.updatedAt)} | Rows: ${i.importRows === null ? '—' : i.importRows} | Days: ${ds} | ${status}`;
    });
    return `${header}\n${lines.join('\n')}\n`;
}
async function runFgOverviewImportNotify(db) {
    var _a;
    const cfg = getEmailCfgFixedRecipients();
    const now = new Date();
    const infos = [];
    for (const f of FACTORY_DOCS) {
        infos.push(await loadImportCacheInfo(db, f.factory, f.docId));
    }
    const overdue = infos.filter(i => i.overdue);
    if (overdue.length === 0) {
        return { ok: true, overdueFactories: [], emailSent: false, recipients: (_a = cfg === null || cfg === void 0 ? void 0 : cfg.to) !== null && _a !== void 0 ? _a : DEFAULT_RECIPIENTS.slice() };
    }
    if (!cfg) {
        console.error('FG Overview Import Notify: missing SMTP config (EMAIL_USER / EMAIL_PASS)');
        return { ok: true, overdueFactories: overdue.map(i => i.factory), emailSent: false, recipients: DEFAULT_RECIPIENTS.slice() };
    }
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: cfg.to.join(', '),
        subject: buildEmailSubject(overdue.length),
        text: buildEmailText(now, infos),
        html: buildEmailHtml(now, infos)
    });
    return { ok: true, overdueFactories: overdue.map(i => i.factory), emailSent: true, recipients: cfg.to.slice() };
}
//# sourceMappingURL=fg-overview-import-notify.js.map