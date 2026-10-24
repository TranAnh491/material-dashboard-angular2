import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

/** 1 dòng log = 1 lần scan xuất (tới từng bag). */
export interface OutboundLsxLogLine {
  /** Thời điểm scan (ms) */
  t: number;
  by: string;
  code: string;
  po: string;
  imd: string;
  /** i/tổng của bag */
  bag: string;
  qty: number;
  /** TL-0n / CL-0n nếu là tem lẻ */
  tag: string;
  loc: string;
  /** CAMERA / SCANNER */
  m: string;
}

/**
 * Log xuất kho kiểu "notepad": mỗi LSX mỗi ngày là 1 document chứa mảng dòng scan.
 * Ghi: thêm dòng vào cuối (arrayUnion) — không đọc. Xem 1 LSX: thường 1–3 read (số ngày có scan).
 * Collection: outbound-lsx-log/{factory}__{lsx}__{yyyymmdd}
 */
@Injectable({ providedIn: 'root' })
export class OutboundLsxLogService {
  static readonly COLLECTION = 'outbound-lsx-log';

  constructor(private firestore: AngularFirestore) {}

  static lsxKey(factory: string, lsx: string): string {
    const n = (s: string) => String(s || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[\/#?]+/g, '_');
    return `${n(factory)}__${n(lsx)}`;
  }

  private static dayKey(ms: number): string {
    const d = new Date(ms);
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  /** Ghi thêm các dòng scan (gom theo LSX + ngày). Lỗi chỉ cảnh báo — không chặn việc xuất kho. */
  async append(factory: string, rows: Array<{ lsx: string; line: OutboundLsxLogLine }>): Promise<void> {
    const groups = new Map<string, { lsx: string; key: string; lines: OutboundLsxLogLine[] }>();
    for (const r of rows) {
      const lsx = String(r.lsx || '').trim();
      if (!lsx) continue;
      const key = OutboundLsxLogService.lsxKey(factory, lsx);
      const id = `${key}__${OutboundLsxLogService.dayKey(r.line.t)}`;
      const g = groups.get(id) || { lsx, key, lines: [] };
      g.lines.push(r.line);
      groups.set(id, g);
    }
    if (!groups.size) return;
    const batch = this.firestore.firestore.batch();
    groups.forEach((g, id) => {
      batch.set(this.firestore.firestore.collection(OutboundLsxLogService.COLLECTION).doc(id), {
        factory,
        lsx: g.lsx,
        lsxKey: g.key,
        day: id.slice(-8),
        count: firebase.firestore.FieldValue.increment(g.lines.length),
        lines: firebase.firestore.FieldValue.arrayUnion(...g.lines),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();
  }

  /** Toàn bộ dòng log của 1 LSX (mọi ngày), mới nhất trước. */
  async load(factory: string, lsx: string): Promise<{ lines: OutboundLsxLogLine[]; reads: number }> {
    const snap = await this.firestore.firestore.collection(OutboundLsxLogService.COLLECTION)
      .where('lsxKey', '==', OutboundLsxLogService.lsxKey(factory, lsx))
      .get();
    const lines: OutboundLsxLogLine[] = [];
    snap.docs.forEach((d) => {
      const arr = (d.data() as any)?.lines;
      if (Array.isArray(arr)) lines.push(...arr);
    });
    lines.sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0));
    return { lines, reads: snap.size || 1 };
  }
}
