import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

/** Loại sự kiện theo bịch (RM1/RM2) */
export type RmBagHistoryEventType = 'NHẬP' | 'XUẤT' | 'TỒN';

/**
 * Phần 4 QR (IMD): `DDMMYYYY`, `DDMMYYYY-i/tổng`, hoặc `DDMMYYYY-i/tổng(T1)` (bịch tách).
 * - imdKey: DDMMYYYY — khớp inventory / cột IMD materials
 * - bagFractionLabel: `i/tổng` — cột Bịch, rm-bag-history
 * - bagNumberDisplay: `i` hoặc `i(T1)` — cột Bag trên outbound
 */
export type QrPart4Parsed = {
  imdKey: string;
  bagDelta: number;
  bagFractionLabel: string;
  bagNumberDisplay: string;
};

export interface RmBagHistoryEntry {
  event: RmBagHistoryEventType;
  factory: string;
  materialCode: string;
  poNumber: string;
  /** batchNumber / IMD (DDMMYYYY…) */
  imd: string;
  totalBags: number;
  exportedBags: number;
  remainingBags: number;
  /** Chỉ XUẤT: số bịch tăng trong lần này */
  bagsDelta?: number;
  /** Nhãn bịch từ QR phần 4 dạng DDMMYYYY-i/tổng → "i/tổng" (VD: 3/10) */
  bagBatch?: string;
  /** Hiển thị Bag (ưu tiên): `i` hoặc `i(T...)` khi bịch lẻ/tách — để tránh nhầm khi kiểm tra. */
  bagNumberDisplay?: string;
  inventoryDocId?: string;
  note?: string;
}

export interface SnapshotTonResult {
  written: number;
  skipped: number;
  /** Số dòng ước tổng bịch từ tồn kho ÷ LDV (khi totalBags trên doc = 0) */
  derivedFromStock: number;
  resetId: string;
  /** Số mã khác nhau đã chọn (khi snapshot theo danh sách mã) */
  requestedCodes?: number;
}

/** Tuỳ chọn snapshot TỒN — không truyền materialCodes = đọc toàn bộ kho theo factory (có thể nặng). */
export interface SnapshotTonOptions {
  materialCodes?: string[];
  onProgress?: (writtenSoFar: number, totalToWrite: number) => void;
}

@Injectable({ providedIn: 'root' })
export class RmBagHistoryService {
  private readonly collectionName = 'rm-bag-history';

  constructor(private firestore: AngularFirestore) {}

  /**
   * Parse phần 4 QR: hậu tố `(T1)` / `(t2)` = bịch tách; phần bịch vẫn là i/tổng.
   */
  parseQrPart4(part4: string | null | undefined): QrPart4Parsed {
    const raw0 = (part4 ?? '').trim();
    const raw = typeof raw0.normalize === 'function' ? raw0.normalize('NFKC') : raw0;
    if (!raw) {
      return { imdKey: '', bagDelta: 0, bagFractionLabel: '', bagNumberDisplay: '' };
    }

    let splitSuffix = '';
    let head = raw;
    // Hậu tố bịch tách có thể là "(T123)" hoặc "T123" (một số tem không có ngoặc)
    const splitM = /^(.+?)(?:\(([Tt]\d+)\)|([Tt]\d+))$/.exec(raw);
    if (splitM) {
      head = splitM[1].trim();
      const tag = (splitM[2] || splitM[3] || '').trim();
      splitSuffix = tag ? `(${tag.toUpperCase()})` : '';
    }

    // Một số tem có thêm hậu tố sau DDMMYYYY (VD: DDMMYYYY01-2/2).
    // Vẫn lấy imdKey = 8 số đầu, bag = phần sau dấu '-'.
    const m = /^(\d{8})\d*-(\d+)\/(\d+)$/.exec(head);
    if (m) {
      const num = m[2];
      const den = m[3];
      const bagFractionLabel = `${num}/${den}`;
      const bagNumberDisplay = splitSuffix ? `${num}${splitSuffix}` : num;
      return {
        imdKey: m[1],
        bagDelta: 1,
        bagFractionLabel,
        bagNumberDisplay
      };
    }

    if (/^\d{8}$/.test(head)) {
      return { imdKey: head, bagDelta: 0, bagFractionLabel: '', bagNumberDisplay: '' };
    }

    const lead8 = /^(\d{8})/.exec(head);
    if (lead8) {
      return {
        imdKey: lead8[1],
        bagDelta: 0,
        bagFractionLabel: '',
        bagNumberDisplay: ''
      };
    }

    return { imdKey: head, bagDelta: 0, bagFractionLabel: '', bagNumberDisplay: '' };
  }

