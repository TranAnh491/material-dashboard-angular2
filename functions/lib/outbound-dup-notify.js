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
exports.DEFAULT_OUTBOUND_DUP_SINCE_YMD = void 0;
exports.vnYmdStartMs = vnYmdStartMs;
exports.isMaterialCodeExcludedByControlBatchRules = isMaterialCodeExcludedByControlBatchRules;
exports.loadControlBatchDupSettings = loadControlBatchDupSettings;
exports.scanOutboundDuplicates = scanOutboundDuplicates;
exports.sendOutboundDupReportManual = sendOutboundDupReportManual;
exports.runOutboundDupNotifyForSlot = runOutboundDupNotifyForSlot;
const admin = __importStar(require("firebase-admin"));
const nodemailer = __importStar(require("nodemailer"));
const params_config_1 = require("./params-config");
const CONTROL_BATCH_EXCLUSION_COLLECTION = 'control-batch-exclusion';
const CONTROL_BATCH_EXCLUSION_DOC = 'settings';
/** Mặc định: 02/04/2026 00:00 (VN), lưu dạng YYYY-MM-DD trên Firestore. */
exports.DEFAULT_OUTBOUND_DUP_SINCE_YMD = '2026-04-02';
/** 00:00 ngày `ymd` theo múi Asia/Ho_Chi_Minh. */
function vnYmdStartMs(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) {
        return null;
    }
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+07:00`);
    return Number.isNaN(t) ? null : t;
}
function formatYmdVnDisplay(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) {
        return ymd.trim();
    }
    return `${m[3]}/${m[2]}/${m[1]}`;
}
function normalizeOutboundDupSinceYmd(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && vnYmdStartMs(s) != null) {
        return s;
    }
    return exports.DEFAULT_OUTBOUND_DUP_SINCE_YMD;
}
const CONTROL_BATCH_EXCLUDE_PREFIX_LEN = 4;
/**
 * Mục danh mục đúng 4 ký tự = tiền tố (vd. B034 → loại B034001, B034xxx…).
 * Khác = khớp nguyên mã. Đồng bộ với tab Control Batch (Angular).
 */
function isMaterialCodeExcludedByControlBatchRules(mcNorm, rules) {
    const mc = String(mcNorm || '').trim().toUpperCase();
    if (!mc) {
        return false;
    }
    for (const rule of rules) {
        const ex = String(rule || '').trim().toUpperCase();
        if (!ex) {
            continue;
        }
        if (ex.length === CONTROL_BATCH_EXCLUDE_PREFIX_LEN) {
            if (mc.startsWith(ex)) {
                return true;
            }
        }
        else if (mc === ex) {
            return true;
        }
    }
    return false;
}
/** Đọc `control-batch-exclusion/settings` (loại trừ + outboundDupSinceDate). */
async function loadControlBatchDupSettings(db) {
    const snap = await db.collection(CONTROL_BATCH_EXCLUSION_COLLECTION).doc(CONTROL_BATCH_EXCLUSION_DOC).get();
    const d = snap.data() || {};
    const enabled = d.excludeEnabled === true;
    const arr = Array.isArray(d.excludeMaterialCodes) ? d.excludeMaterialCodes : [];
    const codes = new Set();
    for (const x of arr) {
        const c = String(x || '').trim().toUpperCase();
        if (c) {
            codes.add(c);
        }
    }
    const dupSinceYmd = normalizeOutboundDupSinceYmd(d.outboundDupSinceDate);
    const dupSinceMs = vnYmdStartMs(dupSinceYmd);
    return {
        exclusion: { enabled, codes },
        dupSinceMs,
        dupSinceYmd,
        dupSinceLabel: formatYmdVnDisplay(dupSinceYmd)
    };
}
function isValidRmMaterialCode(code) {
    const c = (code || '').trim().toUpperCase();
    return /^[AB]\d{6}$/.test(c);
}
function isValidOutboundPo(po) {
    const p = (po || '').trim();
    if (!p || !/[A-Za-z]/.test(p)) {
        return false;
    }
    const u = p.toUpperCase();
    return u.startsWith('KZ') || u.startsWith('LH');
}
function stringHasDigit(s) {
    return /\d/.test(String(s || ''));
}
function isOutboundRowEligible(materialCode, poNumber, imd, bagBatch) {
    const mc = (materialCode || '').trim().toUpperCase();
    if (!isValidRmMaterialCode(mc)) {
        return false;
    }
    if (!isValidOutboundPo(poNumber)) {
        return false;
    }
    if (!stringHasDigit(imd)) {
        return false;
    }
    if (!stringHasDigit(bagBatch)) {
        return false;
    }
    return true;
}
function docTimeMs(data) {
    var _a, _b;
    const tryOne = (v) => {
        if (v == null) {
            return null;
        }
        if (v instanceof admin.firestore.Timestamp) {
            return v.toMillis();
        }
        if (v instanceof Date) {
            const t = v.getTime();
            return Number.isNaN(t) ? null : t;
        }
        return null;
    };
    return (_b = (_a = tryOne(data.exportDate)) !== null && _a !== void 0 ? _a : tryOne(data.createdAt)) !== null && _b !== void 0 ? _b : tryOne(data.updatedAt);
}
function isOnOrAfterDupSince(data, sinceMs) {
    const t = docTimeMs(data);
    if (t == null) {
        return false;
    }
    return t >= sinceMs;
}
function compositeKey(factory, materialCode, poNumber, imd, bagBatch) {
    const fac = (factory || '').trim();
    const mc = (materialCode || '').trim().toUpperCase();
    const po = (poNumber || '').trim();
    const im = (imd || '').trim();
    const bag = (bagBatch || '').trim();
    return `${fac}|${mc}|${po}|${im}|${bag}`;
}
async function fetchAllOutboundByFactory(db, factory) {
    const ref = db.collection('outbound-materials');
    const batchSize = 500;
    const idPath = admin.firestore.FieldPath.documentId();
    const out = [];
    let last;
    for (;;) {
        let q = ref.where('factory', '==', factory).orderBy(idPath).limit(batchSize);
        if (last) {
            q = q.startAfter(last);
        }
        const snap = await q.get();
        if (snap.empty) {
            break;
        }
        out.push(...snap.docs);
        if (snap.docs.length < batchSize) {
            break;
        }
        last = snap.docs[snap.docs.length - 1];
    }
    return out;
}
/** Cùng logic với tab Control Batch (Angular). */
async function scanOutboundDuplicates(db, cached) {
    var _a, _b, _c, _d;
    const s = cached !== null && cached !== void 0 ? cached : (await loadControlBatchDupSettings(db));
    const excl = s.exclusion;
    const [docs1, docs2] = await Promise.all([
        fetchAllOutboundByFactory(db, 'ASM1'),
        fetchAllOutboundByFactory(db, 'ASM2')
    ]);
    const all = [...docs1, ...docs2];
    const counts = new Map();
    for (const doc of all) {
        const d = doc.data();
        if (!isOnOrAfterDupSince(d, s.dupSinceMs)) {
            continue;
        }
        const factory = String((_a = d.factory) !== null && _a !== void 0 ? _a : '');
        const materialCode = String((_b = d.materialCode) !== null && _b !== void 0 ? _b : '');
        const poNumber = String((_c = d.poNumber) !== null && _c !== void 0 ? _c : '');
        const imdRaw = (_d = d.batchNumber) !== null && _d !== void 0 ? _d : d.importDate;
        const imd = imdRaw != null ? String(imdRaw) : '';
        const bagRaw = d.bagBatch;
        const bagBatch = bagRaw != null ? String(bagRaw) : '';
        if (!isOutboundRowEligible(materialCode, poNumber, imd, bagBatch)) {
            continue;
        }
        const mcNorm = materialCode.trim().toUpperCase();
        if (excl.enabled && isMaterialCodeExcludedByControlBatchRules(mcNorm, excl.codes)) {
            continue;
        }
        const key = compositeKey(factory, materialCode, poNumber, imd, bagBatch);
        const lsxVal = d.productionOrder;
        const lsxStr = lsxVal != null ? String(lsxVal).trim() : '';
        const prev = counts.get(key);
        if (prev) {
            prev.count += 1;
            if (lsxStr) {
                prev.lsx.add(lsxStr);
            }
        }
        else {
            const lsx = new Set();
            if (lsxStr) {
                lsx.add(lsxStr);
            }
            counts.set(key, {
                count: 1,
                sample: {
                    factory: factory.trim(),
                    materialCode: materialCode.trim(),
                    poNumber: poNumber.trim(),
                    imd: imd.trim(),
                    bagBatch: bagBatch.trim()
                },
                lsx
            });
        }
    }
    const dupes = [];
    for (const { count, sample, lsx } of counts.values()) {
        if (count > 1) {
            const lsxList = Array.from(lsx).sort((a, b) => a.localeCompare(b, 'vi'));
            const productionOrderSummary = lsxList.length > 0 ? lsxList.join(' · ') : '—';
            dupes.push(Object.assign(Object.assign({}, sample), { count, productionOrderSummary }));
        }
    }
    dupes.sort((a, b) => {
        const fc = (a.factory || '').localeCompare(b.factory || '');
        if (fc !== 0) {
            return fc;
        }
        const mc = (a.materialCode || '').localeCompare(b.materialCode || '');
        if (mc !== 0) {
            return mc;
        }
        const po = (a.poNumber || '').localeCompare(b.poNumber || '');
        if (po !== 0) {
            return po;
        }
        const im = (a.imd || '').localeCompare(b.imd || '');
        if (im !== 0) {
            return im;
        }
        return (a.bagBatch || '').localeCompare(b.bagBatch || '');
    });
    return dupes;
}
function getEmailCfg() {
    const user = params_config_1.emailUser.value().trim();
    const pass = params_config_1.emailPass.value().trim();
    const toRaw = params_config_1.emailTo.value().trim();
    const to = toRaw
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean);
    if (!user || !pass || to.length === 0) {
        return null;
    }
    const host = params_config_1.emailSmtpHost.value().trim() || 'smtp.gmail.com';
    const port = parseInt(params_config_1.emailSmtpPort.value().trim() || '587', 10) || 587;
    const fromRaw = params_config_1.emailFrom.value().trim();
    const from = fromRaw || user;
    return { host, port, user, pass, from, to };
}
function buildPlainText(dupes, dupSinceLabel, exclusionNote) {
    const lines = dupes.map(r => `- ${r.factory} | ${r.materialCode} | PO ${r.poNumber} | IMD ${r.imd || '—'} | Bag ${r.bagBatch || '—'} | ${r.count} lần | LSX: ${r.productionOrderSummary}`);
    return (`Control Batch — phát hiện ${dupes.length} nhóm trùng xuất kho (từ ${dupSinceLabel}, đủ điều kiện định dạng).\n\n` +
        lines.join('\n') +
        (exclusionNote ? `\n\n${exclusionNote}` : ''));
}
function buildHtml(dupes, dupSinceLabel, exclusionNoteHtml) {
    const rows = dupes
        .map(r => `<tr><td>${esc(r.factory)}</td><td>${esc(r.materialCode)}</td><td>${esc(r.poNumber)}</td><td>${esc(r.imd)}</td><td>${esc(r.bagBatch)}</td><td style="text-align:right">${r.count}</td><td>${esc(r.productionOrderSummary)}</td></tr>`)
        .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Control Batch</strong> — ${dupes.length} nhóm <strong>trùng xuất kho</strong> (từ ${esc(dupSinceLabel)}).</p>
${exclusionNoteHtml || ''}
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<thead><tr><th>Nhà máy</th><th>Mã</th><th>PO</th><th>IMD</th><th>Bag</th><th>Số lần</th><th>Lệnh SX</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#555;font-size:12px">Gửi từ Tuấn Anh</p>
</body></html>`;
}
function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
async function sendDupEmail(dupes, cfg, settings) {
    const exclusion = settings.exclusion;
    const exclNote = exclusion.enabled && exclusion.codes.size > 0
        ? `Đang bật loại trừ: ${exclusion.codes.size} dòng danh mục (mã đủ hoặc 4 ký tự = tiền tố nhóm).`
        : exclusion.enabled
            ? 'Đang bật loại trừ (danh sách mã trống).'
            : '';
    const exclHtml = exclNote !== ''
        ? `<p style="color:#1565c0;font-size:13px"><strong>Ghi chú:</strong> ${esc(exclNote)}</p>`
        : '';
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
        from: cfg.from,
        to: cfg.to.join(', '),
        subject: `[Control Batch] Cảnh báo: ${dupes.length} nhóm trùng xuất kho`,
        text: buildPlainText(dupes, settings.dupSinceLabel, exclNote || undefined),
        html: buildHtml(dupes, settings.dupSinceLabel, exclHtml || undefined)
    });
}
/**
 * Quét trùng tại thời điểm gọi và gửi mail (nút Send Mail trên Control Batch).
 * Cùng logic lọc với lịch 12h/17h.
 */
