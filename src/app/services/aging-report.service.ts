import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { firstValueFrom } from 'rxjs';
import {
  AgingCorrection, AgingFactory, AgingFactoryMeta, AgingMode, AgingRow, FactoryLedger, InventoryRow, LedgerKind, LedgerRow,
  ParsedAgingFile, StoredReportInfo,
} from './aging-report.parse';

export * from './aging-report.parse';

/**
 * Dữ liệu Aging Report thành phẩm (dùng lâu dài, SXXK sẽ đọc lại).
 *
 * Firestore:
 * - `aging-ledger/{F}_{N|X}_{YYYY-MM}_{part}`: bảng kê phiếu nhập (N) / xuất (X) theo tháng, mỗi doc ≤ LEDGER_PART_SIZE dòng.
 *   Import lại cùng kỳ → thay đúng các dòng trong khoảng "Từ ngày … đến ngày …" của file, giữ dòng ngoài khoảng.
 * - `aging-reports/{F}_{YYYY-MM-DD}_{part}`: báo cáo tuổi hàng (sheet "Aging") theo ngày cuối kỳ.
 * - `aging-inventory/{F}_{YYYY-MM-DD}_{part}`: báo cáo tồn kho (kho 21) theo ngày.
 * - `aging-meta/{F}`: kỳ bảng kê đã có, danh sách báo cáo, lịch sử import.
 *
 * F = KZ (ASM1 – Kizuna) | LH (ASM2 – Long Hậu).
 */

type BatchOp = (b: ReturnType<AngularFirestore['firestore']['batch']>) => void;

/** Tên collection theo chế độ: TP dùng `aging-*` (giữ nguyên), NVL dùng `aging-nvl-*` (tách riêng hoàn toàn). */
let COL_LEDGER = 'aging-ledger';
let COL_REPORTS = 'aging-reports';
let COL_INVENTORY = 'aging-inventory';
let COL_META = 'aging-meta';
/** `aging-corrections/{reportId}`: { items: { [key]: AgingCorrection } } — chỉnh sửa trên từng báo cáo tuổi hàng */
let COL_CORRECTIONS = 'aging-corrections';

function useCollections(mode: AgingMode): void {
  const p = mode === 'nvl' ? 'aging-nvl' : 'aging';
  COL_LEDGER = `${p}-ledger`;
  COL_REPORTS = `${p}-reports`;
  COL_INVENTORY = `${p}-inventory`;
  COL_META = `${p}-meta`;
  COL_CORRECTIONS = `${p}-corrections`;
}
const LEDGER_PART_SIZE = 1500;
const REPORT_PART_SIZE = 1500;
const MAX_IMPORT_LOG = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

function emptyMeta(factory: AgingFactory): AgingFactoryMeta {
  return { factory, ledgerRange: {}, reports: [], inventories: [], imports: [] };
}

@Injectable({ providedIn: 'root' })
export class AgingReportService {
  constructor(private firestore: AngularFirestore, private afAuth: AngularFireAuth) {}

  /** Chế độ đang dùng (tp = thành phẩm, nvl = nguyên liệu) — gọi khi mở trang. */
  mode: AgingMode = 'tp';

  setMode(mode: AgingMode): void {
    this.mode = mode;
    useCollections(mode);
  }

  async loadMeta(factory: AgingFactory): Promise<AgingFactoryMeta> {
    const snap = await firstValueFrom(this.firestore.collection(COL_META).doc(factory).get());
    const data = snap.exists ? (snap.data() as Partial<AgingFactoryMeta>) : null;
    return { ...emptyMeta(factory), ...(data || {}), factory };
  }

  /** Toàn bộ bảng kê nhập / xuất đã lưu của 1 nhà máy. */
  async loadLedger(factory: AgingFactory): Promise<FactoryLedger> {
    const snap = await firstValueFrom(
      this.firestore.collection(COL_LEDGER, ref => ref.where('factory', '==', factory)).get()
    );
    const out: FactoryLedger = { N: [], X: [], docs: [] };
    snap.forEach(doc => {
      const data = doc.data() as { kind: LedgerKind; month: string; rows: LedgerRow[] };
      out.docs.push({ id: doc.id, kind: data.kind, month: data.month });
      out[data.kind].push(...(data.rows || []));
    });
    out.N.sort((a, b) => a.d.localeCompare(b.d));
    out.X.sort((a, b) => a.d.localeCompare(b.d));
    return out;
  }

