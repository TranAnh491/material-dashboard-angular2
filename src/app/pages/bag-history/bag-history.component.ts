import { Component, OnDestroy, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { MatSnackBar } from '@angular/material/snack-bar';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject } from 'rxjs';
import { firstValueFrom } from 'rxjs';
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
  /** Hiển thị Bag: `i` hoặc `i(T...)` khi bịch lẻ/tách. */
  bagNumberDisplay?: string;
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

/** Nhóm xuất kho trùng khóa (nhà máy + mã + PO + IMD + bag) từ outbound-materials. */
export interface OutboundDuplicateGroupRow {
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  bagBatch: string;
  /** Khóa nhóm trùng: factory|material|po|imd|bag */
  dupKey: string;
  /** Ngày/giờ xuất mới nhất trong nhóm (ưu tiên exportDate, fallback createdAt/updatedAt). */
  latestExportAtLabel?: string;
  /** Số bản ghi outbound cùng khóa (>1). */
  count: number;
  /** LSX (`productionOrder`) gom từ các lần xuất trùng; nhiều lệnh cách nhau bằng · */
  productionOrderSummary: string;
  /** Dòng này từng bị bỏ qua trước đây, nhưng đã phát sinh thêm (count tăng) nên hiện lại. */
  revivedAfterIgnore?: boolean;
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

  /** Kiểm tra trùng xuất kho (outbound ASM1/ASM2) khi mở tab. */
  outboundDupLoading = true;
  outboundDupError = '';
  outboundDupRows: OutboundDuplicateGroupRow[] = [];
  outboundDupTotalScanned = 0;
  /** Số bản ghi outbound thỏa lọc định dạng (dùng để gom trùng). */
  outboundDupEligibleCount = 0;

  /** Đang gửi mail báo cáo trùng (callable). */
  sendMailBusy = false;

  /** Loại trừ mã khỏi báo cáo trùng (đồng bộ Firestore `control-batch-exclusion/settings`). */
  excludeEnabled = false;
  private excludeMaterialCodesSet = new Set<string>();
  /**
   * Bỏ qua theo từng nhóm trùng (factory|mã|PO|IMD|bag).
   * Value = baseline count đã bỏ qua. Nếu lần sau count <= baseline => ẩn; nếu count tăng => hiện lại.
   */
  private outboundDupIgnoredGroups = new Map<string, number>();

  showControlBatchMoreModal = false;
  controlBatchCatalogOpen = false;
  excludeEnabledDraft = false;
  excludeCatalogDraft = '';
  exclusionSaveBusy = false;

  /** Popup ghi chú hướng dẫn (icon info cạnh tiêu đề). */
  showPageInfoModal = false;

  /** Mốc ngày bắt đầu tính trùng xuất (đồng bộ Firestore `outboundDupSinceDate` YYYY-MM-DD, 00:00 VN). */
  private static readonly DEFAULT_OUTBOUND_DUP_YMD = '2026-04-02';

  /** YYYY-MM-DD đang áp dụng. */
  outboundDupSinceYmd = BagHistoryComponent.DEFAULT_OUTBOUND_DUP_YMD;
  /** DD/MM/YYYY — hiển thị tóm tắt. */
  outboundDupSinceLabel = '02/04/2026';
  private outboundDupSinceMs = Date.parse(
    `${BagHistoryComponent.DEFAULT_OUTBOUND_DUP_YMD}T00:00:00+07:00`
  );
  /** Bản nháp ngày trong popup More (datepicker). */
  outboundDupSinceDraft: Date = new Date(2026, 3, 2);

  factoryFilter: '' | 'ASM1' | 'ASM2' | 'ALL' = 'ALL';
  eventFilter: '' | RmBagHistoryEventType = '';
  search = '';

  constructor(
    private firestore: AngularFirestore,
    private fns: AngularFireFunctions,
    private snackBar: MatSnackBar
  ) {}

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

