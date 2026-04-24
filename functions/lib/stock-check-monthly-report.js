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
exports.generateStockCheckMonthlyReport = generateStockCheckMonthlyReport;
const admin = __importStar(require("firebase-admin"));
const XLSX = __importStar(require("xlsx"));
const toDate = (v) => {
    try {
        if (!v)
            return null;
        if (v instanceof Date)
            return v;
        if (typeof (v === null || v === void 0 ? void 0 : v.toDate) === 'function') {
            const d = v.toDate();
            return d instanceof Date && !isNaN(d.getTime()) ? d : null;
        }
        const d = new Date(v);
        return !isNaN(d.getTime()) ? d : null;
    }
    catch (_a) {
        return null;
    }
};
const toDateKey = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};
async function generateStockCheckMonthlyReport(params) {
    var _a;
    const { factory, year, month } = params;
    const mm = String(month).padStart(2, '0');
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    // 1) Load KHSX codes if exists (best-effort)
    let khsxSet = new Set();
    try {
        const snap = await db.collection('khsx-codes').doc(factory).get();
        const arr = (snap.exists ? (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.codes : []);
        if (Array.isArray(arr)) {
            khsxSet = new Set(arr.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean));
        }
    }
    catch (_b) {
        // ignore
    }
    // 2) Read stock-check-history and aggregate only this year-month
    const historySnap = await db
        .collection('stock-check-history')
        .where('factory', '==', factory)
        .get();
    // materialKey -> agg row
    const merged = new Map();
    const dateKeysUsed = new Set();
    historySnap.forEach((doc) => {
        const data = doc.data();
        const materialCode = String((data === null || data === void 0 ? void 0 : data.materialCode) || '').trim().toUpperCase();
        const poNumber = String((data === null || data === void 0 ? void 0 : data.poNumber) || '').trim();
        const imd = String((data === null || data === void 0 ? void 0 : data.imd) || '').trim();
        const history = Array.isArray(data === null || data === void 0 ? void 0 : data.history) ? data.history : [];
        if (!materialCode || !poNumber || !imd || history.length === 0)
            return;
        for (const item of history) {
            const d = toDate(item === null || item === void 0 ? void 0 : item.dateCheck);
            if (!d)
                continue;
            if (d.getFullYear() !== year)
                continue;
            const m = d.getMonth() + 1;
            if (m !== month)
                continue;
            const dateKey = toDateKey(d);
            dateKeysUsed.add(dateKey);
            const qty = (item === null || item === void 0 ? void 0 : item.qtyCheck) !== undefined && (item === null || item === void 0 ? void 0 : item.qtyCheck) !== null ? Number(item.qtyCheck) : 0;
            if (!qty || qty === 0)
                continue;
            const stockVal = (item === null || item === void 0 ? void 0 : item.stock) !== undefined && (item === null || item === void 0 ? void 0 : item.stock) !== null ? Number(item.stock) : 0;
            const location = String((item === null || item === void 0 ? void 0 : item.location) || '').trim();
            const standardPacking = String((item === null || item === void 0 ? void 0 : item.standardPacking) || '').trim();
            const idCheck = String((item === null || item === void 0 ? void 0 : item.idCheck) || '').trim() || '-';
            const bag = String((item === null || item === void 0 ? void 0 : item.bag) || '').trim();
            const key = `${materialCode}\0${poNumber.toUpperCase()}\0${imd}\0${bag}\0${location.toUpperCase()}`;
            const existing = merged.get(key);
            if (!existing) {
                merged.set(key, {
                    materialCode,
                    poNumber,
                    imd,
                    stock: stockVal,
                    qtyCheckTotal: qty,
                    location,
                    standardPacking,
                    idCheck,
                    lastDateCheck: d,
                    hasKhsx: khsxSet.has(materialCode),
                    bag
                });
            }
            else {
                existing.qtyCheckTotal += qty;
                if (d.getTime() >= existing.lastDateCheck.getTime()) {
                    existing.stock = stockVal;
                    existing.location = location;
                    existing.standardPacking = standardPacking;
                    existing.idCheck = idCheck;
                    existing.lastDateCheck = d;
                    existing.bag = bag;
                }
            }
        }
    });
    const rows = Array.from(merged.values()).sort((a, b) => {
        const mc = a.materialCode.localeCompare(b.materialCode);
        if (mc !== 0)
            return mc;
        const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'vi');
        if (po !== 0)
            return po;
        return String(a.imd || '').localeCompare(String(b.imd || ''), 'vi');
    });
    if (rows.length === 0) {
        return { ok: true, hasData: false, url: null };
    }
    // 3) Build workbook
    const exportData = rows.map((r, idx) => {
        const stockVal = Number(r.stock || 0);
        const qtyCheckVal = Number(r.qtyCheckTotal || 0);
        const soSanh = Number((stockVal - qtyCheckVal).toFixed(2));
        return {
            STT: idx + 1,
            'Mã hàng': r.materialCode,
            PO: r.poNumber,
            IMD: r.imd,
            Bag: r.bag || '',
            'Tồn Kho': stockVal,
            KHSX: r.hasKhsx ? '✔' : '',
            'Vị trí': r.location || '-',
            'Standard Packing': r.standardPacking || '',
            'Stock Check': '✓',
            'Qty Check': qtyCheckVal,
            'So Sánh Stock': soSanh,
            'ID Check': r.idCheck || '',
            'Date Check': r.lastDateCheck ? r.lastDateCheck.toLocaleString('vi-VN') : ''
        };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportData), `Thang_${mm}`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        { 'Thông tin': 'Factory', 'Giá trị': factory },
        { 'Thông tin': 'Tháng', 'Giá trị': `${mm}/${year}` },
        { 'Thông tin': 'Số ngày', 'Giá trị': dateKeysUsed.size },
        { 'Thông tin': 'Tổng dòng (gộp)', 'Giá trị': rows.length }
    ]), 'Tóm tắt');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    // 4) Save to Storage + signed URL
    const storagePath = `stock-check-reports/${factory}/${year}-${mm}/Stock_Check_${factory}_Thang${mm}.xlsx`;
    const file = bucket.file(storagePath);
    await file.save(buf, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        resumable: false,
        metadata: {
            cacheControl: 'private, max-age=300'
        }
    });
    const [url] = await file.getSignedUrl({
        action: 'read',
        // Long-lived link (can be regenerated anytime)
        expires: '2500-01-01'
    });
    // 5) Persist link in Firestore
    const docId = `${factory}__${year}-${mm}`;
    await db
        .collection('stock-check-monthly-reports')
        .doc(docId)
        .set({
        factory,
        year,
        month,
        storagePath,
        url,
        dayCount: dateKeysUsed.size,
        rowCount: rows.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true, hasData: true, url };
}
//# sourceMappingURL=stock-check-monthly-report.js.map