  /**
   * Sửa 1 phiếu trong bảng kê (mã lô / kho / lượng) — tìm đúng dòng trong doc tháng của phiếu.
   * Ghi lại giá trị cũ (orig) + người sửa. Lưu ý: import lại bảng kê cùng kỳ sẽ ghi đè phần sửa.
   */
  async updateLedgerRow(factory: AgingFactory, kind: LedgerKind, orig: LedgerRow, patch: Partial<LedgerRow>): Promise<void> {
    const by = await this.currentUserLabel();
    const month = String(orig.d || '').slice(0, 7);
    const snap = await firstValueFrom(this.firestore.collection(COL_LEDGER, ref =>
      ref.where('factory', '==', factory).where('kind', '==', kind).where('month', '==', month)).get());
    const same = (a: LedgerRow, b: LedgerRow) => a.d === b.d && a.ct === b.ct && a.no === b.no && a.sku === b.sku
      && a.lot === b.lot && a.wh === b.wh && Math.abs((a.q || 0) - (b.q || 0)) < 1e-9 && (a.lsx || '') === (b.lsx || '');
    for (const doc of snap.docs) {
      const rows = ((doc.data() as { rows?: LedgerRow[] }).rows || []).slice();
      const idx = rows.findIndex(r => same(r, orig));
      if (idx < 0) continue;
      const prev = rows[idx] as LedgerRow & { orig?: unknown };
      rows[idx] = {
        ...prev, ...patch,
        orig: prev.orig || { lot: prev.lot, wh: prev.wh, q: prev.q },
        editedBy: by, editedAt: new Date().toISOString(),
      } as LedgerRow;
      await doc.ref.update({ rows, updatedAt: new Date().toISOString() });
      return;
    }
    throw new Error('Không tìm thấy phiếu trong bảng kê (có thể vừa import lại) — bấm Tải lại rồi thử lại.');
  }

  async loadAgingRows(info: StoredReportInfo): Promise<AgingRow[]> {
    return this.loadParts<AgingRow>(COL_REPORTS, info);
  }

  async loadInventoryRows(info: StoredReportInfo): Promise<InventoryRow[]> {
    return this.loadParts<InventoryRow>(COL_INVENTORY, info);
  }

  async loadCorrections(reportId: string): Promise<Record<string, AgingCorrection>> {
    const snap = await firstValueFrom(this.firestore.collection(COL_CORRECTIONS).doc(reportId).get());
    return snap.exists ? (((snap.data() as { items?: Record<string, AgingCorrection> }).items) || {}) : {};
  }

  /**
   * Lưu (correction) hoặc xóa (null) chỉnh sửa của 1 dòng. Đọc lại bản mới nhất trước khi ghi
   * để không đè chỉnh sửa người khác vừa lưu ở dòng khác. Trả về toàn bộ chỉnh sửa sau khi ghi.
   */
  async saveCorrection(
    reportId: string, key: string, correction: Omit<AgingCorrection, 'by' | 'at' | 'key'> | null
  ): Promise<Record<string, AgingCorrection>> {
    const items = await this.loadCorrections(reportId);
    if (correction) {
      items[key] = { ...correction, key, by: await this.currentUserLabel(), at: new Date().toISOString() };
    } else {
      delete items[key];
    }
    // Firestore không nhận undefined
    const clean = JSON.parse(JSON.stringify(items));
    await this.firestore.collection(COL_CORRECTIONS).doc(reportId).set({ reportId, items: clean });
    return clean;
  }

  private async loadParts<T>(col: string, info: StoredReportInfo): Promise<T[]> {
    const parts = await Promise.all(
      Array.from({ length: info.partCount }, (_, i) =>
        firstValueFrom(this.firestore.collection(col).doc(`${info.id}_${i + 1}`).get())
      )
    );
    const rows: T[] = [];
    for (const p of parts) if (p.exists) rows.push(...(((p.data() as { rows: T[] }).rows) || []));
    return rows;
  }

