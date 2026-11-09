import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import * as XLSX from 'xlsx';

/**
 * Kế hoạch NVL (tab Report): đọc file "Total material request" (sheet SUM + BOM),
 * tách ra theo từng mốc ngày:
 *  - Về kho  = cột Incoming của SUM (số lượng cần về trước mốc đó = Total Request chia theo ngày)
 *  - Xuất kho = nhu cầu NVL theo ngày giao, cộng từ sheet BOM (đã gồm hao hụt), khớp cột Demand của SUM
 *  - Thiếu (Shortage) của SUM = nợ cũ cần xuất ngay, tính vào trước mốc đầu tiên.
 * Kết quả lưu Firestore `material-plan-imports/{id}` + `chunks/{i}` (chuỗi JSON, mỗi chunk < 1MB)
 * để máy nào mở tab cũng xem được bản import mới nhất.
 */

export const MATERIAL_PLAN_COLLECTION = 'material-plan-imports';
const CHUNK_CHARS = 700_000;

export interface MaterialPlanRow {
  code: string;
  cnCode: string;
  des: string;
  unit: string;
  stock: number;
  /** Nợ cũ (Shortage) — cần xuất ngay, trước mốc đầu tiên. */
  shortage: number;
  totalDemand: number;
  totalRequest: number;
  remark: string;
  type: string;
  fg: string;
  /** Theo từng mốc ngày (cùng thứ tự với `buckets`). */
  inQty: number[];
  outQty: number[];
  /** Phân bổ xuất theo BOM không khớp Demand của SUM → đã co giãn cho khớp. */
  adjusted?: boolean;
}

export interface MaterialPlan {
  id: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: Date | null;
  /** Ngày chốt tồn kho (từ tiêu đề cột Stock), dạng yyyy-MM-dd hoặc ''. */
  stockDate: string;
  /** Các mốc ngày, dạng yyyy-MM-dd. */
  buckets: string[];
  rows: MaterialPlanRow[];
  warnings: string[];
}

