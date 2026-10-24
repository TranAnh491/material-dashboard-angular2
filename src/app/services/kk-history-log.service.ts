import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

/**
 * Log lịch sử kiểm kê (KK) dạng text gọn — lưu lâu, đọc rẻ.
 *
 * Firestore `kk-history-log/{factory}_{YYYY-MM-DD}[_n]`:
 *   { factory, date, lines: string[] }  — mỗi dòng TSV = 1 lần tick / bỏ tick.
 * 1 doc / nhà máy / ngày (tự sang `_2`, `_3`… khi doc gần đầy 1MB) → xem 1 năm ≈ 365 lượt đọc.
 *
 * Giữ trên Firestore 1 năm. Log cũ hơn 1 năm → tải về file .txt lưu máy tính rồi xóa khỏi
 * Firestore; khi cần xem lại thì Import file đó vào màn Lịch sử KK (chỉ đọc ở máy, không ghi lên).
 */

export const KK_LOG_COLLECTION = 'kk-history-log';
export const KK_LOG_KEEP_DAYS = 365;
const FILE_MAGIC = '# KK-HISTORY-LOG v1';

/** Cột của 1 dòng log (sau cột Ngày khi ra file). */
export const KK_LOG_COLUMNS = ['Giờ', 'Hành động', 'Mã hàng', 'PO', 'Batch', 'Vị trí', 'Pallet', 'Số lượng', 'Tồn', 'ĐVT', 'Người KK', 'Nguồn', 'Tên hàng'];

export interface KkLogRow {
  date: string;
  time: string;
  action: string;
  code: string;
  po: string;
  batch: string;
  location: string;
  pallet: string;
  qty: string;
  stock: string;
  unit: string;
  by: string;
  source: string;
  name: string;
}

/** Payload giống doc `inventory-kk-history` (đủ các field cần cho log). */
export interface KkLogInput {
  factory?: string;
  materialCode?: string;
  materialName?: string;
  poNumber?: string;
  batchNumber?: string;
  location?: string;
  palletId?: string;
  quantity?: number;
  stock?: number;
  unit?: string;
  checkedBy?: string;
  checkedAt?: Date | any;
  action?: string;
  source?: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function kkLogDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clean(v: unknown): string {
  return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function toDate(v: any): Date {
  if (v instanceof Date) return v;
  if (v?.toDate) return v.toDate();
  if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000);
  return new Date();
}

@Injectable({ providedIn: 'root' })
export class KkHistoryLogService {
  private queue: Array<{ factory: string; date: string; line: string }> = [];
  private timer: any = null;
  /** Shard đang ghi theo docBase (tránh thử lại doc đã đầy). */
  private shardOf = new Map<string, number>();

  constructor(private firestore: AngularFirestore) {}

  /** Đưa 1 lần KK vào hàng đợi — ghi gộp sau ~1.5s (tick hàng loạt chỉ tốn vài lượt ghi). */
  enqueue(data: KkLogInput): void {
    const factory = clean(data.factory).toUpperCase() || 'ASM1';
    const at = toDate(data.checkedAt);
    const line = [
      `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`,
      clean(data.action) || 'tick',
      clean(data.materialCode).toUpperCase(),
      clean(data.poNumber),
      clean(data.batchNumber),
      clean(data.location).toUpperCase(),
      clean(data.palletId),
      clean(Number(data.quantity) || 0),
      clean(Number(data.stock) || 0),
      clean(data.unit),
      clean(data.checkedBy).toUpperCase(),
      clean(data.source),
      clean(data.materialName).slice(0, 60)
    ].join('\t');
    this.queue.push({ factory, date: kkLogDateKey(at), line });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 1500);
  }

  async flush(): Promise<void> {
    this.timer = null;
    const items = this.queue.splice(0);
    if (!items.length) return;
    const groups = new Map<string, { factory: string; date: string; lines: string[] }>();
    for (const it of items) {
      const base = `${it.factory}_${it.date}`;
      const g = groups.get(base) || { factory: it.factory, date: it.date, lines: [] };
      g.lines.push(it.line);
      groups.set(base, g);
    }
    for (const [base, g] of groups) {
      for (let i = 0; i < g.lines.length; i += 2000) {
        await this.appendLines(base, g.factory, g.date, g.lines.slice(i, i + 2000));
      }
    }
  }

