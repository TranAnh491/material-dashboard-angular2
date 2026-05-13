"use strict";
/**
 * Đồng bộ logic với `RmBagHistoryService.parseQrPart4` (Angular) +
 * khôi phục tem Bag đầy đủ khi Firestore chỉ có bagBatch dạng i/tổng (vd 8/8)
 * nhưng đuôi (T…) nằm trong notes / chuỗi QR đầy đủ.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeParenAscii = normalizeParenAscii;
exports.parseQrPart4 = parseQrPart4;
exports.resolveOutboundBagDupSticker = resolveOutboundBagDupSticker;
exports.outboundAsm1BagColumnFromBagBatchOnly = outboundAsm1BagColumnFromBagBatchOnly;
exports.bichFirstTotalDenominator = bichFirstTotalDenominator;
exports.resolveControlBatchOutboundRowBagFields = resolveControlBatchOutboundRowBagFields;
function normalizeParenAscii(s) {
    return String(s || '')
        .replace(/\uFF08/g, '(')
        .replace(/\uFF09/g, ')')
        .trim();
}
/** Parse phần 4 QR — mirror Angular `parseQrPart4`. */
function parseQrPart4(part4) {
    const raw0 = String(part4 !== null && part4 !== void 0 ? part4 : '').trim();
    const raw = typeof raw0.normalize === 'function' ? raw0.normalize('NFKC') : raw0;
    if (!raw) {
        return { imdKey: '', bagFractionLabel: '', bagNumberDisplay: '' };
    }
    let splitSuffix = '';
    let head = raw;
    const splitM = /^(.+?)(?:\(([Tt]\d+)\)|([Tt]\d+))$/.exec(raw);
    if (splitM) {
        head = splitM[1].trim();
        const tag = (splitM[2] || splitM[3] || '').trim();
        splitSuffix = tag ? `(${tag.toUpperCase()})` : '';
    }
    const m = /^(\d{8})-(\d+)\/(\d+)$/.exec(head);
    if (m) {
        const num = m[2];
        const den = m[3];
        const bagFractionLabel = `${num}/${den}`;
        const bagNumberDisplay = splitSuffix ? `${num}${splitSuffix}` : num;
        return {
            imdKey: m[1],
            bagFractionLabel,
            bagNumberDisplay
        };
    }
    if (/^\d{8}$/.test(head)) {
        return { imdKey: head, bagFractionLabel: '', bagNumberDisplay: '' };
    }
    const lead8 = /^(\d{8})/.exec(head);
    if (lead8) {
        return {
            imdKey: lead8[1],
            bagFractionLabel: '',
            bagNumberDisplay: ''
        };
    }
    return { imdKey: head, bagFractionLabel: '', bagNumberDisplay: '' };
}
function extractQrPart4HintsFromNotes(notes) {
    const n = String(notes !== null && notes !== void 0 ? notes : '');
    const out = [];
    const re = /\d{8}-\d+\/\d+(?:\([^)]*\)|(?:[Tt]\d+))?/g;
    let m;
    while ((m = re.exec(n)) !== null) {
        out.push(m[0]);
    }
    return out;
}
/**
 * Khóa Bag cho Control Batch / mail / Zalo:
 * 1) bagNumberDisplay trên doc (chuẩn hoá ngoặc)
 * 2) Parse importDate / batchNumber / notes (QR đầy đủ hoặc đoạn DDMMYYYY-i/j(T…))
 * 3) Fallback bagBatch (VD 8/8)
 */