  /**
   * Lưu 1 file đã đọc. Bảng kê: thay các dòng trong khoảng [from, to] của file (theo từng tháng),
   * giữ nguyên dòng ngoài khoảng → import tuần sau (cùng từ 01/01) không bị nhân đôi.
   */
  async saveParsedFile(file: ParsedAgingFile & { factory: AgingFactory }, ledger: FactoryLedger | null): Promise<void> {
    const by = await this.currentUserLabel();
    const at = new Date().toISOString();
    const meta = await this.loadMeta(file.factory);

    if (file.kind === 'N' || file.kind === 'X') {
      const current = ledger || (await this.loadLedger(file.factory));
      await this.replaceLedgerRange(file.factory, file.kind, file.from, file.to, file.ledgerRows || [], current, file.fileName);
      const prev = meta.ledgerRange[file.kind];
      meta.ledgerRange[file.kind] = {
        from: prev && prev.from < file.from ? prev.from : file.from,
        to: prev && prev.to > file.to ? prev.to : file.to,
      };
    } else {
      const isAging = file.kind === 'aging';
      const col = isAging ? COL_REPORTS : COL_INVENTORY;
      const rows: unknown[] = (isAging ? file.agingRows : file.inventoryRows) || [];
      const id = `${file.factory}_${file.to}`;
      const list = isAging ? meta.reports : meta.inventories;
      const old = list.find(r => r.id === id);
      const parts = chunk(rows, REPORT_PART_SIZE);
      const ops: Array<BatchOp> = [];
      parts.forEach((p, i) => {
        const ref = this.firestore.collection(col).doc(`${id}_${i + 1}`).ref;
        ops.push(b => b.set(ref, { factory: file.factory, reportId: id, part: i + 1, rows: p }));
      });
      for (let i = parts.length + 1; old && i <= old.partCount; i++) {
        const ref = this.firestore.collection(col).doc(`${id}_${i}`).ref;
        ops.push(b => b.delete(ref));
      }
      await this.commitOps(ops);
      const info: StoredReportInfo = {
        id, from: file.from, to: file.to, fileName: file.fileName, rowCount: rows.length,
        partCount: parts.length, importedAt: at, importedBy: by,
      };
      const next = list.filter(r => r.id !== id).concat(info).sort((a, b) => b.to.localeCompare(a.to));
      if (isAging) meta.reports = next;
      else meta.inventories = next;
    }

    const rowCount = (file.ledgerRows || file.agingRows || file.inventoryRows || []).length;
    meta.imports = [{ kind: file.kind, fileName: file.fileName, from: file.from, to: file.to, rowCount, at, by }, ...meta.imports]
      .slice(0, MAX_IMPORT_LOG);
    await this.firestore.collection(COL_META).doc(file.factory).set(meta);
  }

  private async replaceLedgerRange(
    factory: AgingFactory, kind: LedgerKind, from: string, to: string,
    rows: LedgerRow[], current: FactoryLedger, fileName: string
  ): Promise<void> {
    const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
    const months = new Set<string>(rows.map(r => r.d.slice(0, 7)));
    // Tháng có dữ liệu cũ nằm trong khoảng file (kể cả khi file mới không còn dòng nào của tháng đó)
    current[kind].forEach(r => { if (inRange(r.d)) months.add(r.d.slice(0, 7)); });

    const ops: Array<BatchOp> = [];
    const updatedAt = new Date().toISOString();
    for (const month of Array.from(months).sort()) {
      const keep = current[kind].filter(r => r.d.slice(0, 7) === month && !inRange(r.d));
      const merged = keep.concat(rows.filter(r => r.d.slice(0, 7) === month)).sort((a, b) => a.d.localeCompare(b.d));
      current.docs
        .filter(d => d.kind === kind && d.month === month)
        .forEach(d => { const ref = this.firestore.collection(COL_LEDGER).doc(d.id).ref; ops.push(b => b.delete(ref)); });
      if (!merged.length) continue;
      chunk(merged, LEDGER_PART_SIZE).forEach((p, i) => {
        const ref = this.firestore.collection(COL_LEDGER).doc(`${factory}_${kind}_${month}_${i + 1}`).ref;
        ops.push(b => b.set(ref, { factory, kind, month, part: i + 1, rows: p, fileName, updatedAt }));
      });
    }
    await this.commitOps(ops);

    // Cập nhật bản trong bộ nhớ để import file tiếp theo (cùng phiên) dùng đúng dữ liệu
    current[kind] = current[kind].filter(r => !inRange(r.d)).concat(rows).sort((a, b) => a.d.localeCompare(b.d));
    current.docs = current.docs.filter(d => !(d.kind === kind && months.has(d.month)));
    for (const month of Array.from(months)) {
      const n = current[kind].filter(r => r.d.slice(0, 7) === month).length;
      for (let i = 1; i <= Math.ceil(n / LEDGER_PART_SIZE); i++) current.docs.push({ id: `${factory}_${kind}_${month}_${i}`, kind, month });
    }
  }

  /** Delete trước set trong cùng batch → doc trùng id vẫn được ghi mới. */
  private async commitOps(ops: Array<BatchOp>): Promise<void> {
    for (let i = 0; i < ops.length; i += 400) {
      const batch = this.firestore.firestore.batch();
      ops.slice(i, i + 400).forEach(op => op(batch));
      await batch.commit();
    }
  }

  private async currentUserLabel(): Promise<string> {
    const u = await this.afAuth.currentUser;
    return (u && (u.email || u.displayName || u.uid)) || '';
  }
}