  private async appendLines(base: string, factory: string, date: string, lines: string[]): Promise<void> {
    let shard = this.shardOf.get(base) || 1;
    for (let attempt = 0; attempt < 30; attempt++) {
      const id = shard === 1 ? base : `${base}_${shard}`;
      try {
        await this.firestore.firestore.collection(KK_LOG_COLLECTION).doc(id).set({
          factory,
          date,
          shard,
          lines: firebase.firestore.FieldValue.arrayUnion(...lines),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        this.shardOf.set(base, shard);
        return;
      } catch (e: any) {
        // Doc vượt 1MB → sang shard kế tiếp
        const msg = String(e?.message || '');
        if (e?.code === 'invalid-argument' || /exceeds the maximum|too large/i.test(msg)) {
          shard += 1;
          continue;
        }
        console.error('❌ kk-history-log:', e);
        return;
      }
    }
  }

  private rangeQuery(factory: string, fromKey: string, toKey: string) {
    const f = factory.toUpperCase();
    return this.firestore.firestore.collection(KK_LOG_COLLECTION)
      .orderBy(firebase.firestore.FieldPath.documentId())
      .startAt(`${f}_${fromKey}`)
      .endAt(`${f}_${toKey}`);
  }

  private docsToRows(docs: firebase.firestore.QueryDocumentSnapshot[]): KkLogRow[] {
    const out: KkLogRow[] = [];
    for (const d of docs) {
      const data = d.data() as any;
      const date = String(data?.date || d.id.split('_')[1] || '');
      for (const line of (data?.lines || []) as string[]) {
        const r = this.parseLine(date, String(line).split('\t'));
        if (r) out.push(r);
      }
    }
    return out;
  }

  private parseLine(date: string, c: string[]): KkLogRow | null {
    if (c.length < 3) return null;
    return {
      date, time: c[0] || '', action: c[1] || '', code: c[2] || '', po: c[3] || '', batch: c[4] || '',
      location: c[5] || '', pallet: c[6] || '', qty: c[7] || '', stock: c[8] || '', unit: c[9] || '',
      by: c[10] || '', source: c[11] || '', name: c[12] || ''
    };
  }

  /** Đọc log trong khoảng ngày (1 lượt đọc / ngày có dữ liệu). */
  async loadRange(factory: string, fromKey: string, toKey: string): Promise<{ rows: KkLogRow[]; reads: number }> {
    const snap = await this.rangeQuery(factory, fromKey, toKey).get();
    return { rows: this.sortRows(this.docsToRows(snap.docs)), reads: snap.size || 1 };
  }

  sortRows(rows: KkLogRow[]): KkLogRow[] {
    return rows.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }

  /** Ngày cắt: log có ngày < cutoff là đã quá 1 năm. */
  archiveCutoffKey(now = new Date()): string {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - KK_LOG_KEEP_DAYS);
    return kkLogDateKey(d);
  }

  /** Có log quá 1 năm cần tải về không? (1 lượt đọc) */
  async isArchiveDue(factory: string): Promise<boolean> {
    const f = factory.toUpperCase();
    const snap = await this.firestore.firestore.collection(KK_LOG_COLLECTION)
      .orderBy(firebase.firestore.FieldPath.documentId())
      .startAt(`${f}_0000`)
      .endBefore(`${f}_${this.archiveCutoffKey()}`)
      .limit(1)
      .get();
    return !snap.empty;
  }

  /** Đọc toàn bộ log quá 1 năm → { text, ids } để tải file rồi xóa. */
  async loadArchive(factory: string): Promise<{ rows: KkLogRow[]; ids: string[]; from: string; to: string }> {
    const f = factory.toUpperCase();
    const snap = await this.firestore.firestore.collection(KK_LOG_COLLECTION)
      .orderBy(firebase.firestore.FieldPath.documentId())
      .startAt(`${f}_0000`)
      .endBefore(`${f}_${this.archiveCutoffKey()}`)
      .get();
    const rows = this.docsToRows(snap.docs).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return {
      rows,
      ids: snap.docs.map((d) => d.id),
      from: rows[0]?.date || '',
      to: rows[rows.length - 1]?.date || ''
    };
  }

  async deleteDocs(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = this.firestore.firestore.batch();
      ids.slice(i, i + 400).forEach((id) => batch.delete(this.firestore.firestore.collection(KK_LOG_COLLECTION).doc(id)));
      await batch.commit();
    }
  }

  /** Nội dung file .txt (mở được bằng Notepad / Excel, import lại được). */
  buildFileText(factory: string, rows: KkLogRow[], from: string, to: string): string {
    const head = [
      FILE_MAGIC,
      `# factory=${factory.toUpperCase()} from=${from} to=${to} rows=${rows.length} exported=${new Date().toISOString()}`,
      ['Ngày', ...KK_LOG_COLUMNS].join('\t')
    ];
    const body = rows.map((r) => [r.date, r.time, r.action, r.code, r.po, r.batch, r.location, r.pallet, r.qty, r.stock, r.unit, r.by, r.source, r.name].join('\t'));
    return '﻿' + [...head, ...body].join('\r\n') + '\r\n';
  }

  downloadText(fileName: string, text: string): void {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Đọc file log đã tải về (chỉ xem ở máy). */
  parseFileText(text: string): KkLogRow[] {
    const rows: KkLogRow[] = [];
    for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
      if (!raw || raw.startsWith('#') || raw.startsWith('Ngày\t')) continue;
      const c = raw.split('\t');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c[0] || '')) continue;
      const r = this.parseLine(c[0], c.slice(1));
      if (r) rows.push(r);
    }
    return this.sortRows(rows);
  }
}
