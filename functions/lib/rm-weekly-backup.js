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
exports.runRmWeeklyBackupJob = runRmWeeklyBackupJob;
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
/**
 * Backup hàng tuần dữ liệu kho NVL (luồng Inbound → Tồn → Outbound) ra Cloud Storage.
 *
 * Mỗi collection được ghi thành 1 file NDJSON (mỗi dòng: {"id":"...","data":{...}}) —
 * stream thẳng nên không giới hạn kích thước. Timestamp giữ dạng
 * {_seconds,_nanoseconds} nên import lại dựng lại được.
 *
 * Đường dẫn: rm-weekly-backups/<YYYY-MM-DD>/<collection>.ndjson
 *            rm-weekly-backups/<YYYY-MM-DD>/_manifest.json
 */
const BACKUP_ROOT = 'rm-weekly-backups';
const KEEP_WEEKS = 8;
const NOTIFY_TO = 'wh1@airspeedmfgvn.com';
/** Các collection cần backup — dữ liệu giao dịch không tái tạo được + danh mục cấu hình. */
const COLLECTIONS = [
    // Giao dịch (bắt buộc)
    'inbound-materials',
    'inventory-materials',
    'outbound-materials',
    'rm-bag-history',
    'pxk-bs-data',
    'pxk-import-data',
    'work-orders',
    'inventory-kk-history',
    'material-location-history',
    'inbound-notes',
    // Danh mục / cấu hình
    'materials',
    'catalog',
    'material-rolls-bags',
    'material-gw-ldv',
    'materials-qty-bag-rules',
    'kk-catalog',
    'dv-luu-tru-catalog'
];
function ymdInTz(date) {
    var _a, _b, _c;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const y = ((_a = parts.find((p) => p.type === 'year')) === null || _a === void 0 ? void 0 : _a.value) || '1970';
    const m = ((_b = parts.find((p) => p.type === 'month')) === null || _b === void 0 ? void 0 : _b.value) || '01';
    const d = ((_c = parts.find((p) => p.type === 'day')) === null || _c === void 0 ? void 0 : _c.value) || '01';
    return `${y}-${m}-${d}`;
}
/** Stream 1 collection → file NDJSON trên Storage (có xử lý backpressure). */
async function backupCollectionToStorage(db, bucket, folder, name) {
    const path = `${folder}/${name}.ndjson`;
    const file = bucket.file(path);
    const ws = file.createWriteStream({
        contentType: 'application/x-ndjson',
        resumable: false,
        metadata: { cacheControl: 'private, max-age=60' }
    });
    let count = 0;
    let bytes = 0;
    await new Promise((resolve, reject) => {
        ws.on('error', reject);
        ws.on('finish', resolve);
        const stream = db.collection(name).stream();
        stream.on('error', reject);
        stream.on('data', (doc) => {
            let line;
            try {
                line = JSON.stringify({ id: doc.id, data: doc.data() }) + '\n';
            }
            catch (e) {
                line = JSON.stringify({ id: doc.id, _serializeError: String(e) }) + '\n';
            }
            count++;
            bytes += Buffer.byteLength(line);
            if (!ws.write(line)) {
                stream.pause();
                ws.once('drain', () => stream.resume());
            }
        });
        stream.on('end', () => ws.end());
    });
    return { name, count, path, bytes };
}
async function pruneOldBackups(bucket, keepDates) {
    const [files] = await bucket.getFiles({ prefix: `${BACKUP_ROOT}/` });
    let deleted = 0;
    for (const f of files) {
        const rel = f.name.slice(BACKUP_ROOT.length + 1);
        const dateSeg = rel.split('/')[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateSeg) && !keepDates.has(dateSeg)) {
            await f.delete().catch(() => undefined);
            deleted++;
        }
    }
    return deleted;
}
async function listExistingBackupDates(bucket) {
    const [files] = await bucket.getFiles({ prefix: `${BACKUP_ROOT}/` });
    const dates = new Set();
    for (const f of files) {
        const seg = f.name.slice(BACKUP_ROOT.length + 1).split('/')[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(seg))
            dates.add(seg);
    }
    return [...dates].sort();
}
function fmtBytes(n) {
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
async function sendBackupSummaryEmail(date, results, manifestUrl, folderGsPath, prunedCount) {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    if (!user || !pass) {
        console.warn('[rm-weekly-backup] Thiếu SMTP — bỏ qua email tổng kết.');
        return;
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const from = params_config_1.emailFrom.value().trim() || user;
    const totalDocs = results.reduce((s, r) => s + r.count, 0);
    const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
    const failed = results.filter((r) => r.error);
    const rows = results
        .map((r) => `<tr><td>${r.name}</td><td style="text-align:right">${r.count.toLocaleString('vi-VN')}</td>` +
        `<td style="text-align:right">${fmtBytes(r.bytes)}</td>` +
        `<td>${r.error ? '❌ ' + r.error : '✅'}</td></tr>`)
        .join('');
    const subject = (failed.length ? '⚠️ ' : '') +
        `[Warehouse] Backup tuần NVL — ${date} — ${totalDocs.toLocaleString('vi-VN')} dòng`;
    const text = `Backup hàng tuần dữ liệu kho NVL (Inbound → Tồn → Outbound).\n\n` +
        `Ngày: ${date}\n` +
        `Tổng: ${totalDocs} dòng, ${fmtBytes(totalBytes)}, ${results.length} collection` +
        (failed.length ? `, LỖI ${failed.length}` : '') +
        `\n` +
        `Thư mục: ${folderGsPath}\n` +
        `Manifest (link tải): ${manifestUrl}\n` +
        `Đã xoá ${prunedCount} file backup cũ (giữ ${KEEP_WEEKS} tuần gần nhất).\n\n` +
        results.map((r) => `- ${r.name}: ${r.count} dòng${r.error ? ' — LỖI: ' + r.error : ''}`).join('\n');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:sans-serif;font-size:14px">
<p>Backup hàng tuần dữ liệu kho NVL (Inbound → Tồn → Outbound).</p>
<p><strong>Ngày:</strong> ${date} &nbsp;·&nbsp; <strong>Tổng:</strong> ${totalDocs.toLocaleString('vi-VN')} dòng, ${fmtBytes(totalBytes)}${failed.length ? ` &nbsp;·&nbsp; <span style="color:#c5221f"><strong>LỖI ${failed.length}</strong></span>` : ''}</p>
<table style="border-collapse:collapse" cellpadding="6" border="1">
<tr><th>Collection</th><th>Số dòng</th><th>Dung lượng</th><th>TT</th></tr>
${rows}
</table>
<p><strong>Thư mục:</strong> <code>${folderGsPath}</code><br/>
<strong>Manifest:</strong> <a href="${manifestUrl}">tải _manifest.json</a></p>
<p style="color:#555;font-size:12px">Giữ ${KEEP_WEEKS} tuần gần nhất (đã xoá ${prunedCount} file cũ). Mỗi file là NDJSON — mỗi dòng một document {id,data}. Gửi tự động từ hệ thống Warehouse.</p>
</body></html>`;
    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    await transporter.sendMail({ from, to: NOTIFY_TO, subject: subject.slice(0, 250), text, html });
}
/** Chạy 1 lần backup: stream từng collection ra Storage (tuần tự), ghi manifest, dọn bản cũ, gửi email. */
async function runRmWeeklyBackupJob() {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const date = ymdInTz(new Date());
    const folder = `${BACKUP_ROOT}/${date}`;
    const results = [];
    for (const name of COLLECTIONS) {
        try {
            const r = await backupCollectionToStorage(db, bucket, folder, name);
            console.log(`[rm-weekly-backup] ${name}: ${r.count} dòng, ${fmtBytes(r.bytes)}`);
            results.push(r);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[rm-weekly-backup] LỖI ${name}:`, msg);
            results.push({ name, count: 0, path: `${folder}/${name}.ndjson`, bytes: 0, error: msg });
        }
    }
    const totalDocs = results.reduce((s, r) => s + r.count, 0);
    const manifest = {
        date,
        exportedAt: new Date().toISOString(),
        projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '',
        format: 'ndjson',
        note: 'Mỗi file: 1 document / dòng {"id","data"}. Timestamp = {_seconds,_nanoseconds}.',
        keepWeeks: KEEP_WEEKS,
        totalDocs,
        collections: results.map((r) => (Object.assign({ name: r.name, count: r.count, file: `${r.name}.ndjson`, bytes: r.bytes }, (r.error ? { error: r.error } : {}))))
    };
    const manifestPath = `${folder}/_manifest.json`;
    await bucket.file(manifestPath).save(JSON.stringify(manifest, null, 2), {
        contentType: 'application/json',
        resumable: false
    });
    // Dọn bản cũ — giữ KEEP_WEEKS ngày gần nhất (kể cả ngày vừa tạo).
    const allDates = await listExistingBackupDates(bucket);
    const keep = new Set(allDates.slice(-KEEP_WEEKS));
    keep.add(date);
    const pruned = await pruneOldBackups(bucket, keep);
    let manifestUrl = `gs://${bucket.name}/${manifestPath}`;
    try {
        const [url] = await bucket.file(manifestPath).getSignedUrl({ action: 'read', expires: '2500-01-01' });
        manifestUrl = url;
    }
    catch (e) {
        console.warn('[rm-weekly-backup] Không tạo được signed URL cho manifest:', e);
    }
    try {
        await sendBackupSummaryEmail(date, results, manifestUrl, `gs://${bucket.name}/${folder}/`, pruned);
    }
    catch (e) {
        console.error('[rm-weekly-backup] Gửi email tổng kết thất bại:', e);
    }
    return { date, totalDocs, collections: results, pruned, manifestPath };
}
//# sourceMappingURL=rm-weekly-backup.js.map