    this.firestore
      .doc('control-batch-exclusion/settings')
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        data => {
          this.applyControlBatchExclusionDoc(data);
          void this.loadOutboundExportDuplicates();
        },
        err => {
          console.error('control-batch-exclusion subscribe', err);
          this.outboundDupError =
            'Không đọc được cấu hình loại trừ (control-batch-exclusion).';
          this.outboundDupLoading = false;
        }
      );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Số mã đang trong danh sách loại trừ (để hiển thị gợi ý trên bảng). */
  get excludeCodeCount(): number {
    return this.excludeMaterialCodesSet.size;
  }

  openControlBatchMoreModal(): void {
    this.excludeEnabledDraft = this.excludeEnabled;
    this.excludeCatalogDraft = Array.from(this.excludeMaterialCodesSet)
      .sort((a, b) => a.localeCompare(b, 'vi'))
      .join('\n');
    this.outboundDupSinceDraft = this.ymdToLocalDate(this.outboundDupSinceYmd);
    this.controlBatchCatalogOpen = false;
    this.showControlBatchMoreModal = true;
  }

  closeControlBatchMoreModal(): void {
    this.showControlBatchMoreModal = false;
  }

  onControlBatchMoreBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeControlBatchMoreModal();
    }
  }

  openPageInfoModal(): void {
    this.showPageInfoModal = true;
  }

  closePageInfoModal(): void {
    this.showPageInfoModal = false;
  }

  onPageInfoBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closePageInfoModal();
    }
  }

  private applyControlBatchExclusionDoc(data: unknown): void {
    const d = data as {
      excludeEnabled?: unknown;
      excludeMaterialCodes?: unknown;
      outboundDupSinceDate?: unknown;
      outboundDupIgnoredGroups?: unknown;
    } | null | undefined;
    this.excludeEnabled = d?.excludeEnabled === true;
    const arr = Array.isArray(d?.excludeMaterialCodes) ? d.excludeMaterialCodes : [];
    this.excludeMaterialCodesSet = new Set(
      arr.map(x => String(x || '').trim().toUpperCase()).filter(Boolean)
    );
    // load ignored groups (baseline count)
    this.outboundDupIgnoredGroups.clear();
    if (Array.isArray(d?.outboundDupIgnoredGroups)) {
      for (const item of d!.outboundDupIgnoredGroups as any[]) {
        const key = String(item?.key ?? '').trim();
        const n = Number(item?.ignoredCount);
        if (!key) continue;
        if (Number.isFinite(n) && n > 0) this.outboundDupIgnoredGroups.set(key, Math.floor(n));
      }
    }
    this.outboundDupSinceYmd = this.normalizeOutboundDupSinceYmd(d?.outboundDupSinceDate);
    const ms = this.vnYmdStartMs(this.outboundDupSinceYmd);
    this.outboundDupSinceMs =
      ms ??
      Date.parse(`${BagHistoryComponent.DEFAULT_OUTBOUND_DUP_YMD}T00:00:00+07:00`);
    this.outboundDupSinceLabel = this.formatYmdVnDisplay(this.outboundDupSinceYmd);
  }

  private vnYmdStartMs(ymd: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) {
      return null;
    }
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+07:00`);
    return Number.isNaN(t) ? null : t;
  }

  private normalizeOutboundDupSinceYmd(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && this.vnYmdStartMs(s) != null) {
      return s;
    }
    return BagHistoryComponent.DEFAULT_OUTBOUND_DUP_YMD;
  }

  private formatYmdVnDisplay(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) {
      return ymd.trim();
    }
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  private ymdToLocalDate(ymd: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) {
      return new Date(2026, 3, 2);
    }
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  private formatDraftDateToYmd(d: Date): string {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  private parseExcludeCatalogText(text: string): string[] {
    const raw = text
      .split(/[\n,;]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    return Array.from(new Set(raw));
  }

  /**
   * Mục danh mục đúng 4 ký tự (vd. B034) = tiền tố: loại mọi mã bắt đầu bằng chuỗi đó.
   * Độ dài khác = khớp nguyên mã (vd. B036004).
   * Đồng bộ với `isMaterialCodeExcludedByControlBatchRules` trong Functions.
   */
  private isMaterialExcludedFromDupReport(mcNorm: string): boolean {
    const mc = String(mcNorm || '').trim().toUpperCase();
    if (!mc) {
      return false;
    }
    const prefixLen = 4;
    for (const rule of this.excludeMaterialCodesSet) {
      const ex = String(rule || '').trim().toUpperCase();
      if (!ex) {
        continue;
      }
      if (ex.length === prefixLen) {
        if (mc.startsWith(ex)) {
          return true;
        }
      } else if (mc === ex) {
        return true;
      }
    }
    return false;
  }

  async saveControlBatchExclusionSettings(): Promise<void> {
    if (this.exclusionSaveBusy) {
      return;
    }
    this.exclusionSaveBusy = true;
    try {
      const codes = this.parseExcludeCatalogText(this.excludeCatalogDraft);
      const ymd = this.outboundDupSinceDraft
        ? this.formatDraftDateToYmd(this.outboundDupSinceDraft)
        : BagHistoryComponent.DEFAULT_OUTBOUND_DUP_YMD;
      const ymdNorm = this.normalizeOutboundDupSinceYmd(ymd);
      await this.firestore
        .doc('control-batch-exclusion/settings')
        .set(
          {
            excludeEnabled: this.excludeEnabledDraft,
            excludeMaterialCodes: codes,
            outboundDupSinceDate: ymdNorm,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      this.snackBar.open('Đã lưu cài đặt Control Batch.', 'Đóng', { duration: 4500 });
      this.closeControlBatchMoreModal();
    } catch (e) {
      console.error('save control-batch-exclusion', e);
      this.snackBar.open('Lưu thất bại. Kiểm tra quyền Firestore.', 'Đóng', { duration: 6000 });
    } finally {
      this.exclusionSaveBusy = false;
    }
  }

  /** Gửi mail báo cáo trùng xuất kho tại thời điểm bấm (cùng logic quét với bảng trên). */
  async onSendControlBatchMail(): Promise<void> {
    if (this.sendMailBusy) {
      return;
    }
    this.sendMailBusy = true;
    try {
      const callable = this.fns.httpsCallable<
        {
          outboundDupSinceDate: string;
          excludeEnabled: boolean;
          excludeMaterialCodes: string[];
        },
        { ok?: boolean; dupGroups?: number }
      >('sendControlBatchReportEmail');
      const res = await firstValueFrom(
        callable({
          outboundDupSinceDate: this.outboundDupSinceYmd,
          excludeEnabled: this.excludeEnabled,
          excludeMaterialCodes: Array.from(this.excludeMaterialCodesSet).sort((a, b) =>
            a.localeCompare(b, 'vi')
          )
        })
      );
      const n = res?.dupGroups ?? 0;
      this.snackBar.open(
        n === 0
          ? 'Đã gửi mail: không có nhóm trùng tại thời điểm quét.'
          : `Đã gửi mail: ${n} nhóm trùng xuất kho.`,
        'Đóng',
        { duration: 6000 }
      );
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Gửi mail thất bại.';
      this.snackBar.open(msg, 'Đóng', { duration: 8000 });
    } finally {
      this.sendMailBusy = false;
    }
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
      bagNumberDisplay:
        d.bagNumberDisplay != null && String(d.bagNumberDisplay).trim() !== ''
          ? String(d.bagNumberDisplay).trim()
          : undefined,
      note: d.note
    };
  }

  getBagColumnDisplay(row: { bagBatch?: string; bagNumberDisplay?: string }): string {
    const bnd = (row.bagNumberDisplay || '').trim();
    // Nếu có mã bịch lẻ/tách (VD: 1(T1254581)) thì ưu tiên để tránh kiểm tra nhầm.
    if (bnd && (bnd.includes('(') || /t\d+/i.test(bnd))) {
      return bnd;
    }
    const bb = (row.bagBatch || '').trim();
    return bb || '—';
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

    if (!this.isValidRmMaterialCode(code)) {
      this.queryResultRows = null;
      this.lastSearchedMaterialCode = null;
      this.searchInventoryDocs = [];
      this.searchHint =
        'Mã hàng không hợp lệ: phải là A hoặc B ở đầu và đúng 6 chữ số sau (VD: A005006, B001033).';
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

  /**
   * Khóa trùng với tab Xuất kho ASM1/ASM2: mã + PO + IMD (batchNumber/importDate) + bag (bagBatch).
   */
  /** Mã RM: một chữ A hoặc B + đúng 6 số (VD A005006, B001033). */
  isValidRmMaterialCode(code: string): boolean {
    const c = (code || '').trim().toUpperCase();
    return /^[AB]\d{6}$/.test(c);
  }

  /** PO: có chữ, bắt đầu bằng KZ hoặc LH (không phân biệt hoa thường). */
  private isValidOutboundPo(po: string): boolean {
    const p = (po || '').trim();
    if (!p || !/[A-Za-z]/.test(p)) {
      return false;
    }
    const u = p.toUpperCase();
    return u.startsWith('KZ') || u.startsWith('LH');
  }

  private stringHasDigit(s: string): boolean {
    return /\d/.test(String(s || ''));
  }

  /** Chỉ gom trùng khi đủ điều kiện định dạng mã / PO / IMD / bag. */
  private isOutboundRowEligibleForDupAnalysis(
    materialCode: string,
    poNumber: string,
    imd: string,
    bagBatch: string
  ): boolean {
    const mc = (materialCode || '').trim().toUpperCase();
    if (!this.isValidRmMaterialCode(mc)) {
      return false;
    }
    if (!this.isValidOutboundPo(poNumber)) {
      return false;
    }
    if (!this.stringHasDigit(imd)) {
      return false;
    }
    if (!this.stringHasDigit(bagBatch)) {
      return false;
    }
    return true;
  }

  private tryFirestoreTimeToMs(v: unknown): number | null {
    if (v == null) {
      return null;
    }
    if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
      const dt = (v as { toDate: () => Date }).toDate();
      const t = dt.getTime();
      return Number.isNaN(t) ? null : t;
    }
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isNaN(t) ? null : t;
    }
    return null;
  }

  /** Thời điểm xuất / tạo document: ưu tiên exportDate → createdAt → updatedAt. */
  private getOutboundDocTimeMs(d: Record<string, unknown>): number | null {
    return (
      this.tryFirestoreTimeToMs(d['exportDate']) ??
      this.tryFirestoreTimeToMs(d['createdAt']) ??
      this.tryFirestoreTimeToMs(d['updatedAt'])
    );
  }

  private isOutboundDocOnOrAfterDupSince(d: Record<string, unknown>): boolean {
    const t = this.getOutboundDocTimeMs(d);
    if (t == null) {
      return false;
    }
    return t >= this.outboundDupSinceMs;
  }

  private outboundDupCompositeKey(
    factory: string,
    materialCode: string,
    poNumber: string,
    imd: string,
    bagBatch: string
  ): string {
    const fac = (factory || '').trim();
    const mc = (materialCode || '').trim().toUpperCase();
    const po = (poNumber || '').trim();
    const im = (imd || '').trim();
    const bag = (bagBatch || '').trim();
    return `${fac}|${mc}|${po}|${im}|${bag}`;
  }

  isOutboundDupGroupIgnored(row: OutboundDuplicateGroupRow): boolean {
    const baseline = this.outboundDupIgnoredGroups.get(row.dupKey);
    return baseline != null && baseline >= row.count;
  }

  async onToggleIgnoreOutboundDupGroup(row: OutboundDuplicateGroupRow, checked: boolean): Promise<void> {
    const key = String(row?.dupKey || '').trim();
    if (!key) return;
    if (checked) this.outboundDupIgnoredGroups.set(key, Math.max(1, Math.floor(row.count || 1)));
    else this.outboundDupIgnoredGroups.delete(key);

    const payload = Array.from(this.outboundDupIgnoredGroups.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'vi'))
      .map(([k, ignoredCount]) => ({ key: k, ignoredCount }));
    try {
      await this.firestore.doc('control-batch-exclusion/settings').set(
        {
          outboundDupIgnoredGroups: payload,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } catch (e) {
      console.error('save outboundDupIgnoredGroups', e);
      this.snackBar.open('Lưu "Bỏ qua" thất bại. Kiểm tra quyền Firestore.', 'Đóng', { duration: 6000 });
    }
  }

  private async fetchAllOutboundDocsForFactory(
    factory: 'ASM1' | 'ASM2',
    batchSize: number
  ): Promise<firebase.firestore.QueryDocumentSnapshot[]> {
    const ref = this.firestore.collection('outbound-materials').ref;
    const idPath = firebase.firestore.FieldPath.documentId();
    const out: firebase.firestore.QueryDocumentSnapshot[] = [];
    let last: firebase.firestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let q: firebase.firestore.Query = ref
        .where('factory', '==', factory)
        .orderBy(idPath)
        .limit(batchSize);
      if (last) {
        q = q.startAfter(last);
      }
      const snap = await q.get();
      if (snap.empty) {
        break;
      }
      out.push(...snap.docs);
      if (snap.docs.length < batchSize) {
        break;
      }
      last = snap.docs[snap.docs.length - 1];
    }
    return out;
  }

  /** Đọc toàn bộ outbound-materials (ASM1 + ASM2), gom theo mã+PO+IMD+bag; chỉ giữ nhóm count > 1. */
  async loadOutboundExportDuplicates(): Promise<void> {
    this.outboundDupLoading = true;
    this.outboundDupError = '';
    this.outboundDupRows = [];
    this.outboundDupTotalScanned = 0;
    this.outboundDupEligibleCount = 0;
    try {
      const [docs1, docs2] = await Promise.all([
        this.fetchAllOutboundDocsForFactory('ASM1', 500),
        this.fetchAllOutboundDocsForFactory('ASM2', 500)
      ]);
      const all = [...docs1, ...docs2];
      this.outboundDupTotalScanned = 0;
      const counts = new Map<
        string,
        {
          count: number;
          sample: Omit<
            OutboundDuplicateGroupRow,
            'count' | 'productionOrderSummary' | 'dupKey' | 'revivedAfterIgnore'
          >;
          lsx: Set<string>;
          latestMs: number;
        }
      >();
      for (const doc of all) {
        const d = doc.data() as Record<string, unknown>;
        if (!this.isOutboundDocOnOrAfterDupSince(d)) {
          continue;
        }
        this.outboundDupTotalScanned += 1;
        const factory = String(d['factory'] ?? '');
        const materialCode = String(d['materialCode'] ?? '');
        const poNumber = String(d['poNumber'] ?? '');
        const imdRaw = d['batchNumber'] ?? d['importDate'];
        const imd = imdRaw != null ? String(imdRaw) : '';
        const bagRaw = d['bagBatch'];
        const bagBatch = bagRaw != null ? String(bagRaw) : '';
        if (!this.isOutboundRowEligibleForDupAnalysis(materialCode, poNumber, imd, bagBatch)) {
          continue;
        }
        const mcNorm = materialCode.trim().toUpperCase();
        if (this.excludeEnabled && this.isMaterialExcludedFromDupReport(mcNorm)) {
          continue;
        }
        this.outboundDupEligibleCount += 1;
        const key = this.outboundDupCompositeKey(factory, materialCode, poNumber, imd, bagBatch);
        const tMs = this.getOutboundDocTimeMs(d) ?? 0;
        const lsxVal = d['productionOrder'];
        const lsxStr = lsxVal != null ? String(lsxVal).trim() : '';
        const prev = counts.get(key);
        if (prev) {
          prev.count += 1;
          if (tMs > prev.latestMs) prev.latestMs = tMs;
          if (lsxStr) {
            prev.lsx.add(lsxStr);
          }
        } else {
          const lsx = new Set<string>();
          if (lsxStr) {
            lsx.add(lsxStr);
          }
          counts.set(key, {
            count: 1,
            sample: {
              factory: factory.trim(),
              materialCode: materialCode.trim(),
              poNumber: poNumber.trim(),
              imd: imd.trim(),
              bagBatch: bagBatch.trim()
            },
            lsx
            ,
            latestMs: tMs
          });
        }
      }
      const dupes: OutboundDuplicateGroupRow[] = [];
      const fmtVn = (ms: number): string => {
        if (!ms) return '';
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
      };
      for (const { count, sample, lsx, latestMs } of counts.values()) {
        if (count > 1) {
          const lsxList = Array.from(lsx).sort((a, b) => a.localeCompare(b, 'vi'));
          const productionOrderSummary =
            lsxList.length > 0 ? lsxList.join(' · ') : '—';
          const dupKey = this.outboundDupCompositeKey(
            sample.factory,
            sample.materialCode,
            sample.poNumber,
            sample.imd,
            sample.bagBatch
          );
          const ignoredBaseline = this.outboundDupIgnoredGroups.get(dupKey);
          if (ignoredBaseline != null && ignoredBaseline >= count) {
            continue; // bỏ qua khi dò nếu chưa phát sinh thêm lần xuất
          }
          const revivedAfterIgnore =
            ignoredBaseline != null && ignoredBaseline < count ? true : undefined;
          dupes.push({
            ...sample,
            dupKey,
            latestExportAtLabel: fmtVn(latestMs) || undefined,
            count,
            productionOrderSummary,
            revivedAfterIgnore
          });
        }
      }
      dupes.sort((a, b) => {
        const fc = (a.factory || '').localeCompare(b.factory || '');
        if (fc !== 0) return fc;
        const mc = (a.materialCode || '').localeCompare(b.materialCode || '');
        if (mc !== 0) return mc;
        const po = (a.poNumber || '').localeCompare(b.poNumber || '');
        if (po !== 0) return po;
        const im = (a.imd || '').localeCompare(b.imd || '');
        if (im !== 0) return im;
        return (a.bagBatch || '').localeCompare(b.bagBatch || '');
      });
      this.outboundDupRows = dupes;

      // Push alert to Firestore so backend can notify specific members on new duplicates.
      // Backend will deduplicate and only notify on newly appeared / increased counts.
      if (dupes.length > 0) {
        try {
          await this.firestore.collection('zalo_alerts').add({
            type: 'outbound_duplicate_detected',
            source: 'bag-history',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            dupes: dupes.slice(0, 50).map(d => ({
              dupKey: d.dupKey,
              factory: d.factory,
              materialCode: d.materialCode,
              poNumber: d.poNumber,
              imd: d.imd,
              bagBatch: d.bagBatch,
              count: d.count,
              latestExportAtLabel: d.latestExportAtLabel || null,
              revivedAfterIgnore: d.revivedAfterIgnore || null
            }))
          });
        } catch (e) {
          console.warn('bag-history write zalo_alerts failed', e);
        }
      }
    } catch (e) {
      console.error('bag-history outbound duplicate scan', e);
      this.outboundDupError =
        'Không đọc được outbound-materials (kiểm tra quyền Firebase / index factory + documentId).';
    } finally {
      this.outboundDupLoading = false;
    }
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
