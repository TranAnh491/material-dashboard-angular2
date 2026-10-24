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
exports.runTemLeGwSuspectEmail = runTemLeGwSuspectEmail;
/**
 * Tem lẻ: mã tách bag CL có GW lệch > 5% (hoặc bỏ qua không cân) — email 8h sáng hôm sau.
 * Nguồn: `tem-le-gw-suspects` (emailed == false). Gửi xong đánh dấu emailed = true.
 */
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
const TO = 'wh1@airspeedmfgvn.com';
const COLLECTION = 'tem-le-gw-suspects';
function esc(s) {
    return String(s !== null && s !== void 0 ? s : '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function runTemLeGwSuspectEmail(db) {
    const snap = await db.collection(COLLECTION).where('emailed', '==', false).get();
    if (snap.empty) {
        console.log('[tem-le-gw] Không có mã nghi ngờ mới — không gửi mail.');
        return 0;
    }
    const rows = snap.docs
        .map((d) => (Object.assign({ ref: d.ref }, d.data())))
        .sort((a, b) => { var _a, _b, _c, _d; return (((_b = (_a = a.at) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || 0) - (((_d = (_c = b.at) === null || _c === void 0 ? void 0 : _c.toMillis) === null || _d === void 0 ? void 0 : _d.call(_c)) || 0); });
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass)
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const transporter = nodemailer.createTransport({
        host: params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com',
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    const when = (r) => { var _a; return (((_a = r.at) === null || _a === void 0 ? void 0 : _a.toDate) ? r.at.toDate().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : ''); };
    const head = ['Thời gian', 'Nhà máy', 'Mã hàng', 'PO', 'IMD', 'Tem', 'Lượng CL', 'Lượng bag nguyên', 'GW bag nguyên (g)', 'GW cân (g)', 'GW dự kiến (g)', 'Lệch / lý do', 'Người'];
    const cells = (r) => { var _a, _b; return [when(r), r.factory, r.materialCode, r.po, r.imd, r.clTag, r.clQty, r.fullQty, r.gwBagFull, (_a = r.gwCl) !== null && _a !== void 0 ? _a : '—', (_b = r.gwExpected) !== null && _b !== void 0 ? _b : '—', r.reason, r.by]; };
    const html = `<p>Danh sách mã tách bag CL có GW lệch &gt; 5% so với GW bag nguyên (hoặc không cân) — ${rows.length} dòng.</p>` +
        `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:12px">` +
        `<tr style="background:#eee">${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
        rows.map((r) => `<tr>${cells(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') +
        `</table><p>Xem trên web: Materials → Tem lẻ → Danh mục nghi ngờ GW.</p>`;
    const text = rows.map((r) => cells(r).join(' | ')).join('\n');
    const dateLabel = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    await transporter.sendMail({
        from: params_config_1.emailFrom.value().trim() || user,
        to: TO,
        subject: `[Tem lẻ] Nghi ngờ sai lệch GW bag CL — ${dateLabel} (${rows.length} dòng)`,
        text,
        html
    });
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (let i = 0; i < rows.length; i += 400) {
        const batch = db.batch();
        rows.slice(i, i + 400).forEach((r) => batch.update(r.ref, { emailed: true, emailedAt: now }));
        await batch.commit();
    }
    return rows.length;
}
//# sourceMappingURL=tem-le-gw-email.js.map