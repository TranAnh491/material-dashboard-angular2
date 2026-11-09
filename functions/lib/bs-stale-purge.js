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
exports.BS_STALE_DAYS = void 0;
exports.runBsStalePurgeJob = runBsStalePurgeJob;
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
exports.BS_STALE_DAYS = 30;
const BS_STALE_TO = [
    'wh1@airspeedmfgvn.com',
    'wh2@airspeedmfgvn.com',
    'wh3@airspeedmfgvn.com',
    'wh4@airspeedmfgvn.com'
];
function esc(v) {
    return String(v !== null && v !== void 0 ? v : '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function fmtDate(d) {
    return d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
}
function fmtNum(n) {
    return (Math.round(n * 10000) / 10000).toLocaleString('en-US', { maximumFractionDigits: 4 });
}
async function runBsStalePurgeJob(db) {
    var _a;
    const cutoffMs = Date.now() - exports.BS_STALE_DAYS * 24 * 60 * 60 * 1000;
    const snap = await db.collection('pxk-bs-data').where('importedAt', '<', new Date(cutoffMs)).get();
    const now = new Date();
    const rows = [];
    let docs = 0;
    for (const doc of snap.docs) {
        const d = doc.data();
        const lines = Array.isArray(d.lines) ? [...d.lines] : [];
        const imp = ((_a = d.importedAt) === null || _a === void 0 ? void 0 : _a.toDate) ? d.importedAt.toDate() : null;
        let changed = false;
        lines.forEach((l, i) => {
            var _a, _b;
            if (!l || l.done || l.deletedAt)
                return;
            const code = String(l.materialCode || l.maVatTu || l.maHang || '').trim();
            if (!code)
                return;
            lines[i] = Object.assign(Object.assign({}, l), { done: true, deletedAt: now, deletedBy: 'AUTO_30_NGAY' });
            changed = true;
            rows.push({
                factory: String(d.factory || ''),
                lsx: String(d.lsx || ''),
                importedAt: imp,
                materialCode: code,
                po: String(l.po || l.soPO || '').trim(),
                quantity: Number((_b = (_a = l.quantity) !== null && _a !== void 0 ? _a : l.soLuong) !== null && _b !== void 0 ? _b : 0) || 0,
                exported: Number(l.exportedQty) || 0,
                unit: String(l.unit || l.dvt || '').trim(),
                hidden: !!l.hidden
            });
        });
        if (changed) {
            await doc.ref.update({ lines });
            docs++;
        }
    }
    if (!rows.length) {
        console.log('[BS stale] Không có dòng BS quá 30 ngày.');
        return { lines: 0, docs: 0 };
    }
    rows.sort((a, b) => a.factory.localeCompare(b.factory) || a.lsx.localeCompare(b.lsx) || a.materialCode.localeCompare(b.materialCode));
    // Tóm tắt theo nhà máy + LSX
    const byLsx = new Map();
    for (const r of rows) {
        const k = `${r.factory}|${r.lsx}`;
        const cur = byLsx.get(k) || { factory: r.factory, lsx: r.lsx, lines: 0, date: r.importedAt };
        cur.lines++;
        byLsx.set(k, cur);
    }
    const summary = [...byLsx.values()].sort((a, b) => b.lines - a.lines);
    const td = 'style="border:1px solid #cbd5e1;padding:4px 8px"';
    const th = 'style="border:1px solid #94a3b8;padding:4px 8px;background:#f1f5f9;text-align:left"';
    const html = `
<p>Xuất BS — đã <b>tự xóa ${rows.length} dòng</b> (${summary.length} LSX) chưa xuất xong của phiếu import quá ${exports.BS_STALE_DAYS} ngày.</p>
<p>Dòng bị xóa vẫn xem được trên web: Outbound → Xuất BS → tick "Hiện cả đã xuất / đã ẩn" (trạng thái "Đã xóa"). File CSV đính kèm đủ chi tiết.</p>
<h3>Tóm tắt theo LSX</h3>
<table style="border-collapse:collapse;font-family:Arial;font-size:13px">
<tr><th ${th}>Nhà máy</th><th ${th}>LSX</th><th ${th}>Ngày import</th><th ${th}>Số dòng xóa</th></tr>
${summary.map((s) => `<tr><td ${td}>${esc(s.factory)}</td><td ${td}>${esc(s.lsx)}</td><td ${td}>${fmtDate(s.date)}</td><td ${td}>${s.lines}</td></tr>`).join('\n')}
</table>
<h3>Chi tiết (${Math.min(rows.length, 300)} / ${rows.length} dòng)</h3>
<table style="border-collapse:collapse;font-family:Arial;font-size:12px">
<tr><th ${th}>Nhà máy</th><th ${th}>LSX</th><th ${th}>Ngày import</th><th ${th}>Mã</th><th ${th}>PO</th><th ${th}>Lượng cần</th><th ${th}>Đã xuất</th><th ${th}>ĐVT</th><th ${th}>Ghi chú</th></tr>
${rows.slice(0, 300).map((r) => `<tr><td ${td}>${esc(r.factory)}</td><td ${td}>${esc(r.lsx)}</td><td ${td}>${fmtDate(r.importedAt)}</td><td ${td}>${esc(r.materialCode)}</td><td ${td}>${esc(r.po)}</td><td ${td}>${fmtNum(r.quantity)}</td><td ${td}>${r.exported ? fmtNum(r.exported) : ''}</td><td ${td}>${esc(r.unit)}</td><td ${td}>${r.hidden ? 'Đã ẩn' : ''}</td></tr>`).join('\n')}
</table>`;
    const csv = ['﻿Nhà máy,LSX,Ngày import,Mã,PO,Lượng cần,Đã xuất,ĐVT,Đã ẩn']
        .concat(rows.map((r) => [r.factory, r.lsx, fmtDate(r.importedAt), r.materialCode, r.po, r.quantity, r.exported, r.unit, r.hidden ? 'x' : '']
        .map(csvCell).join(',')))
        .join('\r\n');
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass) {
        console.warn('[BS stale] Thiếu cấu hình SMTP — đã xóa nhưng không gửi được mail.');
        return { lines: rows.length, docs };
    }
    const transporter = nodemailer.createTransport({
        host: params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com',
        port: parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587,
        secure: false,
        auth: { user, pass }
    });
    const day = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    await transporter.sendMail({
        from: params_config_1.emailFrom.value().trim() || user,
        to: BS_STALE_TO.join(', '),
        subject: `[Xuất BS] Tự xóa ${rows.length} dòng tồn quá ${exports.BS_STALE_DAYS} ngày — ${day}`,
        html,
        attachments: [{ filename: `BS_tu_xoa_${day.replace(/\//g, '-')}.csv`, content: csv, contentType: 'text/csv; charset=utf-8' }]
    });
    console.log(`[BS stale] Đã xóa ${rows.length} dòng (${docs} phiếu) và gửi mail.`);
    return { lines: rows.length, docs };
}
//# sourceMappingURL=bs-stale-purge.js.map