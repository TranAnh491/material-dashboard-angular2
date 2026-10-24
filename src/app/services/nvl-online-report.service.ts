import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

/** 1 LSX chưa xong có xuất mã NVL đó. */
export interface NvlOnlineLsx {
  lsx: string;
  productCode: string;
  woQty: number;
  fgQty: number;
  /** TP đã nhập ÷ SL sản phẩm (0–1) */
  ratio: number;
  exported: number;
  /** NVL còn ngoài line = đã xuất × (1 − ratio) */
  onLine: number;
}

export interface NvlOnlineRow {
  code: string;
  onLine: number;
  exported: number;
  lsx: NvlOnlineLsx[];
}

export interface NvlOnlineReport {
  query: string;
  mode: 'nvl' | 'lsx';
  rows: NvlOnlineRow[];
  lsxTotal: number;
  lsxOpen: number;
  reads: number;
  at: Date;
}

/**
 * NVL còn ngoài line — chỉ dò khi nhập 1 mã NVL hoặc 1 LSX (đọc ít):
 * - Mã NVL: outbound-materials của mã đó (trong N ngày) → các LSX → Work Order + FG In của các LSX đó.
 * - LSX: outbound-materials của LSX → Work Order + FG In của LSX.
 * LSX chưa xong: TP nhập (FG In) < SL sản phẩm (Work Order).
 * Ngoài line = NVL đã xuất × (1 − TP đã nhập ÷ SL sản phẩm).
 */
@Injectable({ providedIn: 'root' })
export class NvlOnlineReportService {
  private cache = new Map<string, NvlOnlineReport>();
  private static readonly TTL_MS = 10 * 60 * 1000;

  constructor(private firestore: AngularFirestore) {}

  private static norm(v: unknown): string {
    return String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  }

  async run(queryRaw: string, days: number, force = false): Promise<NvlOnlineReport> {
    const query = NvlOnlineReportService.norm(queryRaw);
    if (!query) throw new Error('Nhập mã NVL hoặc LSX.');
    const mode: 'nvl' | 'lsx' = /LSX/.test(query) ? 'lsx' : 'nvl';
    const cacheKey = `${mode}|${query}|${days}`;
    const hit = this.cache.get(cacheKey);
    if (!force && hit && Date.now() - hit.at.getTime() < NvlOnlineReportService.TTL_MS) return hit;

    const db = this.firestore.firestore;
    let reads = 0;
    const chunks = <T>(arr: T[], n = 30): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    // 1. Dòng xuất NVL (Outbound)
    let outDocs: any[] = [];
    if (mode === 'lsx') {
      const variants = Array.from(new Set([String(queryRaw).trim(), query]));
      const snap = await db.collection('outbound-materials').where('productionOrder', 'in', variants).get();
      reads += snap.size;
      outDocs = snap.docs.map((d) => d.data());
    } else {
      const snap = await db.collection('outbound-materials').where('materialCode', '==', query).limit(3000).get();
      reads += snap.size;
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      outDocs = snap.docs.map((d) => d.data()).filter((x: any) => {
        const t = x.exportDate?.toDate ? x.exportDate.toDate().getTime() : 0;
        return !t || t >= cutoff;
      });
    }
    const lsxRaw = Array.from(new Set(outDocs.map((x: any) => String(x.productionOrder || '').trim()).filter(Boolean)));

    // 2. Work Order + FG In của các LSX đó
    const wo = new Map<string, { lsx: string; productCode: string; qty: number }>();
    const fg = new Map<string, number>();
    for (const part of chunks(lsxRaw)) {
      const [woSnap, fgSnap] = await Promise.all([
        db.collection('work-orders').where('productionOrder', 'in', part).get(),
        db.collection('fg-in').where('lsx', 'in', part).get()
      ]);
      reads += woSnap.size + fgSnap.size;
      woSnap.forEach((d) => {
        const x = d.data() as any;
        const key = NvlOnlineReportService.norm(x.productionOrder);
        const qty = Number(x.quantity) || 0;
        if (!key || !(qty > 0)) return;
        const cur = wo.get(key);
        if (cur) cur.qty += qty;
        else wo.set(key, { lsx: String(x.productionOrder || '').trim(), productCode: String(x.productCode || ''), qty });
      });
      fgSnap.forEach((d) => {
        const x = d.data() as any;
        const key = NvlOnlineReportService.norm(x.lsx || x.Lsx);
        fg.set(key, (fg.get(key) || 0) + (Number(x.quantity) || 0));
      });
    }

    // 3. Gộp theo mã NVL, chỉ LSX chưa nhập đủ TP
    const byCode = new Map<string, NvlOnlineRow>();
    const lines = new Map<string, NvlOnlineLsx>();
    let open = 0;
    wo.forEach((w, key) => { if ((fg.get(key) || 0) < w.qty) open++; });
    for (const x of outDocs) {
      const key = NvlOnlineReportService.norm(x.productionOrder);
      const w = wo.get(key);
      const code = String(x.materialCode || '').trim().toUpperCase();
      const qty = Number(x.exportQuantity ?? x.quantity) || 0;
      if (!w || !code || !(qty > 0)) continue;
      const fgQty = fg.get(key) || 0;
      if (fgQty >= w.qty) continue;
      const lineKey = `${code}|${key}`;
      let l = lines.get(lineKey);
      if (!l) {
        l = { lsx: w.lsx, productCode: w.productCode, woQty: w.qty, fgQty, ratio: Math.min(1, Math.max(0, fgQty / w.qty)), exported: 0, onLine: 0 };
        lines.set(lineKey, l);
        const row = byCode.get(code) || { code, onLine: 0, exported: 0, lsx: [] };
        row.lsx.push(l);
        byCode.set(code, row);
      }
      l.exported += qty;
    }
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    byCode.forEach((row) => {
      for (const l of row.lsx) {
        l.exported = r4(l.exported);
        l.onLine = r4(l.exported * (1 - l.ratio));
        row.exported += l.exported;
        row.onLine += l.onLine;
      }
      row.exported = r4(row.exported);
      row.onLine = r4(row.onLine);
      row.lsx.sort((a, b) => b.onLine - a.onLine);
    });
    const report: NvlOnlineReport = {
      query,
      mode,
      rows: Array.from(byCode.values()).filter((r) => r.onLine > 0).sort((a, b) => b.onLine - a.onLine),
      lsxTotal: wo.size,
      lsxOpen: open,
      reads,
      at: new Date()
    };
    this.cache.set(cacheKey, report);
    return report;
  }
}
