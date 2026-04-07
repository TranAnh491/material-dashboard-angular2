import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { RmBagHistoryService } from './rm-bag-history.service';

/** Rule QC khi xuất kho RM: khớp IQC Status trên inventory-materials với danh sách cấm. */
export interface OutboundQcRuleDoc {
  enabled: boolean;
  /** Mỗi dòng hoặc cách nhau bởi dấu phẩy / chấm phẩy (VD: NG, CHỜ XÁC NHẬN) */
  blockedStatusesText: string;
}

/** Một dòng tồn (đã chuẩn hóa) dùng để chọn IQC trong RAM — tránh query lặp cùng mã+PO. */
interface CachedInventoryRow {
  normImd: string;
  iqc: string | null;
  available: number;
}

interface CachedInventoryPoPayload {
  ts: number;
  rows: CachedInventoryRow[];
}

@Injectable({ providedIn: 'root' })
export class OutboundQcRuleService {
  private readonly collectionName = 'outbound-qc-rules';

  /** Cache query theo (factory + mã + PO): nhiều tem cùng lô hoặc quét liên tiếp không gọi Firestore lại. */
  private readonly inventoryByMatPoCache = new Map<string, CachedInventoryPoPayload>();
  private readonly INVENTORY_QUERY_TTL_MS = 180_000; // 3 phút — cân bằng tốc độ / độ mới IQC
  private readonly INVENTORY_CACHE_MAX_KEYS = 300;

  constructor(
    private firestore: AngularFirestore,
    private rmBag: RmBagHistoryService
  ) {}

  async loadRule(factory: 'ASM1' | 'ASM2'): Promise<OutboundQcRuleDoc> {
    const snap = await this.firestore.collection(this.collectionName).doc(factory).get().toPromise();
    if (!snap || !snap.exists) {
      return { enabled: false, blockedStatusesText: '' };
    }
    const d = snap.data() as Record<string, unknown>;
    return {
      enabled: d['enabled'] === true,
      blockedStatusesText: String(d['blockedStatusesText'] ?? '')
    };
  }

  async saveRule(factory: 'ASM1' | 'ASM2', doc: OutboundQcRuleDoc): Promise<void> {
    await this.firestore
      .collection(this.collectionName)
      .doc(factory)
      .set(
        {
          enabled: doc.enabled === true,
          blockedStatusesText: String(doc.blockedStatusesText ?? ''),
          updatedAt: new Date()
        },
        { merge: true }
      );
    this.clearInventoryIqcQueryCacheForFactory(factory);
  }

  /** Xóa cache IQC theo xưởng (sau khi đổi rule hoặc cần ép đọc lại tồn). */
  clearInventoryIqcQueryCacheForFactory(factory: string): void {
    const prefix = `${factory}\t`;
    for (const k of this.inventoryByMatPoCache.keys()) {
      if (k.startsWith(prefix)) {
        this.inventoryByMatPoCache.delete(k);
      }
    }
  }

  clearAllInventoryIqcQueryCache(): void {
    this.inventoryByMatPoCache.clear();
  }

  private matPoCacheKey(factory: string, materialCode: string, poNumber: string): string {
    return `${factory}\t${String(materialCode ?? '').trim().toUpperCase()}\t${String(poNumber ?? '').trim()}`;
  }

  private evictOldestInventoryCacheIfNeeded(): void {
    while (this.inventoryByMatPoCache.size > this.INVENTORY_CACHE_MAX_KEYS) {
      const first = this.inventoryByMatPoCache.keys().next().value;
      if (first === undefined) {
        break;
      }
      this.inventoryByMatPoCache.delete(first);
    }
  }

  private extractIqcFromData(data: Record<string, unknown>): string | null {
    const iqc = data['iqcStatus'];
    if (iqc == null || iqc === '') {
      return null;
    }
    return String(iqc).trim();
  }

  /** Chọn IQC giống logic khi đọc từ snapshot Firestore. */
  private pickIqcFromRows(rows: CachedInventoryRow[], importDatePart4: string | null): string | null {
    if (!rows.length) {
      return null;
    }
    let target: CachedInventoryRow | null = null;

    if (importDatePart4) {
      const { imdKey } = this.parseImdFromQrPart4(importDatePart4);
      const normalizedScanDate = imdKey || this.normalizeImportDate(importDatePart4);
      for (const r of rows) {
        if (r.normImd === normalizedScanDate) {
          target = r;
          break;
        }
      }
    }

    if (!target) {
      for (const r of rows) {
        if (r.available > 0) {
          target = r;
          break;
        }
      }
    }

    if (!target) {
      target = rows[0];
    }

    return target.iqc;
  }

  parseBlockedList(text: string): string[] {
    const raw = String(text ?? '');
    const parts = raw.split(/[\n,;]+/);
    const out: string[] = [];
    for (const p of parts) {
      const t = p.trim();
      if (t) {
        out.push(t);
      }
    }
    return out;
  }

