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
exports.runPrintLabelLateNotify = runPrintLabelLateNotify;
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
const LATE_EMAILS_DOC = 'print-label-settings/late-notification-emails';
function esc(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function isDoneStatus(s) {
    const t = (s || '').toLowerCase().trim();
    return t === 'done' || t === 'completed' || t === 'hoàn thành';
}
function parseNgayNhanKeHoach(raw) {
    const s = String(raw !== null && raw !== void 0 ? raw : '').trim();
    if (!s) {
        return null;
    }
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
        const d = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10) - 1;
        const y = parseInt(m[3], 10);
        const dt = new Date(y, mo, d);
        if (!isNaN(dt.getTime())) {
            return dt;
        }
    }
    const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m2) {
        const dt = new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));
        if (!isNaN(dt.getTime())) {
            return dt;
        }
    }
    const t = Date.parse(s);
    if (!isNaN(t)) {
        return new Date(t);
    }
    return null;
}
/** YYYY-MM-DD theo múi Asia/Ho_Chi_Minh */
function toYmdVN(d) {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}
function todayYmdVN() {
    return toYmdVN(new Date());
}
function getSmtp() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass) {
        return null;
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    return { host, port, user, pass, from };
}
async function loadRecipientEmails(db) {
    const snap = await db.doc(LATE_EMAILS_DOC).get();
    const d = snap.exists ? snap.data() : null;
    const arr = Array.isArray(d === null || d === void 0 ? void 0 : d.emails) ? d.emails : [];
    const list = arr
        .map((x) => String(x !== null && x !== void 0 ? x : '').trim().toLowerCase())
        .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    return Array.from(new Set(list));
}
async function loadLatestScheduleRows(db) {
    const qs = await db.collection('print-schedules').orderBy('importedAt', 'desc').limit(1).get();
    if (qs.empty) {
        return [];
    }
    const data = qs.docs[0].data();
    const arr = data === null || data === void 0 ? void 0 : data.data;
    if (!Array.isArray(arr)) {
        return [];
    }
    return arr;
}
function collectLateItems(rows) {
    const today = todayYmdVN();
    const out = [];
    for (const row of rows) {
        if (isDoneStatus(row.tinhTrang)) {
            continue;
        }
        const dt = parseNgayNhanKeHoach(row.ngayNhanKeHoach);
        if (!dt) {
            continue;
        }
        const planYmd = toYmdVN(dt);
        if (planYmd < today) {
            out.push(row);
        }
    }
    return out;
}
async function runPrintLabelLateNotify(db) {
    const recipients = await loadRecipientEmails(db);
    if (recipients.length === 0) {
        console.log('[print-label-late] Bỏ qua: chưa cấu hình email (print-label-settings/late-notification-emails).');
        return { sent: false, lateCount: 0, recipientCount: 0 };
    }
    const rows = await loadLatestScheduleRows(db);
    const late = collectLateItems(rows);
    if (late.length === 0) {
        console.log('[print-label-late] Không có mã trễ kế hoạch (chưa Done + quá ngày nhận KH).');
        return { sent: false, lateCount: 0, recipientCount: recipients.length };
    }
    const cfg = getSmtp();
    if (!cfg) {
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
    }
    const atStr = new Date().toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false
    });
    const lines = late.map(r => `- ${r.maTem || '(no maTem)'} | ${r.tinhTrang || '-'} | KH: ${r.ngayNhanKeHoach || '-'} | KH hàng: ${r.khachHang || '-'} | LSX: ${r.lenhSanXuat || '-'}`);
    const text = `Print Label — cảnh báo tem trễ ngày nhận kế hoạch (Late)\n` +
        `Thời điểm quét: ${atStr} (Asia/Ho_Chi_Minh)\n` +
        `Số mã: ${late.length}\n\n` +
        `${lines.join('\n')}\n`;
    const tableRows = late
        .map(r => `<tr>
  <td>${esc(r.maTem)}</td>
  <td>${esc(r.tinhTrang)}</td>
  <td>${esc(r.ngayNhanKeHoach)}</td>
  <td>${esc(r.khachHang)}</td>
  <td>${esc(r.lenhSanXuat)}</td>
  <td>${esc(r.nguoiIn)}</td>
</tr>`)
        .join('\n');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Print Label — Tem trễ kế hoạch (Late)</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong> · Múi giờ: Asia/Ho_Chi_Minh</p>
<p>Số mã chưa Done và đã quá <strong>Ngày nhận kế hoạch</strong>: <strong>${late.length}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px" cellpadding="6" border="1">
<thead><tr><th>Mã tem</th><th>Tình trạng</th><th>Ngày nhận KH</th><th>Khách hàng</th><th>Lệnh SX</th><th>Người in</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
<p style="color:#555;font-size:12px">Gửi tự động từ Cloud Functions (Print Label Late).</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: recipients.join(','),
        subject: `[Print Label Late] ${late.length} mã trễ kế hoạch`.slice(0, 250),
        text,
        html
    });
    console.log(`[print-label-late] Đã gửi mail tới ${recipients.length} địa chỉ, ${late.length} mã.`);
    return { sent: true, lateCount: late.length, recipientCount: recipients.length };
}
//# sourceMappingURL=print-label-late-notify.js.map