async function sendOutboundDupReportManual(db) {
    const settings = await loadControlBatchDupSettings(db);
    const dupes = await scanOutboundDuplicates(db, settings);
    const excl = settings.exclusion;
    const cfg = getEmailCfg();
    if (!cfg) {
        throw new Error('Thiếu cấu hình SMTP (EMAIL_USER, EMAIL_PASS, EMAIL_TO)');
    }
    const at = new Date();
    const atStr = at.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false
    });
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    const exclNote = excl.enabled && excl.codes.size > 0
        ? `\n\nGhi chú: đang bật loại trừ ${excl.codes.size} dòng danh mục (mã đủ hoặc 4 ký tự = tiền tố nhóm).`
        : excl.enabled
            ? '\n\nGhi chú: đang bật loại trừ (danh sách mã trống).'
            : '';
    const exclHtml = excl.enabled && excl.codes.size > 0
        ? `<p style="color:#1565c0;font-size:13px"><strong>Ghi chú:</strong> Đang bật loại trừ ${excl.codes.size} dòng danh mục (mã đủ hoặc 4 ký tự = tiền tố nhóm).</p>`
        : excl.enabled
            ? `<p style="color:#1565c0;font-size:13px"><strong>Ghi chú:</strong> Đang bật loại trừ (danh sách mã trống).</p>`
            : '';
    if (dupes.length === 0) {
        await transporter.sendMail({
            from: cfg.from,
            to: cfg.to.join(', '),
            subject: `[Control Batch] Báo cáo — không có nhóm trùng (${atStr})`,
            text: `Kiểm tra trùng xuất kho (từ ${settings.dupSinceLabel}, đủ điều kiện định dạng).\n` +
                `Thời điểm quét: ${atStr}\n\nKhông có nhóm trùng (mã + PO + IMD + bag, >1 lần).` +
                exclNote,
            html: `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Control Batch</strong> — báo cáo từ nút Send Mail.</p>
<p>Thời điểm quét: <strong>${esc(atStr)}</strong></p>
${exclHtml}
<p>Không có nhóm trùng xuất kho.</p>
<p style="color:#555;font-size:12px">Gửi từ Tuấn Anh</p>
</body></html>`
        });
        return { dupGroups: 0 };
    }
    const bodyHtml = buildHtml(dupes, settings.dupSinceLabel, exclHtml).replace('</body>', `<p style="margin-top:12px">Thời điểm quét: <strong>${esc(atStr)}</strong> (báo cáo từ nút Send Mail).</p></body>`);
    await transporter.sendMail({
        from: cfg.from,
        to: cfg.to.join(', '),
        subject: `[Control Batch] Báo cáo — ${dupes.length} nhóm trùng xuất kho (${atStr})`,
        text: `${buildPlainText(dupes, settings.dupSinceLabel, exclNote.trim() || undefined)}\n\n---\nThời điểm quét: ${atStr}`,
        html: bodyHtml
    });
    return { dupGroups: dupes.length };
}
function vnDateKey(d = new Date()) {
    const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const y = vn.getUTCFullYear();
    const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
    const day = String(vn.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
/**
 * Chạy theo lịch 12h / 17h (VN). Khóa theo ngày + khung giờ để idempotent.
 * SMTP: params EMAIL_USER, secret EMAIL_PASS, EMAIL_TO (+ tuỳ chọn EMAIL_FROM, EMAIL_SMTP_*).
 */
async function runOutboundDupNotifyForSlot(db, slot) {
    const dateKey = vnDateKey(new Date());
    const lockId = `${dateKey}-${slot}h`;
    const lockRef = db.collection('outbound-dup-notify-locks').doc(lockId);
    const canProceed = await db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(lockRef);
        if (snap.exists) {
            const st = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.status;
            if (st === 'done' || st === 'sending') {
                return false;
            }
        }
        tx.set(lockRef, { status: 'sending', slot, dateKey, startedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return true;
    });
    if (!canProceed) {
        console.log('outbound-dup-notify: skip (lock)', lockId);
        return;
    }
    try {
        const settings = await loadControlBatchDupSettings(db);
        const dupes = await scanOutboundDuplicates(db, settings);
        if (dupes.length === 0) {
            await lockRef.set({
                status: 'done',
                dupGroups: 0,
                emailSent: false,
                finishedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return;
        }
        const emailCfg = getEmailCfg();
        if (!emailCfg) {
            console.error('outbound-dup-notify: có trùng nhưng thiếu SMTP (EMAIL_USER, secret EMAIL_PASS, EMAIL_TO)');
            await lockRef.set({
                status: 'done',
                dupGroups: dupes.length,
                emailSent: false,
                emailSkippedReason: 'missing_smtp_config',
                finishedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return;
        }
        await sendDupEmail(dupes, emailCfg, settings);
        await lockRef.set({
            status: 'done',
            dupGroups: dupes.length,
            emailSent: true,
            finishedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log('outbound-dup-notify: emailed', dupes.length, 'groups', lockId);
    }
    catch (e) {
        console.error('outbound-dup-notify failed', e);
        await lockRef.set({
            status: 'error',
            errorAt: admin.firestore.FieldValue.serverTimestamp(),
            error: (e === null || e === void 0 ? void 0 : e.message) || String(e)
        }, { merge: true });
    }
}
//# sourceMappingURL=outbound-dup-notify.js.map