const norm = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
};
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Serial ngày Excel → yyyy-MM-dd (tính theo UTC, không lệch múi giờ). */
function serialToKey(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}
const isDateSerial = (v: unknown): v is number => typeof v === 'number' && v > 40000 && v < 60000;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};
/** "Stock\n09.Oct.26" → 2026-10-09 */
function parseStockDate(header: string): string {
  const m = /(\d{1,2})[.\-/ ]([A-Za-z]{3})[.\-/ ](\d{2,4})/.exec(header);
  if (!m) return '';
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

type Aoa = unknown[][];

@Injectable({ providedIn: 'root' })
export class MaterialPlanService {
  constructor(private firestore: AngularFirestore) {}

  /** Đọc file Excel → kế hoạch (chưa lưu). */
  async parseFile(file: File): Promise<Omit<MaterialPlan, 'id' | 'uploadedBy' | 'uploadedAt'>> {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const aoa = (ws: XLSX.WorkSheet): Aoa => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as Aoa;
    const warnings: string[] = [];

    // ── SUM: sheet có cột VNCode + Total Request ──
    let sum: Aoa | null = null;
    let hdrIdx = -1;
    const sumNames = [...wb.SheetNames].sort((a, b) => (a.trim().toUpperCase() === 'SUM' ? -1 : b.trim().toUpperCase() === 'SUM' ? 1 : 0));
    for (const name of sumNames) {
      const rows = aoa(wb.Sheets[name]);
      const i = rows.slice(0, 10).findIndex((r) => (r || []).some((c) => norm(c) === 'vncode') && (r || []).some((c) => norm(c) === 'total request'));
      if (i >= 0) { sum = rows; hdrIdx = i; break; }
    }
    if (!sum) throw new Error('Không tìm thấy sheet SUM (cần có cột VNCode và Total Request).');

    const hdr = sum[hdrIdx] || [];
    const col = (pred: (h: string) => boolean): number => hdr.findIndex((c) => pred(norm(c)));
    const cCode = col((h) => h === 'vncode');
    const cCn = col((h) => h === 'cn code');
    const cDes = col((h) => h === 'des');
    const cUnit = col((h) => h === 'unit');
    const cDemand = col((h) => h === 'demand');
    const cShort = col((h) => h === 'shortage');
    const cTotalDemand = col((h) => h === 'total demand');
    const cStock = col((h) => h.startsWith('stock'));
    const cReq = col((h) => h === 'total request');
    const cRemark = col((h) => h === 'remark');
    const cType = col((h) => h.startsWith('mp/sample'));
    const cFg = col((h) => h.startsWith('fg code'));
    if (cStock < 0) throw new Error('Sheet SUM thiếu cột Stock.');

    const bucketCols: number[] = [];
    for (let j = cStock + 1; j < cReq; j++) if (isDateSerial(hdr[j])) bucketCols.push(j);
    if (!bucketCols.length) throw new Error('Sheet SUM không có cột ngày (Incoming) giữa Stock và Total Request.');
    const buckets = bucketCols.map((j) => serialToKey(hdr[j] as number));
    const stockDate = parseStockDate(String(hdr[cStock] ?? ''));

    // ── BOM: nhu cầu theo mốc ngày cho từng mã vật tư ──
    const bomByCode = new Map<string, number[]>();
    const bomName = wb.SheetNames.find((n) => n.trim().toUpperCase() === 'BOM');
    if (bomName) {
      const bom = aoa(wb.Sheets[bomName]);
      const bh = bom[0] || [];
      const bCode = bh.findIndex((c) => norm(c) === 'mã vật tư');
      const bTotal = bh.findIndex((c) => norm(c) === 'total');
      const bDateCols: number[] = [];
      for (let j = 0; j < (bTotal > 0 ? bTotal : bh.length); j++) if (isDateSerial(bh[j])) bDateCols.push(j);
      if (bCode < 0 || !bDateCols.length) {
        warnings.push('Sheet BOM không đúng mẫu — số xuất kho chưa chia theo ngày.');
      } else {
        if (bDateCols.length !== buckets.length) {
          warnings.push(`BOM có ${bDateCols.length} cột ngày, SUM có ${buckets.length} mốc — ghép theo thứ tự.`);
        }
        for (let i = 1; i < bom.length; i++) {
          const r = bom[i];
          const code = String(r?.[bCode] ?? '').trim().toUpperCase();
          if (!code) continue;
          let arr = bomByCode.get(code);
          if (!arr) bomByCode.set(code, (arr = new Array(buckets.length).fill(0)));
          for (let k = 0; k < Math.min(bDateCols.length, buckets.length); k++) arr[k] += num(r[bDateCols[k]]);
        }
      }
    } else {
      warnings.push('Không có sheet BOM — số xuất kho chưa chia theo ngày.');
    }

    const rows: MaterialPlanRow[] = [];
    let adjustedCount = 0;
    for (let i = hdrIdx + 1; i < sum.length; i++) {
      const r = sum[i];
      const code = String(r?.[cCode] ?? '').trim().toUpperCase();
      if (!code) continue;
      const demand = num(r[cDemand]);
      const inQty = bucketCols.map((j) => round3(num(r[j])));

      let outQty = new Array(buckets.length).fill(0);
      let adjusted = false;
      const bomArr = bomByCode.get(code);
      const bomSum = bomArr ? bomArr.reduce((a, b) => a + b, 0) : 0;
      if (bomArr && bomSum > 0) {
        const k = demand > 0 && Math.abs(bomSum - demand) > Math.max(1, demand * 0.01) ? demand / bomSum : 1;
        adjusted = k !== 1;
        outQty = bomArr.map((v) => v * k);
      } else if (demand > 0) {
        // Không có trong BOM: dồn vào mốc đầu tiên có hàng về (hoặc mốc đầu)
        const first = Math.max(0, inQty.findIndex((v) => v > 0));
        outQty[first] = demand;
        adjusted = true;
      }
      if (adjusted) adjustedCount++;

      rows.push({
        code,
        cnCode: cCn >= 0 ? String(r[cCn] ?? '').trim() : '',
        des: cDes >= 0 ? String(r[cDes] ?? '').trim() : '',
        unit: cUnit >= 0 ? String(r[cUnit] ?? '').trim() : '',
        stock: round3(num(r[cStock])),
        shortage: round3(cShort >= 0 ? num(r[cShort]) : 0),
        totalDemand: round3(cTotalDemand >= 0 ? num(r[cTotalDemand]) : demand),
        totalRequest: round3(num(r[cReq])),
        remark: cRemark >= 0 ? String(r[cRemark] ?? '').trim() : '',
        type: cType >= 0 ? String(r[cType] ?? '').trim() : '',
        fg: cFg >= 0 ? String(r[cFg] ?? '').trim() : '',
        inQty,
        outQty: outQty.map(round3),
        ...(adjusted ? { adjusted: true } : {})
      });
    }
    if (!rows.length) throw new Error('Sheet SUM không có dòng mã vật tư nào.');
    if (adjustedCount) {
      warnings.push(`${adjustedCount} mã có nhu cầu theo BOM lệch với Demand của SUM — đã co giãn cho khớp tổng.`);
    }
    return { fileName: file.name, stockDate, buckets, rows, warnings };
  }

  /** Lưu bản import mới; xong mới xóa các bản cũ (lỗi giữa chừng không làm mất bản đang dùng). */
  async save(plan: Omit<MaterialPlan, 'id' | 'uploadedBy' | 'uploadedAt'>, uploadedBy: string): Promise<string> {
    const db = this.firestore.firestore;
    const col = db.collection(MATERIAL_PLAN_COLLECTION);
    const ref = col.doc();

    const chunks: string[] = [];
    let cur: MaterialPlanRow[] = [];
    let curLen = 2;
    for (const row of plan.rows) {
      const len = JSON.stringify(row).length + 1;
      if (cur.length && curLen + len > CHUNK_CHARS) {
        chunks.push(JSON.stringify(cur));
        cur = [];
        curLen = 2;
      }
      cur.push(row);
      curLen += len;
    }
    if (cur.length) chunks.push(JSON.stringify(cur));

    for (let i = 0; i < chunks.length; i++) {
      await ref.collection('chunks').doc(String(i).padStart(3, '0')).set({ i, data: chunks[i] });
    }
    await ref.set({
      fileName: plan.fileName,
      stockDate: plan.stockDate,
      buckets: plan.buckets,
      warnings: plan.warnings,
      rowCount: plan.rows.length,
      chunkCount: chunks.length,
      uploadedBy,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const old = await col.get();
    for (const d of old.docs) if (d.id !== ref.id) await this.removeImport(d.id);
    return ref.id;
  }

  /** Bản import mới nhất (null nếu chưa có). */
  async loadLatest(): Promise<MaterialPlan | null> {
    const db = this.firestore.firestore;
    const snap = await db.collection(MATERIAL_PLAN_COLLECTION).orderBy('uploadedAt', 'desc').limit(1).get();
    const meta = snap.docs[0];
    if (!meta) return null;
    const x = meta.data() as any;
    const chunkSnap = await meta.ref.collection('chunks').orderBy('i').get();
    if (chunkSnap.size < (Number(x.chunkCount) || 0)) throw new Error('Dữ liệu import chưa đầy đủ — hãy import lại file.');
    const rows: MaterialPlanRow[] = [];
    chunkSnap.docs.forEach((c) => rows.push(...(JSON.parse(String(c.data()['data'] || '[]')) as MaterialPlanRow[])));
    return {
      id: meta.id,
      fileName: String(x.fileName || ''),
      uploadedBy: String(x.uploadedBy || ''),
      uploadedAt: x.uploadedAt?.toDate ? x.uploadedAt.toDate() : null,
      stockDate: String(x.stockDate || ''),
      buckets: Array.isArray(x.buckets) ? x.buckets.map(String) : [],
      warnings: Array.isArray(x.warnings) ? x.warnings.map(String) : [],
      rows
    };
  }

  private async removeImport(id: string): Promise<void> {
    const ref = this.firestore.firestore.collection(MATERIAL_PLAN_COLLECTION).doc(id);
    const chunks = await ref.collection('chunks').get();
    for (const c of chunks.docs) await c.ref.delete();
    await ref.delete();
  }
}
