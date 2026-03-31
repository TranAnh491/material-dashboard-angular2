import { Component, OnDestroy, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { RmBagHistoryEventType } from '../../services/rm-bag-history.service';

export interface BagHistoryRow {
  id: string;
  createdAt: Date | null;
  event: RmBagHistoryEventType;
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  totalBags: number;
  exportedBags: number;
  remainingBags: number;
  bagsDelta?: number;
  /** Bịch quét (i/tổng) */
  bagBatch?: string;
  note?: string;
}

/** Một dòng inventory-materials (cùng truy vấn tab Vật tư ASM1 / ASM2) */
export interface BagInventorySummaryRow {
  inventoryDocId: string;
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  bagBatch?: string;
  nhapBags: number;
  xuatBags: number;
  tonKho: number;
}

/** Một dòng bảng tìm: gom 1 dòng / (nhà máy, mã, PO, IMD) */
export interface BagSearchSummaryRow {
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  bagBatch: string;
  nhapBags: number;
  xuatBags: number;
  tonKho: number;
}

@Component({
  selector: 'app-bag-history',
  templateUrl: './bag-history.component.html',
  styleUrls: ['./bag-history.component.scss']
})
export class BagHistoryComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  /** 800 bản ghi mới nhất (luồng realtime). */
  rows: BagHistoryRow[] = [];
  /** Kết quả tìm theo mã (Enter) — thay thế nguồn hiển thị khi khác null. */
  queryResultRows: BagHistoryRow[] | null = null;

  /** Bảng kết quả tìm: tổng hợp 1 dòng / nhà máy + mã + PO + IMD */
  searchSummaryRows: BagSearchSummaryRow[] = [];
  /**
   * Toàn bộ document inventory-materials khớp mã đang tìm (truy vấn .get() mỗi lần Tìm).
   * Không dùng subscription limit 1000/2000 vì dễ thiếu dòng cùng mã nhưng PO/IMD khác.
   */
  private searchInventoryDocs: { id: string; data: Record<string, unknown> }[] = [];
  /** Dòng inventory đã map từ searchInventoryDocs (dùng nội bộ + merge với log) */
  private inventorySummaryRows: BagInventorySummaryRow[] = [];

  isLoading = true;
  isQueryRunning = false;
  searchHint = '';

  /** Mã đã tìm (chuẩn hóa IN HOA); null = chưa tìm, không hiện bảng dữ liệu. */
  lastSearchedMaterialCode: string | null = null;

  factoryFilter: '' | 'ASM1' | 'ASM2' | 'ALL' = 'ALL';
  eventFilter: '' | RmBagHistoryEventType = '';
  search = '';

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.firestore
      .collection('rm-bag-history', ref => ref.orderBy('createdAt', 'desc').limit(800))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        this.rows = actions.map(a =>
          this.toRow(a.payload.doc.id, a.payload.doc.data() as any)
        );
        if (this.queryResultRows !== null) {
          this.applyFilters();
        }
        this.rebuildInventorySummary();
        this.isLoading = false;
      }, () => {
        this.isLoading = false;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private toRow(id: string, d: any): BagHistoryRow {
    const ts = d.createdAt;
    const createdAt =
      ts?.toDate?.() instanceof Date
        ? ts.toDate()
        : ts instanceof Date
          ? ts
          : null;
    return {
      id,
      createdAt,
      event: d.event as RmBagHistoryEventType,
      factory: d.factory || '',
      materialCode: d.materialCode || '',
      poNumber: d.poNumber || '',
      imd: d.imd || '',
      totalBags: Math.floor(Number(d.totalBags ?? 0)),
      exportedBags: Math.floor(Number(d.exportedBags ?? 0)),
      remainingBags: Math.floor(Number(d.remainingBags ?? 0)),
      bagsDelta: d.bagsDelta != null ? Math.floor(Number(d.bagsDelta)) : undefined,
      bagBatch:
        d.bagBatch != null && String(d.bagBatch).trim() !== ''
          ? String(d.bagBatch)
          : undefined,
      note: d.note
    };
  }

  applyFilters(): void {
    if (this.queryResultRows === null) {
      this.searchSummaryRows = [];
      return;
    }
    this.rebuildInventorySummary();
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  onFactoryFilterChange(): void {
    const q = (this.search || '').trim();
    if (q && this.queryResultRows !== null) {
      void this.executeSearch();
    } else {
      this.applyFilters();
    }
  }

  onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.executeSearch();
    }
  }

  /** Enter / nút Tìm: truy vấn Firestore theo mã hàng (và xưởng nếu chọn ASM1/ASM2). */
  async executeSearch(): Promise<void> {
    const code = (this.search || '').trim().toUpperCase();
    if (!code) {
      this.queryResultRows = null;
      this.lastSearchedMaterialCode = null;
      this.searchInventoryDocs = [];
      this.searchHint = '';
      this.applyFilters();
      this.rebuildInventorySummary();
      return;
    }

    this.isQueryRunning = true;
    this.searchHint = 'Đang tìm trong Firebase…';
    this.lastSearchedMaterialCode = code;

    try {
      await this.fetchInventoryDocsForMaterialCode(code);

      const snap = await this.firestore
        .collection('rm-bag-history', ref => {
          let q: firebase.firestore.Query = ref;
          if (this.factoryFilter === 'ASM1' || this.factoryFilter === 'ASM2') {
            q = q.where('factory', '==', this.factoryFilter);
          }
          q = q.where('materialCode', '==', code);
          return q.limit(2000);
        })
        .get()
        .toPromise();

      const list: BagHistoryRow[] = (snap?.docs || []).map(doc =>
        this.toRow(doc.id, doc.data())
      );
      list.sort((a, b) => {
        const ta = a.createdAt?.getTime() ?? 0;
        const tb = b.createdAt?.getTime() ?? 0;
        return tb - ta;
      });

      this.queryResultRows = list;
      const fac =
        this.factoryFilter === 'ASM1' || this.factoryFilter === 'ASM2'
          ? ` tại ${this.factoryFilter}`
          : '';
      const invN = this.searchInventoryDocs.length;
      this.searchHint =
        list.length === 0
          ? `Không có bản ghi rm-bag-history cho mã "${code}"${fac}. (Nếu mới triển khai, dữ liệu chỉ từ lúc bật ghi log.)`
          : `Tìm thấy ${list.length} bản ghi log cho mã "${code}"${fac}.`;
      if (invN > 0) {
        this.searchHint += ` ${invN} dòng kho (inventory-materials) khớp mã.`;
      }
    } catch (e: any) {
      console.error('bag-history search', e);
      this.queryResultRows = null;
      this.lastSearchedMaterialCode = null;
      this.searchInventoryDocs = [];
      this.searchHint =
        'Lỗi truy vấn Firebase. Mở Console để xem chi tiết; có thể cần tạo composite index (factory + materialCode).';
    } finally {
      this.isQueryRunning = false;
      this.applyFilters();
      const n = this.searchSummaryRows.length;
      if (this.queryResultRows !== null && n > 0) {
        this.searchHint += ` ${n} dòng tổng hợp (nhà máy + mã + PO + IMD).`;
      }
    }
  }

  /**
   * Lấy mọi document inventory-materials đúng mã (không giới hạn 1000 dòng mới nhất của tab Vật tư).
   * Hỗ trợ materialCode lưu HOA/thường; PO/IMD giữ nguyên chữ hoa thường để không gộp nhầm.
   */
  private async fetchInventoryDocsForMaterialCode(code: string): Promise<void> {
    const ref = this.firestore.collection('inventory-materials').ref;
    const variants = [...new Set([code, code.toLowerCase()])].filter(Boolean);
    try {
      let snap: firebase.firestore.QuerySnapshot;
      if (this.factoryFilter === 'ASM1' || this.factoryFilter === 'ASM2') {
        if (variants.length === 1) {
          snap = await ref
            .where('factory', '==', this.factoryFilter)
            .where('materialCode', '==', variants[0])
            .get();
        } else {
          snap = await ref
            .where('factory', '==', this.factoryFilter)
            .where('materialCode', 'in', variants)
            .get();
        }
      } else if (variants.length === 1) {
        snap = await ref.where('materialCode', '==', variants[0]).get();
      } else {
        snap = await ref.where('materialCode', 'in', variants).get();
      }
      const byId = new Map<string, { id: string; data: Record<string, unknown> }>();
      for (const doc of snap.docs) {
        byId.set(doc.id, { id: doc.id, data: doc.data() as Record<string, unknown> });
      }
      this.searchInventoryDocs = Array.from(byId.values());
    } catch (e) {
      console.error('bag-history inventory fetch', e);
      this.searchInventoryDocs = [];
    }
  }

  clearMaterialSearch(): void {
    this.search = '';
    this.queryResultRows = null;
    this.lastSearchedMaterialCode = null;
    this.searchInventoryDocs = [];
    this.searchHint = '';
    this.applyFilters();
    this.rebuildInventorySummary();
  }

  /** Luôn ghi IN HOA trong ô mã hàng. */
  onSearchModelChange(value: string): void {
    const u = (value || '').toUpperCase();
    if (u !== this.search) {
      this.search = u;
    }
    this.onFilterChange();
  }

  private rowAggregateKey(factory: string, materialCode: string, poNumber: string, imd: string): string {
    return `${factory}|${(materialCode || '').trim()}|${(poNumber || '').trim()}|${(imd || '').trim()}`;
  }

  /** Nhập / xuất / tồn từ kết quả fetch inventory theo mã (searchInventoryDocs). */
  private rebuildInventorySummary(): void {
    if (this.lastSearchedMaterialCode === null) {
      this.inventorySummaryRows = [];
      this.searchSummaryRows = [];
      return;
    }
    const codeNeedle = this.lastSearchedMaterialCode;
    const rows: BagInventorySummaryRow[] = [];
    for (const { id, data: d } of this.searchInventoryDocs) {
      const factory = String(d['factory'] ?? '');
      const materialCode = String(d['materialCode'] ?? '');
      if (materialCode.trim().toUpperCase() !== codeNeedle) continue;
      const poNumber = String(d['poNumber'] ?? '');
      const imd = String(d['batchNumber'] ?? '');
      const bagBatchRaw = d['bagBatch'];
      const bagBatch =
        bagBatchRaw != null && String(bagBatchRaw).trim() !== ''
          ? String(bagBatchRaw).trim()
          : undefined;
      const total = Math.max(0, Math.floor(Number(d['totalBags'] ?? 0)));
      const xuat = Math.max(0, Math.floor(Number(d['exportedBags'] ?? 0)));
      const tonKho = Math.max(0, total - xuat);
      rows.push({
        inventoryDocId: id,
        factory,
        materialCode,
        poNumber,
        imd,
        bagBatch,
        nhapBags: total,
        xuatBags: xuat,
        tonKho
      });
    }
    rows.sort((a, b) => {
      const mc = (a.materialCode || '').localeCompare(b.materialCode || '');
      if (mc !== 0) return mc;
      const po = (a.poNumber || '').localeCompare(b.poNumber || '');
      if (po !== 0) return po;
      return (a.imd || '').localeCompare(b.imd || '');
    });
    this.inventorySummaryRows = rows;
    this.rebuildSearchSummaryRows();
  }

  /**
   * Một dòng / (nhà máy, mã, PO, IMD). Nhập–xuất–tồn ưu tiên inventory tab Vật tư (ASM1/ASM2), không có thì lấy bản log mới nhất.
   * Lọc Loại: chỉ giữ dòng có ít nhất một log cùng loại trong kết quả (sau lọc xưởng).
   */
  private rebuildSearchSummaryRows(): void {
    if (this.lastSearchedMaterialCode === null || this.queryResultRows === null) {
      this.searchSummaryRows = [];
      return;
    }

    let logs = [...this.queryResultRows];
    if (this.factoryFilter === 'ASM1' || this.factoryFilter === 'ASM2') {
      logs = logs.filter(r => r.factory === this.factoryFilter);
    }

    const keySet = new Set<string>();
    if (this.eventFilter) {
      for (const r of logs) {
        if (r.event === this.eventFilter) {
          keySet.add(this.rowAggregateKey(r.factory, r.materialCode, r.poNumber, r.imd));
        }
      }
    } else {
      for (const r of logs) {
        keySet.add(this.rowAggregateKey(r.factory, r.materialCode, r.poNumber, r.imd));
      }
      for (const inv of this.inventorySummaryRows) {
        keySet.add(this.rowAggregateKey(inv.factory, inv.materialCode, inv.poNumber, inv.imd));
      }
    }

    const logsByTime = [...logs].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
    );
    const latestLogByKey = new Map<string, BagHistoryRow>();
    for (const r of logsByTime) {
      const k = this.rowAggregateKey(r.factory, r.materialCode, r.poNumber, r.imd);
      if (!latestLogByKey.has(k)) {
        latestLogByKey.set(k, r);
      }
    }

    const invByKey = new Map<string, BagInventorySummaryRow>();
    for (const inv of this.inventorySummaryRows) {
      invByKey.set(
        this.rowAggregateKey(inv.factory, inv.materialCode, inv.poNumber, inv.imd),
        inv
      );
    }

    const out: BagSearchSummaryRow[] = [];
    for (const k of keySet) {
      const inv = invByKey.get(k);
      const log = latestLogByKey.get(k);
      if (!inv && !log) {
        continue;
      }
      const factory = inv?.factory ?? log!.factory;
      const materialCode = inv?.materialCode ?? log!.materialCode;
      const poNumber = inv?.poNumber ?? log!.poNumber;
      const imd = inv?.imd ?? log!.imd;
      const nhapBags = inv != null ? inv.nhapBags : Math.max(0, Math.floor(Number(log!.totalBags ?? 0)));
      const xuatBags = inv != null ? inv.xuatBags : Math.max(0, Math.floor(Number(log!.exportedBags ?? 0)));
      const tonKho = inv != null ? inv.tonKho : Math.max(0, Math.floor(Number(log!.remainingBags ?? 0)));
      const bbInv = inv?.bagBatch?.trim();
      const bbLog = log?.bagBatch?.trim();
      const bagBatch = bbInv || bbLog || '';
      out.push({
        factory,
        materialCode,
        poNumber,
        imd,
        bagBatch,
        nhapBags,
        xuatBags,
        tonKho
      });
    }

    out.sort((a, b) => {
      const fc = (a.factory || '').localeCompare(b.factory || '');
      if (fc !== 0) return fc;
      const mc = (a.materialCode || '').localeCompare(b.materialCode || '');
      if (mc !== 0) return mc;
      const po = (a.poNumber || '').localeCompare(b.poNumber || '');
      if (po !== 0) return po;
      return (a.imd || '').localeCompare(b.imd || '');
    });
    this.searchSummaryRows = out;
  }
}