  private normalizeStatus(s: string): string {
    return String(s ?? '')
      .normalize('NFC')
      .trim()
      .toLowerCase();
  }

  /** true nếu giá trị IQC trên tồn khớp một trong các rule (so khớp không phân biệt hoa thường). */
  isIqcBlocked(iqcStatus: string | undefined | null, blockedList: string[]): boolean {
    if (!blockedList.length) {
      return false;
    }
    const inv = this.normalizeStatus(iqcStatus || '');
    if (!inv) {
      return false;
    }
    for (const b of blockedList) {
      if (this.normalizeStatus(b) === inv) {
        return true;
      }
    }
    return false;
  }

  private parseImdFromQrPart4(part4: string | null | undefined): { imdKey: string; bagDelta: number } {
    const p = this.rmBag.parseQrPart4(part4);
    if (p.imdKey) {
      return { imdKey: p.imdKey, bagDelta: p.bagDelta };
    }
    const s = (part4 ?? '').trim();
    return { imdKey: s ? this.normalizeImportDate(s) : '', bagDelta: 0 };
  }

  private normalizeImportDate(importDate: unknown): string {
    if (!importDate) {
      return '';
    }
    if (typeof importDate === 'string' && /^\d{8}$/.test(importDate)) {
      return importDate;
    }
    const anyD = importDate as { toDate?: () => Date };
    if (importDate instanceof Date || (anyD && typeof anyD.toDate === 'function')) {
      const date = anyD.toDate ? anyD.toDate() : (importDate as Date);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}${month}${year}`;
    }
    if (typeof importDate === 'string') {
      const formats = [/^(\d{2})\/(\d{2})\/(\d{4})$/, /^(\d{4})-(\d{2})-(\d{2})$/, /^(\d{2})-(\d{2})-(\d{4})$/];
      for (const format of formats) {
        const match = importDate.match(format);
        if (match) {
          if (format.source.startsWith('^\\(\\d{4}')) {
            return `${match[3]}${match[2]}${match[1]}`;
          }
          return `${match[1]}${match[2]}${match[3]}`;
        }
      }
    }
    return String(importDate);
  }

  /**
   * Lấy IQC Status từ dòng inventory khớp scan (cùng logic chọn dòng như cập nhật exported).
   *
   * Tối ưu tốc độ: cache theo (factory + mã + PO) chỉ cho đường **khớp IMD từ tem** (IQC gắn với lô, không đổi khi exported tăng).
   * Tem thiếu IMD / fallback theo tồn → luôn đọc Firestore (tránh dùng `available` cũ trong cache).
   */
  async getIqcStatusForScan(
    factory: string,
    materialCode: string,
    poNumber: string,
    importDatePart4: string | null
  ): Promise<string | null> {
    const key = this.matPoCacheKey(factory, materialCode, poNumber);
    const now = Date.now();

    const imdFromQr = importDatePart4
      ? this.parseImdFromQrPart4(importDatePart4).imdKey || this.normalizeImportDate(importDatePart4)
      : '';
    const canUseIqcCache = imdFromQr.length > 0;

    if (canUseIqcCache) {
      const cached = this.inventoryByMatPoCache.get(key);
      if (cached && now - cached.ts < this.INVENTORY_QUERY_TTL_MS) {
        const hit = cached.rows.find(r => r.normImd === imdFromQr);
        if (hit) {
          return hit.iqc;
        }
      }
    }

    const snapshot = await this.firestore
      .collection('inventory-materials', ref =>
        ref.where('materialCode', '==', materialCode).where('poNumber', '==', poNumber).where('factory', '==', factory)
      )
      .get()
      .toPromise();

    if (!snapshot || snapshot.empty) {
      this.inventoryByMatPoCache.delete(key);
      return null;
    }

    const rows: CachedInventoryRow[] = snapshot.docs.map(doc => {
      const data = doc.data() as Record<string, unknown>;
      const qty = Number(data['quantity']) || 0;
      const exp = Number(data['exported']) || 0;
      return {
        normImd: this.normalizeImportDate(data['importDate']),
        iqc: this.extractIqcFromData(data),
        available: qty - exp
      };
    });

    this.evictOldestInventoryCacheIfNeeded();
    this.inventoryByMatPoCache.set(key, { ts: now, rows });

    return this.pickIqcFromRows(rows, importDatePart4);
  }

  async shouldBlockOutbound(
    factory: 'ASM1' | 'ASM2',
    ruleEnabled: boolean,
    blockedList: string[],
    materialCode: string,
    poNumber: string,
    importDatePart4: string | null
  ): Promise<{ block: boolean; iqc: string | null }> {
    if (!ruleEnabled || blockedList.length === 0) {
      return { block: false, iqc: null };
    }
    const iqc = await this.getIqcStatusForScan(factory, materialCode, poNumber, importDatePart4);
    if (this.isIqcBlocked(iqc, blockedList)) {
      return { block: true, iqc };
    }
    return { block: false, iqc };
  }
}