  /**
   * Phần 4 QR nhập/xuất: DDMMYYYY hoặc DDMMYYYY-i/tổng (có thể thêm (T1)).
   * Trả về nhãn bịch "i/tổng" để hiển thị cột Bịch / ghi rm-bag-history.
   */
  extractBagLabelFromQrPart4(part4: string | null | undefined): string {
    return this.parseQrPart4(part4).bagFractionLabel;
  }

  /** Ngoặc fullwidth → ASCII — tránh mất nhánh `(T…)` khi đọc tem. */
  normalizeParenAscii(s: string): string {
    return String(s || '')
      .replace(/\uFF08/g, '(')
      .replace(/\uFF09/g, ')')
      .trim();
  }

  private extractQrPart4HintsFromNotes(notes: string | null | undefined): string[] {
    const n = String(notes ?? '');
    const out: string[] = [];
    const re = /\d{8}-\d+\/\d+(?:\([^)]*\)|(?:[Tt]\d+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(n)) !== null) {
      out.push(m[0]);
    }
    return out;
  }

  /**
   * Khóa Bag cho Control Batch / trùng xuất: luôn ưu tiên tem đầy đủ (đuôi T…),
   * không chỉ phần i/tổng — đồng bộ Functions `outbound-bag-resolve.ts`.
   */
  resolveOutboundDupBagSticker(fields: {
    bagNumberDisplay?: string | null;
    bagBatch?: string | null;
    importDate?: string | null;
    batchNumber?: string | null;
    notes?: string | null;
  }): string {
    const bagBatchRaw = this.normalizeParenAscii(String(fields.bagBatch ?? '').trim());
    let disp = this.normalizeParenAscii(String(fields.bagNumberDisplay ?? '').trim());
    if (disp) {
      return disp;
    }

    const tries: string[] = [];
    const push = (x: string | null | undefined) => {
      const s = this.normalizeParenAscii(String(x ?? '').trim());
      if (s) tries.push(s);
    };

    push(fields.importDate);
    push(fields.batchNumber);
    for (const hint of this.extractQrPart4HintsFromNotes(fields.notes)) {
      push(hint);
    }

    for (const line of String(fields.notes ?? '').split(/[\r\n]+/)) {
      const t = line.trim();
      if (!t) continue;
      if (t.includes('|')) {
        const parts = t.split('|').map(p => p.trim());
        if (parts.length >= 4) push(parts[3]);
      }
    }

    for (const c of tries) {
      const p = this.parseQrPart4(c);
      const b = this.normalizeParenAscii(p.bagNumberDisplay);
      if (b) {
        return b;
      }
    }

    return bagBatchRaw;
  }

  /** Ghi một dòng lịch sử (không throw — tránh chặn nhập/xuất). */
  async log(entry: RmBagHistoryEntry): Promise<void> {
    try {
      await this.firestore.collection(this.collectionName).add({
        ...entry,
        createdAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('[RmBagHistory] log failed:', e);
    }
  }

  /** LDV / rollsOrBags trên document inventory (có thể là string). */
  private rollsOrBagsFromInventory(d: Record<string, unknown>): number {
    const r = d['rollsOrBags'];
    if (r == null) return 0;
    if (typeof r === 'number') return isFinite(r) && r > 0 ? r : 0;
    const s = String(r).replace(/,/g, '').replace(/\s/g, '').trim();
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Tính total/xuất/tồn bịch cho snapshot.
   * - Ưu tiên totalBags / exportedBags trên doc.
   * - Nếu totalBags = 0 nhưng có tồn (stock/quantity) và LDV > 0: ước total = ceil(tồn / LDV).
   * - Nếu exportedBags = 0 nhưng có exported (lượng xuất theo đơn vị): ước xuất bịch = floor(exported / LDV).
   */
  private computeBagsForSnapshot(d: Record<string, unknown>): {
    total: number;
    xuat: number;
    remaining: number;
    derived: boolean;
  } | null {
    let total = Math.max(0, Math.floor(Number(d['totalBags'] ?? 0)));
    let xuat = Math.max(0, Math.floor(Number(d['exportedBags'] ?? 0)));
    const ldv = this.rollsOrBagsFromInventory(d);
    const stock = Number(d['stock'] ?? d['quantity'] ?? 0);
    const exportedQty = Number(d['exported'] ?? 0);
    let derived = false;

    if (total <= 0 && ldv > 0 && stock > 0) {
      total = Math.max(1, Math.ceil(stock / ldv));
      derived = true;
    }

    if (xuat <= 0 && ldv > 0 && exportedQty > 0 && total > 0) {
      xuat = Math.min(total, Math.max(0, Math.floor(exportedQty / ldv)));
    }

    const remaining = Math.max(0, total - xuat);
    if (remaining <= 0) {
      return null;
    }
    return { total, xuat, remaining, derived };
  }

  /**
   * Đọc hết inventory-materials theo factory (phân trang theo documentId nếu được).
   * Nếu thiếu index composite, fallback một lần .where().get().
   */
  private async fetchAllInventoryDocsForFactory(
    factory: string
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const db = this.firestore.firestore;
    const col = db.collection('inventory-materials');
    const idPath = firebase.default.firestore.FieldPath.documentId();
    const pageSize = 400;
    const out: Array<{ id: string; data: Record<string, unknown> }> = [];

    const runPaged = async (): Promise<void> => {
      let last: firebase.default.firestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q: firebase.default.firestore.Query = col.where('factory', '==', factory).orderBy(idPath).limit(pageSize);
        if (last) {
          q = q.startAfter(last);
        }
        const snap = await q.get();
        if (snap.empty) {
          break;
        }
        snap.docs.forEach(doc =>
          out.push({ id: doc.id, data: doc.data() as Record<string, unknown> })
        );
        if (snap.docs.length < pageSize) {
          break;
        }
        last = snap.docs[snap.docs.length - 1] as firebase.default.firestore.QueryDocumentSnapshot;
      }
    };

    try {
      await runPaged();
      if (out.length > 0) {
        return out;
      }
    } catch (e: any) {
      console.warn('[RmBagHistory] Paginated inventory read failed (cần index factory+__name__?):', e?.message || e);
    }

    const fallback = await this.firestore
      .collection('inventory-materials', ref => ref.where('factory', '==', factory))
      .get()
      .toPromise();
    if (!fallback || fallback.empty) {
      return [];
    }
    fallback.docs.forEach(doc =>
      out.push({ id: doc.id, data: doc.data() as Record<string, unknown> })
    );
    return out;
  }

  private normalizeMaterialCodes(codes: string[]): string[] {
    return [...new Set(codes.map(c => String(c ?? '').trim().toUpperCase()).filter(Boolean))];
  }

  /**
   * Chỉ đọc inventory của các mã đã chọn (Firestore `in` tối đa 10 — chia chunk).
   * Nếu query lỗi index → fallback: đọc theo factory rồi lọc client.
   */
  private async fetchInventoryDocsByMaterialCodes(
    factory: string,
    materialCodes: string[]
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const unique = this.normalizeMaterialCodes(materialCodes);
    if (unique.length === 0) {
      return [];
    }

    const out: Array<{ id: string; data: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    const IN_MAX = 10;

    try {
      for (let i = 0; i < unique.length; i += IN_MAX) {
        const chunk = unique.slice(i, i + IN_MAX);
        const snap = await this.firestore
          .collection('inventory-materials', ref =>
            ref.where('factory', '==', factory).where('materialCode', 'in', chunk)
          )
          .get()
          .toPromise();
        if (!snap?.empty) {
          snap.docs.forEach(doc => {
            if (seen.has(doc.id)) {
              return;
            }
            seen.add(doc.id);
            out.push({ id: doc.id, data: doc.data() as Record<string, unknown> });
          });
        }
      }
      return out;
    } catch (e: any) {
      console.warn('[RmBagHistory] fetch by materialCode in — fallback filter:', e?.message || e);
      const all = await this.fetchAllInventoryDocsForFactory(factory);
      const allow = new Set(unique);
      return all.filter(d =>
        allow.has(String(d.data['materialCode'] ?? '').trim().toUpperCase())
      );
    }
  }

  /**
   * Đọc `inventory-materials` theo nhà máy (hoặc chỉ các mã trong `options.materialCodes`);
   * mỗi dòng còn tồn bịch > 0 (trực tiếp hoặc ước từ tồn ÷ LDV) ghi một bản ghi `TỒN` vào `rm-bag-history`.
   */
  async snapshotTonFromInventoryToRmHistory(
    factory: 'ASM1' | 'ASM2',
    options?: SnapshotTonOptions
  ): Promise<SnapshotTonResult> {
    const resetId = `snap-${factory}-${Date.now()}`;
    const onProgress = options?.onProgress;
    const codesOpt = options?.materialCodes;
    const requested = codesOpt && codesOpt.length > 0 ? this.normalizeMaterialCodes(codesOpt) : [];

    let docs: Array<{ id: string; data: Record<string, unknown> }>;
    if (requested.length > 0) {
      docs = await this.fetchInventoryDocsByMaterialCodes(factory, requested);
    } else {
      docs = await this.fetchAllInventoryDocsForFactory(factory);
    }

    if (docs.length === 0) {
      return {
        written: 0,
        skipped: 0,
        derivedFromStock: 0,
        resetId,
        requestedCodes: requested.length > 0 ? requested.length : undefined
      };
    }

    const entries: RmBagHistoryEntry[] = [];
    let skipped = 0;
    let derivedFromStock = 0;

    for (const doc of docs) {
      const d = doc.data;
      const materialCode = String(d['materialCode'] ?? '').trim();
      if (!materialCode) {
        skipped++;
        continue;
      }

      const bags = this.computeBagsForSnapshot(d);
      if (!bags) {
        skipped++;
        continue;
      }
      if (bags.derived) {
        derivedFromStock++;
      }

      const poNumber = String(d['poNumber'] ?? '').trim();
      const imd = String(d['batchNumber'] ?? '').trim();
      const bbRaw = d['bagBatch'];
      const bagBatch =
        bbRaw != null && String(bbRaw).trim() !== '' ? String(bbRaw).trim() : undefined;

      const note = bags.derived
        ? `Snapshot TỒN (ước bịch từ tồn÷LDV) — ${resetId}`
        : `Snapshot từ kho — ${resetId}`;

      entries.push({
        event: 'TỒN',
        factory,
        materialCode,
        poNumber,
        imd,
        totalBags: bags.total,
        exportedBags: bags.xuat,
        remainingBags: bags.remaining,
        ...(bagBatch ? { bagBatch } : {}),
        inventoryDocId: doc.id,
        note
      });
    }

    const db = this.firestore.firestore;
    const colRef = db.collection(this.collectionName);
    const BATCH = 450;
    let written = 0;
    const totalToWrite = entries.length;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = db.batch();
      const chunk = entries.slice(i, i + BATCH);
      for (const e of chunk) {
        const ref = colRef.doc();
        batch.set(ref, {
          ...e,
          createdAt: firebase.default.firestore.FieldValue.serverTimestamp()
        });
      }
      await batch.commit();
      written += chunk.length;
      onProgress?.(written, totalToWrite);
      if (i + BATCH < entries.length) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    return {
      written,
      skipped,
      derivedFromStock,
      resetId,
      requestedCodes: requested.length > 0 ? requested.length : undefined
    };
  }
}
