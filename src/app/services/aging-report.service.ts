import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { firstValueFrom } from 'rxjs';
import {
  AgingFactory, AgingFactoryMeta, AgingRow, FactoryLedger, InventoryRow, LedgerKind, LedgerRow,
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

const COL_LEDGER = 'aging-ledger';
const COL_REPORTS = 'aging-reports';
const COL_INVENTORY = 'aging-inventory';
const COL_META = 'aging-meta';
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

  async loadAgingRows(info: StoredReportInfo): Promise<AgingRow[]> {
    return this.loadParts<AgingRow>(COL_REPORTS, info);
  }

  async loadInventoryRows(info: StoredReportInfo): Promise<InventoryRow[]> {
    return this.loadParts<InventoryRow>(COL_INVENTORY, info);
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
