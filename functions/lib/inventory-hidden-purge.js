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
exports.HIDDEN_RETENTION_DAYS = exports.HIDDEN_BACKUP_TO = exports.INVENTORY_HIDDEN_COLLECTION = void 0;
exports.runInventoryHiddenPurgeJob = runInventoryHiddenPurgeJob;
/**
 * RM Inventory — danh mục Ẩn:
 * Sau 30 ngày gửi backup CSV về wh1@airspeedmfgvn.com rồi xóa document.
 */
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
exports.INVENTORY_HIDDEN_COLLECTION = 'inventory-materials-hidden';
exports.HIDDEN_BACKUP_TO = 'wh1@airspeedmfgvn.com';
exports.HIDDEN_RETENTION_DAYS = 30;
function getSmtp() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass)
        return null;
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const from = params_config_1.emailFrom.value().trim() || user;
    return { host, port, user, pass, from };
}
function csvEscape(v) {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
function toIso(raw) {
    if (!raw)
        return '';
    if (raw instanceof admin.firestore.Timestamp)
        return raw.toDate().toISOString();
    if (raw instanceof Date)
        return raw.toISOString();
    if (typeof raw.toDate === 'function') {
        try {
            return raw.toDate().toISOString();
        }
        catch (_a) {
            return '';
        }
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
function buildCsv(docs) {
    var _a;
    const headers = [
        'id',
        'factory',
        'materialCode',
        'poNumber',
        'location',
        'quantity',
        'openingStock',
        'exported',
        'xt',
        'unit',
        'batchNumber',
        'hideReason',
        'hiddenBy',
        'hiddenAt',
        'deleteAfterAt',
        'payloadJson'
    ];
    const lines = [headers.join(',')];
    for (const { id, data } of docs) {
        const payload = Object.assign({}, data);
        delete payload.payloadJson;
        lines.push([
            csvEscape(id),
            csvEscape(data.factory),
            csvEscape(data.materialCode),
            csvEscape(data.poNumber),
            csvEscape((_a = data.location) !== null && _a !== void 0 ? _a : data.viTri),
            csvEscape(data.quantity),
            csvEscape(data.openingStock),
            csvEscape(data.exported),
            csvEscape(data.xt),
            csvEscape(data.unit),
            csvEscape(data.batchNumber),
            csvEscape(data.hideReason),
            csvEscape(data.hiddenBy),
            csvEscape(toIso(data.hiddenAt)),
            csvEscape(toIso(data.deleteAfterAt)),
            csvEscape(JSON.stringify(payload))
        ].join(','));
    }
    return '\uFEFF' + lines.join('\n');
}
/**
 * Lấy các bản ghi đã hết hạn 30 ngày, gửi backup mail, rồi xóa.
 */
async function runInventoryHiddenPurgeJob(db) {
    const now = admin.firestore.Timestamp.now();
    const snap = await db
        .collection(exports.INVENTORY_HIDDEN_COLLECTION)
        .where('deleteAfterAt', '<=', now)
        .limit(500)
        .get();
    if (snap.empty) {
        console.log('[inventory-hidden-purge] Không có bản ghi hết hạn.');
        return { expiredCount: 0, deletedCount: 0, sent: false };
    }
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const cfg = getSmtp();
    if (!cfg) {
        throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS) — không gửi backup được, giữ nguyên bản ghi ẩn.');
    }
    const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const dateLabel = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const csv = buildCsv(docs);
    const ymd = new Date().toISOString().slice(0, 10);
    const subject = `[RM Inventory] Backup danh mục Ẩn hết hạn — ${dateLabel} (${docs.length} dòng)`;
    const text = `Backup trước khi tự xóa danh mục Ẩn (RM Inventory).\n\n` +
        `Thời điểm: ${atStr}\n` +
        `Số dòng hết hạn (≥ ${exports.HIDDEN_RETENTION_DAYS} ngày): ${docs.length}\n` +
        `File đính kèm: CSV đầy đủ payload.\n`;
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: exports.HIDDEN_BACKUP_TO,
        subject,
        text,
        attachments: [
            {
                filename: `inventory-hidden-expired-${ymd}.csv`,
                content: csv,
                contentType: 'text/csv; charset=utf-8'
            }
        ]
    });
    console.log(`[inventory-hidden-purge] Đã gửi backup ${docs.length} dòng tới ${exports.HIDDEN_BACKUP_TO}`);
    const batchSize = 400;
    let deletedCount = 0;
    for (let i = 0; i < snap.docs.length; i += batchSize) {
        const batch = db.batch();
        const chunk = snap.docs.slice(i, i + batchSize);
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deletedCount += chunk.length;
    }
    console.log(`[inventory-hidden-purge] Đã xóa ${deletedCount} bản ghi hết hạn.`);
    return { expiredCount: docs.length, deletedCount, sent: true };
}
//# sourceMappingURL=inventory-hidden-purge.js.map