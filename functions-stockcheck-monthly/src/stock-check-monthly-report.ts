import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';

type Factory = 'ASM1' | 'ASM2';

type ReportDayAggRow = {
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  qtyCheckTotal: number;
  location: string;
  standardPacking: string;
  idCheck: string;
  lastDateCheck: Date;
  hasKhsx: boolean;
  bag?: string;
};

const toDate = (v: any): Date | null => {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    const d = new Date(v);
    return !isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
};

const toDateKey = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export async function generateStockCheckMonthlyReport(params: {
  factory: Factory;
  year: number;
  month: number; // 1..12
}) {
  const { factory, year, month } = params;
  const mm = String(month).padStart(2, '0');

  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  // 1) Load KHSX codes if exists (best-effort)
  let khsxSet = new Set<string>();
  try {
    const snap = await db.collection('khsx-codes').doc(factory).get();
    const arr = (snap.exists ? (snap.data() as any)?.codes : []) as any[];
    if (Array.isArray(arr)) {
      khsxSet = new Set(arr.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean));
    }
  } catch {
    // ignore
  }

  // 2) Read stock-check-history and aggregate only this year-month
  const historySnap = await db
    .collection('stock-check-history')
    .where('factory', '==', factory)
    .get();

  // materialKey -> agg row
  const merged = new Map<string, ReportDayAggRow>();
  const dateKeysUsed = new Set<string>();

  historySnap.forEach((doc) => {
    const data = doc.data() as any;
    const materialCode = String(data?.materialCode || '').trim().toUpperCase();
    const poNumber = String(data?.poNumber || '').trim();
    const imd = String(data?.imd || '').trim();
    const history: any[] = Array.isArray(data?.history) ? data.history : [];
    if (!materialCode || !poNumber || !imd || history.length === 0) return;

    for (const item of history) {
      const d = toDate(item?.dateCheck);
      if (!d) continue;
      if (d.getFullYear() !== year) continue;
      const m = d.getMonth() + 1;
      if (m !== month) continue;

      const dateKey = toDateKey(d);
      dateKeysUsed.add(dateKey);

      const qty = item?.qtyCheck !== undefined && item?.qtyCheck !== null ? Number(item.qtyCheck) : 0;
      if (!qty || qty === 0) continue;

      const stockVal = item?.stock !== undefined && item?.stock !== null ? Number(item.stock) : 0;
      const location = String(item?.location || '').trim();
      const standardPacking = String(item?.standardPacking || '').trim();
      const idCheck = String(item?.idCheck || '').trim() || '-';
      const bag = String(item?.bag || '').trim();

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
      } else {
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
    if (mc !== 0) return mc;
    const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'vi');
    if (po !== 0) return po;
    return String(a.imd || '').localeCompare(String(b.imd || ''), 'vi');
  });

  if (rows.length === 0) {
    return { ok: true, hasData: false, url: null as string | null };
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
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { 'Thông tin': 'Factory', 'Giá trị': factory },
      { 'Thông tin': 'Tháng', 'Giá trị': `${mm}/${year}` },
      { 'Thông tin': 'Số ngày', 'Giá trị': dateKeysUsed.size },
      { 'Thông tin': 'Tổng dòng (gộp)', 'Giá trị': rows.length }
    ]),
    'Tóm tắt'
  );

  const buf: Buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as any;

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
    .set(
      {
        factory,
        year,
        month,
        storagePath,
        url,
        dayCount: dateKeysUsed.size,
        rowCount: rows.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

  return { ok: true, hasData: true, url };
}