function resolveOutboundBagDupSticker(d) {
    var _a;
    const bagBatchRaw = normalizeParenAscii(d['bagBatch'] != null && String(d['bagBatch']).trim() !== '' ? String(d['bagBatch']) : '');
    let bagNumberDisplayRaw = '';
    if (d['bagNumberDisplay'] != null && String(d['bagNumberDisplay']).trim() !== '') {
        bagNumberDisplayRaw = normalizeParenAscii(String(d['bagNumberDisplay']));
    }
    if (bagNumberDisplayRaw) {
        return { sticker: bagNumberDisplayRaw, bagBatchRaw, bagNumberDisplayRaw };
    }
    const tries = [];
    const push = (x) => {
        const s = normalizeParenAscii(String(x !== null && x !== void 0 ? x : '').trim());
        if (s)
            tries.push(s);
    };
    push(d['importDate']);
    push(d['batchNumber']);
    for (const hint of extractQrPart4HintsFromNotes(d['notes'] != null ? String(d['notes']) : '')) {
        push(hint);
    }
    const noteLines = String((_a = d['notes']) !== null && _a !== void 0 ? _a : '').split(/[\r\n]+/);
    for (const line of noteLines) {
        const t = line.trim();
        if (!t)
            continue;
        if (t.includes('|')) {
            const parts = t.split('|').map(p => p.trim());
            if (parts.length >= 4)
                push(parts[3]);
        }
    }
    for (const c of tries) {
        const p = parseQrPart4(c);
        const b = normalizeParenAscii(p.bagNumberDisplay);
        if (b) {
            return { sticker: b, bagBatchRaw, bagNumberDisplayRaw };
        }
    }
    return { sticker: bagBatchRaw, bagBatchRaw, bagNumberDisplayRaw };
}
/** Cột Bag khi không có `bagNumberDisplay`: giống `outbound-asm1.getBagNumberDisplay(bagBatch)` (tách theo dấu phẩy). */
function outboundAsm1BagColumnFromBagBatchOnly(bagBatch) {
    var _a;
    const s = String(bagBatch !== null && bagBatch !== void 0 ? bagBatch : '').trim();
    if (!s)
        return '';
    const segs = s
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
    const nums = [];
    for (const seg of segs) {
        const iPart = (_a = String(seg).split('/')[0]) === null || _a === void 0 ? void 0 : _a.trim();
        const n = iPart ? parseInt(iPart, 10) : NaN;
        if (Number.isFinite(n) && n > 0)
            nums.push(String(n));
    }
    return nums.length ? nums.join(', ') : '';
}
/** Tử số đầu tiên của bịch `i/tổng` (hoặc segment đầu trước dấu phẩy). */
function bichFirstNumerator(bich) {
    var _a;
    const first = ((_a = String(bich || '').trim().split(',')[0]) === null || _a === void 0 ? void 0 : _a.trim()) || '';
    const m = /^(\d+)\s*\/\s*\d+/.exec(first);
    return (m === null || m === void 0 ? void 0 : m[1]) ? m[1] : '';
}
/** Mẫu số tổng (tổng số bịch trong lô) từ `i/tổng` đầu tiên; null nếu không parse được. */
function bichFirstTotalDenominator(bich) {
    var _a;
    const first = ((_a = String(bich || '').trim().split(',')[0]) === null || _a === void 0 ? void 0 : _a.trim()) || '';
    const m = /\/\s*(\d+)\s*$/.exec(first);
    if (!m)
        return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
}
/**
 * Đồng bộ với Outbound ASM1 `mapOutboundDocToMaterial` + `getOutboundBagColumnDisplay`:
 * - Bịch: `bagBatch` hoặc parse từ `importDate`
 * - Bag: `bagNumberDisplay` hoặc parse từ `importDate`, không có thì suy từ bịch (chỉ số)
 *
 * `eligibleForDupScan=false` khi lô có >1 bịch (tổng > 1) mà Bag chỉ còn số suy từ bịch,
 * không có `(T…)` và không có `bagNumberDisplay` ghi trên doc — tránh gom nhầm nhiều tem tách.
 */
function resolveControlBatchOutboundRowBagFields(d) {
    const rawImd = d['importDate'] != null && d['importDate'] !== '' ? String(d['importDate']) : '';
    const pImd = rawImd ? parseQrPart4(rawImd) : null;
    const bagBatchNorm = (d['bagBatch'] != null && String(d['bagBatch']).trim() !== '' ? String(d['bagBatch']).trim() : '') ||
        ((pImd === null || pImd === void 0 ? void 0 : pImd.bagFractionLabel) ? String(pImd.bagFractionLabel) : '');
    const explicitBagNumberField = d['bagNumberDisplay'] != null && String(d['bagNumberDisplay']).trim() !== '';
    const bagNumNorm = explicitBagNumberField
        ? normalizeParenAscii(String(d['bagNumberDisplay']).trim())
        : (pImd === null || pImd === void 0 ? void 0 : pImd.bagNumberDisplay)
            ? normalizeParenAscii(String(pImd.bagNumberDisplay))
            : '';
    const bich = normalizeParenAscii(String(bagBatchNorm || '').trim());
    let bagUi = String(bagNumNorm || '').trim();
    if (!bagUi) {
        bagUi = outboundAsm1BagColumnFromBagBatchOnly(bich);
    }
    const den = bichFirstTotalDenominator(bich);
    const hasSplitTag = /\([Tt]\d+\)/.test(bagUi);
    const onlyDigitsAndCommaList = /^[\d,\s]+$/.test(bagUi);
    const weakDupKey = den != null &&
        den > 1 &&
        !explicitBagNumberField &&
        !hasSplitTag &&
        onlyDigitsAndCommaList &&
        bagUi.length > 0 &&
        bagUi === outboundAsm1BagColumnFromBagBatchOnly(bich);
    // Nếu parse importDate cho bag chỉ là số trùng numerator (không tem T) trong lô >1 → yếu
    const parsedNumOnlySameAsNumerator = den != null &&
        den > 1 &&
        !explicitBagNumberField &&
        !hasSplitTag &&
        bagUi.length > 0 &&
        (pImd === null || pImd === void 0 ? void 0 : pImd.bagNumberDisplay) &&
        bagUi === bichFirstNumerator(bich);
    const eligibleForDupScan = bich.length > 0 &&
        bagUi.length > 0 &&
        /\d/.test(bich) &&
        /\d/.test(bagUi) &&
        !weakDupKey &&
        !parsedNumOnlySameAsNumerator;
    return { bichBatch: bich, bagDisplay: bagUi, eligibleForDupScan, explicitBagNumberField };
}
//# sourceMappingURL=outbound-bag-resolve.js.map