import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';

export interface TraceabilitySummary {
  itemCode: string;
  itemName: string;
  /** IMD / mã lô tồn kho */
  batchLabel: string;
  /** Lô hàng nhập kho (inbound-materials.batchNumber) */
  shipmentBatchLabel: string;
  poNumber: string;
  stockDisplay: string;
  location: string;
  statusLabel: string;
  statusVariant: 'success' | 'warning' | 'danger' | 'info';
}

export interface TraceabilityQcNode {
  inspector: string;
  timestamp: Date | null;
  scannedLabel: string;
  conditionLabel: string;
  conditionVariant: 'success' | 'warning' | 'danger' | 'info';
}

export interface TraceabilityIssue {
  workOrder: string;
  qtyLabel: string;
  exportQty: number;
  timestamp: Date | null;
  performedBy: string;
}

export interface TracePoImdOption {
  factory: string;
  poNumber: string;
  imdKey: string;
  batchNumber: string;
  inventoryId: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  location: string;
  label: string;
  shipmentBatchLabel?: string;
  /** Dòng tra cứu (tồn kho hoặc suy ra từ outbound khi không còn tồn). */
  sourceRow?: InventoryRow;
}

type ParsedScanInput =
  | { type: 'qr'; material: string; po: string; imd: string }
  | { type: 'batch'; batch: string }
  | { type: 'material'; material: string };

type TraceIssueRowTone = 'done' | 'progress' | 'pending';

type TraceIssueRow = {
  workOrder: string;
  exportQtyLabel: string;
  exportDateLabel: string;
  factoryLineLabel: string;
  issuerLabel: string;
  statusLabel: string;
  statusTone: TraceIssueRowTone;
  remainAfterLabel: string;
};

type TraceabilityTreeLeaf = {
  workOrder: string;
  qtyLabel: string;
  timestamp: Date | null;
};

type TraceabilityTreeRoot = {
  title: string;
  subTitle: string;
  issuedCount: number;
  leaves: TraceabilityTreeLeaf[];
};

export type TraceFlowBadgeVariant = 'done' | 'pending' | 'neutral';

export interface TraceFlowTimelineEvent {
  at: Date | null;
  performedBy: string;
  label: string;
  detail: string;
}

export interface TraceFlowStage {
  title: string;
  caption: string;
  icon: string;
  badgeLabel: string;
  badgeVariant: TraceFlowBadgeVariant;
  rows: { label: string; value: string }[];
  subTitle: string;
  subLines: { label: string; value: string }[];
  at: Date | null;
  performedBy: string;
  timelineEvents: TraceFlowTimelineEvent[];
}

export interface TraceQuickStat {
  label: string;
  valueLabel: string;
  pct: number;
}

/** Giai đoạn luồng hiển thị khi chưa tra cứu (mock landing). */
export type TraceIdleStageTone = 'inbound' | 'iqc' | 'storage' | 'outbound';

interface IdleFlowStageTemplate {
  step: number;
  title: string;
  captionEn: string;
  sub: string;
  tone: TraceIdleStageTone;
  icon: string;
  /** Các trường hiển thị trong panel chi tiết (empty state). */
  panelFields: ReadonlyArray<{ label: string }>;
}

interface InventoryRow {
  id: string;
  factory: string;
  supplierName?: string;
  materialCode: string;
  materialName: string;
  poNumber: string;
  batchNumber: string;
  quantity: number;
  unit: string;
  rollsOrBags: string;
  location: string;
  iqcStatus?: string;
  qcCheckedBy?: string;
  qcCheckedAt?: Date | null;
  importDate?: unknown;
  stock?: number;
  exported?: number;
  /** Thời điểm đổi vị trí gần nhất (từ inventory-materials.lastModified) */
  lastModified?: Date | null;
  /** Loại thao tác đổi vị trí (từ inventory-materials.modifiedBy) */
  modifiedBy?: string;
  /** ID người scan đổi vị trí (từ material-location-history.changedBy) */
  locationChangedBy?: string;
  /** Thời điểm scan đổi vị trí (từ material-location-history.changedAt) */
  locationChangedAt?: Date | null;
}

@Component({
  selector: 'app-qc-traceability',
  templateUrl: './qc-traceability.component.html',
  styleUrls: ['./qc-traceability.component.scss']
})
export class QcTraceabilityComponent implements AfterViewInit {
  @ViewChild('traceScanInput') traceScanInput?: ElementRef<HTMLInputElement>;

  /** Hiển thị sau tra cứu thành công / cleared khi refresh */
  lastUpdatedText = '—';

  readonly idleFlowStages: ReadonlyArray<IdleFlowStageTemplate> = [
    {
      step: 1,
      title: 'Nhập kho',
      captionEn: 'INBOUND',
      sub: 'Tiếp nhận nguyên vật liệu',
      tone: 'inbound',
      icon: 'inventory_2',
      panelFields: [
        { label: 'Lô nhập' },
        { label: 'Nhà cung cấp' },
        { label: 'Ngày nhập' },
        { label: 'Số lượng' }
      ]
    },
    {
      step: 2,
      title: 'Kiểm hàng',
      captionEn: 'IQC',
      sub: 'Kiểm tra chất lượng đầu vào',
      tone: 'iqc',
      icon: 'verified_user',
      panelFields: [
        { label: 'Phương pháp kiểm' },
        { label: 'Kết quả' },
        { label: 'Số đã scan' },
        { label: 'Nhân viên kiểm' }
      ]
    },
    {
      step: 3,
      title: 'Lưu kho',
      captionEn: 'STORAGE',
      sub: 'Lưu trữ và quản lý kho',
      tone: 'storage',
      icon: 'local_shipping',
      panelFields: [
        { label: 'Vị trí lưu trữ' },
        { label: 'Khu vực' },
        { label: 'Ngày lưu' },
        { label: 'Số lượng' }
      ]
    },
    {
      step: 4,
      title: 'Xuất sản xuất',
      captionEn: 'PRODUCTION',
      sub: 'Xuất nguyên vật liệu cho sản xuất',
      tone: 'outbound',
      icon: 'precision_manufacturing',
      panelFields: [
        { label: 'Kế hoạch / WO' },
        { label: 'Ngày dự kiến' },
        { label: 'BOM liên quan' },
        { label: 'Số lượng xuất' }
      ]
    }
  ];

  readonly idleStatusOverview: ReadonlyArray<{ label: string; tone: 'done' | 'progress' | 'pending' | 'error'; value: string }> = [
    { label: 'Hoàn thành', tone: 'done', value: '0' },
    { label: 'Đang xử lý', tone: 'progress', value: '0' },
    { label: 'Chờ xử lý', tone: 'pending', value: '0' },
    { label: 'Lỗi', tone: 'error', value: '0' }
  ];

  readonly idleUsageTips: ReadonlyArray<string> = [
    'Nhập mã lô, PO, Material hoặc mã hàng vào ô tìm kiếm rồi nhấn Enter.',
    'Dùng nút Quét QR / Mã vạch khi có máy quét hoặc camera (tùy thiết bị).',
    'Sau khi tra cứu, dữ liệu hiển thị theo từng công đoạn Nhập → IQC → Lưu kho → Xuất.'
  ];

  scanCode = '';
  isLoading = false;
  errorMessage = '';
  showPoImdPicker = false;
  poImdCandidates: TracePoImdOption[] = [];
  pendingLookupMaterial = '';
  summary: TraceabilitySummary | null = null;
  qcNode: TraceabilityQcNode | null = null;
  issues: TraceabilityIssue[] = [];
  /** Snapshot inventory sau tra cứu — dùng layout luồng 4 bước */
  lastInventory: InventoryRow | null = null;
  flowStages: TraceFlowStage[] = [];
  overviewRows: { label: string; value: string }[] = [];
  quickStats: TraceQuickStat[] = [];

  treeZoomPct = 100;
  treeRoot: TraceabilityTreeRoot | null = null;

  constructor(private firestore: AngularFirestore, private router: Router) {}

  /** Hiển thị số lượng — không kèm đơn vị (KG, PCS, …). */
  private formatQtyOnly(value: number | null | undefined, empty = '—'): string {
    const n = Number(value);
    if (value == null || Number.isNaN(n)) return empty;
    return String(n);
  }

  /** KPI hàng trên — giá trị mặc định khi chưa search giống mock */
  get kpiStockDisplay(): string {
    return this.summary?.stockDisplay ?? '0';
  }

  get kpiLocationDisplay(): string {
    return this.summary?.location ?? '—';
  }

  get kpiStatusDisplay(): string {
    return this.summary?.statusLabel ?? '—';
  }

  get kpiTraceStepsDisplay(): string {
    return this.summary ? '4 công đoạn' : '0 công đoạn';
  }

  get kpiTotalExportDisplay(): string {
    if (!this.summary || !this.lastInventory) {
      return '0';
    }
    const total = this.totalExportedQty(this.issues);
    return this.formatQtyOnly(total, '0');
  }

  get kpiRemainAfterExportDisplay(): string {
    return this.summary?.stockDisplay ?? '0';
  }

  get issueRows(): TraceIssueRow[] {
    if (!this.summary || !this.lastInventory) {
      return [];
    }

    const q0 = Number(this.lastInventory.quantity) || 0;

    const asc = [...(this.issues || [])].sort((a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0));
    let cum = 0;
    const withRemain = asc.map(i => {
      const exp = Math.max(0, Number(i.exportQty) || 0);
      cum += exp;
      const remain = Math.max(0, q0 - cum);
      return { issue: i, remain };
    });

    return withRemain
      .sort((a, b) => (b.issue.timestamp?.getTime() || 0) - (a.issue.timestamp?.getTime() || 0))
      .map(({ issue, remain }) => {
        const exp = Math.max(0, Number(issue.exportQty) || 0);
        const statusTone: TraceIssueRowTone = remain <= 0 ? 'done' : exp > 0 ? 'progress' : 'pending';
        const statusLabel = remain <= 0 ? 'Hoàn thành' : exp > 0 ? 'Đang xử lý' : 'Chờ xuất';
        return {
          workOrder: issue.workOrder || '—',
          exportQtyLabel: exp > 0 ? this.formatQtyOnly(exp) : '—',
          exportDateLabel: issue.timestamp ? this.formatDateShortVi(issue.timestamp) : '—',
          factoryLineLabel: (this.lastInventory?.factory || '—').toString(),
          issuerLabel: (issue.performedBy || this.qcNode?.inspector || '—').toString(),
          statusLabel,
          statusTone,
          remainAfterLabel: this.formatQtyOnly(remain, '0')
        };
      });
  }

  ngAfterViewInit(): void {
    this.focusScanField();
  }

  onScanInput(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    const upper = (el?.value ?? '').toUpperCase();
    this.scanCode = upper;
    if (el && el.value !== upper) {
      el.value = upper;
    }
  }

  onScanEnter(): void {
    void this.runLookup();
  }

  focusScanField(): void {
    setTimeout(() => this.traceScanInput?.nativeElement?.focus(), 0);
  }

  goToMenu(): void {
    void this.router.navigateByUrl('/menu');
  }

  /** Giống mock: làm mới = xóa kết quả và focus lại ô quét */
  refreshView(): void {
    this.clearView();
    this.focusScanField();
  }

  private touchUpdatedAt(): void {
    const d = new Date();
    this.lastUpdatedText = d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  clearView(): void {
    this.summary = null;
    this.qcNode = null;
    this.issues = [];
    this.errorMessage = '';
    this.treeRoot = null;
    this.lastInventory = null;
    this.flowStages = [];
    this.overviewRows = [];
    this.quickStats = [];
    this.lastUpdatedText = '—';
    this.showPoImdPicker = false;
    this.poImdCandidates = [];
    this.pendingLookupMaterial = '';
  }

  formatFlowDate(d: Date | null | undefined): string {
    return this.formatDateShortVi(d ?? null);
  }

  async selectPoImdAndTrace(opt: TracePoImdOption): Promise<void> {
    this.showPoImdPicker = false;
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const inv =
        (opt.inventoryId ? await this.loadInventoryById(opt.inventoryId, opt.factory) : null) ||
        opt.sourceRow ||
        (await this.queryByMaterialPoImd(opt.materialCode, opt.poNumber, opt.imdKey)) ||
        (await this.queryOutboundByMaterialPoImd(opt.materialCode, opt.poNumber, opt.imdKey, opt.factory));
      if (!inv) {
        this.errorMessage = 'Không tải được dữ liệu lô đã chọn. Thử lại.';
        return;
      }
      await this.applyInventoryTrace(inv);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errorMessage = `Lỗi tải dữ liệu: ${msg}`;
    } finally {
      this.isLoading = false;
      this.focusScanField();
    }
  }

  private formatPerformerId(raw: string): string {
    const s = String(raw || '').trim();
    if (!s) return '—';
    const upper = s.toUpperCase();
    const asp = upper.match(/ASP\d{4}/);
    if (asp) return asp[0];
    if (upper.length > 7 && upper.startsWith('ASP')) return upper.substring(0, 7);
    return s.length > 28 ? s.substring(0, 28) : s;
  }

  private parseScanInput(raw: string): ParsedScanInput | null {
    const t = raw.trim();
    if (!t) return null;
    if (t.includes('|')) {
      const parts = t.split('|').map(p => p.trim());
      if (parts.length >= 4) {
        return { type: 'qr', material: parts[0].toUpperCase(), po: parts[1].toUpperCase(), imd: parts[3] };
      }
    }
    if (/^\d{8}(-\d+\/\d+)?$/i.test(t)) {
      return { type: 'batch', batch: t };
    }
    return { type: 'material', material: t.toUpperCase() };
  }

  private buildPoImdOptions(rows: InventoryRow[]): TracePoImdOption[] {
    const map = new Map<string, TracePoImdOption>();
    for (const r of rows) {
      const imd = this.inventoryImdKey(r) || (r.batchNumber || '').trim() || '—';
      const po = (r.poNumber || '').trim() || '—';
      const key = `${r.factory}|${r.materialCode}|${po}|${imd}`;
      if (map.has(key)) continue;
      map.set(key, {
        factory: r.factory,
        poNumber: po,
        imdKey: imd,
        batchNumber: r.batchNumber || imd,
        inventoryId: r.id,
        materialCode: r.materialCode,
        materialName: r.materialName || '—',
        quantity: r.quantity,
        unit: (r.unit || '').trim() || 'PCS',
        location: r.location || '—',
        label: `PO: ${po} · IMD: ${imd}`,
        shipmentBatchLabel: '',
        sourceRow: r
      });
    }
    return [...map.values()].sort(
      (a, b) => a.poNumber.localeCompare(b.poNumber, 'vi') || a.imdKey.localeCompare(b.imdKey, 'vi')
    );
  }

  private materialPoImdKey(row: InventoryRow): string {
    const imd = this.inventoryImdKey(row) || (row.batchNumber || '').trim() || '—';
    const po = (row.poNumber || '').trim() || '—';
    return `${row.factory}|${row.materialCode}|${po}|${imd}`;
  }

  private async queryInventoryByMaterialCode(code: string): Promise<InventoryRow[]> {
    const c = code.trim().toUpperCase();
    const rows: InventoryRow[] = [];
    for (const factory of ['ASM1', 'ASM2']) {
      const snap = await this.firestore
        .collection('inventory-materials', ref => ref.where('factory', '==', factory).where('materialCode', '==', c).limit(80))
        .get()
        .toPromise();
      if (!snap || snap.empty) continue;
      snap.forEach(doc => rows.push(this.mapDoc(doc.id, doc.data() as Record<string, unknown>, factory)));
    }
    return rows;
  }

  private mapOutboundDocToInventoryRow(docId: string, data: Record<string, unknown>, factory: string): InventoryRow {
    const imdKey = this.normalizeOutboundImdKey(data) || this.coerceText(data.batchNumber);
    const batchNumber = this.coerceText(data.batchNumber) || imdKey;
    const exportQty = Number(data.exportQuantity) || 0;
    const qty = Number(data.quantity) || exportQty;

    return {
      id: '',
      factory: this.coerceText(data.factory) || factory,
      materialCode: this.coerceText(data.materialCode),
      materialName: this.coerceText(data.materialName) || this.coerceText(data.materialCode),
      poNumber: this.coerceText(data.poNumber),
      batchNumber,
      quantity: qty,
      unit: this.coerceText(data.unit) || 'PCS',
      rollsOrBags: '',
      location: this.coerceText(data.location) || '—',
      iqcStatus: '',
      qcCheckedBy: '',
      qcCheckedAt: null,
      importDate: data.importDate ?? data.batchNumber,
      stock: 0,
      exported: exportQty,
      lastModified:
        this.parseFirestoreDate(data.updatedAt) ||
        this.parseFirestoreDate(data.exportDate) ||
        this.parseFirestoreDate(data.createdAt),
      modifiedBy: this.coerceText(data.exportedBy) || this.coerceText(data.employeeId)
    };
  }

  /** Tra cứu outbound-asm1 / outbound-asm2 (collection outbound-materials). */
  private async queryOutboundByMaterialCode(code: string): Promise<InventoryRow[]> {
    const c = code.trim().toUpperCase();
    const rowMap = new Map<string, InventoryRow>();

    for (const factory of ['ASM1', 'ASM2']) {
      const snap = await this.firestore
        .collection('outbound-materials', ref => ref.where('factory', '==', factory).where('materialCode', '==', c).limit(200))
        .get()
        .toPromise();
      if (!snap || snap.empty) continue;

      snap.forEach(doc => {
        const row = this.mapOutboundDocToInventoryRow(doc.id, doc.data() as Record<string, unknown>, factory);
        const key = this.materialPoImdKey(row);
        const existing = rowMap.get(key);
        const newTime = row.lastModified?.getTime() || 0;
        const oldTime = existing?.lastModified?.getTime() || 0;
        if (!existing || newTime >= oldTime) {
          rowMap.set(key, row);
        }
      });
    }

    return [...rowMap.values()];
  }

  private async queryOutboundByMaterialPoImd(
    materialCode: string,
    poNumber: string,
    scannedImd: string,
    preferredFactory?: string
  ): Promise<InventoryRow | null> {
    const factories = [preferredFactory, 'ASM1', 'ASM2'].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);

    for (const factory of factories) {
      const snap = await this.firestore
        .collection('outbound-materials', ref =>
          ref.where('factory', '==', factory).where('materialCode', '==', materialCode).where('poNumber', '==', poNumber).limit(40)
        )
        .get()
        .toPromise();

      if (!snap || snap.empty) continue;

      let found: InventoryRow | null = null;
      snap.forEach(doc => {
        if (found) return;
        const row = this.mapOutboundDocToInventoryRow(doc.id, doc.data() as Record<string, unknown>, factory);
        const materialImd = this.inventoryImdKey(row) || row.batchNumber;
        const imdMatch =
          materialImd === scannedImd ||
          materialImd.startsWith(scannedImd) ||
          scannedImd.startsWith(materialImd);
        if (imdMatch) {
          found = row;
        }
      });

      if (found) return found;
    }

    return null;
  }

  private async queryAllByMaterialCode(code: string): Promise<InventoryRow[]> {
    const [inventoryRows, outboundRows] = await Promise.all([
      this.queryInventoryByMaterialCode(code),
      this.queryOutboundByMaterialCode(code)
    ]);

    const map = new Map<string, InventoryRow>();
    for (const row of outboundRows) {
      map.set(this.materialPoImdKey(row), row);
    }
    for (const row of inventoryRows) {
      map.set(this.materialPoImdKey(row), row);
    }
    return [...map.values()];
  }

  private async loadInventoryById(id: string, factory: string): Promise<InventoryRow | null> {
    if (!id) return null;
    try {
      const doc = await this.firestore.collection('inventory-materials').doc(id).get().toPromise();
      if (!doc?.exists) return null;
      return this.mapDoc(doc.id, doc.data() as Record<string, unknown>, factory);
    } catch {
      return null;
    }
  }

  /** Gán summary / KPI ngay khi có dòng tồn kho — không chờ tải lịch sử. */
  private setTraceSummaryFromInventory(inv: InventoryRow): void {
    const status = this.mapOverallStatus(inv.iqcStatus || '');
    const cond = this.mapConditionBadge(inv.iqcStatus || '');
    const qcTime = inv.qcCheckedAt || this.parseFirestoreDate(inv.importDate as unknown);

    this.lastInventory = inv;
    this.summary = {
      itemCode: inv.materialCode,
      itemName: inv.materialName || '—',
      batchLabel: inv.batchNumber || this.inventoryImdKey(inv) || '—',
      shipmentBatchLabel: '',
      poNumber: inv.poNumber || '—',
      stockDisplay: this.stockDisplay(inv),
      location: inv.location || '—',
      statusLabel: status.label,
      statusVariant: status.variant
    };

    this.qcNode = {
      inspector: this.formatPerformerId(inv.qcCheckedBy || ''),
      timestamp: qcTime,
      scannedLabel: this.buildScannedRollsLabel(inv),
      conditionLabel: cond.label,
      conditionVariant: cond.variant
    };
  }

  private async applyInventoryTrace(inv: InventoryRow): Promise<void> {
    this.setTraceSummaryFromInventory(inv);

    const [issues, shipmentBatch] = await Promise.all([
      this.loadOutboundIssues(inv),
      Promise.all([this.loadInboundShipmentBatch(inv), this.loadLatestLocationChange(inv)]).then(([batch]) => batch)
    ]);

    if (shipmentBatch && this.summary) {
      this.summary = { ...this.summary, shipmentBatchLabel: shipmentBatch };
    }

    this.issues = issues;
    this.treeRoot = this.buildIssuedTree(this.summary!, this.issues);
    this.rebuildDashboard(inv, this.summary!, this.qcNode!, this.issues);
    this.touchUpdatedAt();
  }

  zoomTree(deltaPct: number): void {
    const next = Math.max(50, Math.min(160, (this.treeZoomPct || 100) + deltaPct));
    this.treeZoomPct = next;
  }

  resetTreeZoom(): void {
    this.treeZoomPct = 100;
  }

  private buildIssuedTree(summary: TraceabilitySummary, issues: TraceabilityIssue[]): TraceabilityTreeRoot {
    const leaves: TraceabilityTreeLeaf[] = (issues || []).map(i => ({
      workOrder: i.workOrder || '—',
      qtyLabel: i.qtyLabel || '—',
      timestamp: i.timestamp ?? null
    }));
    return {
      title: summary.itemCode || '—',
      subTitle: summary.shipmentBatchLabel
        ? `Lô hàng: ${summary.shipmentBatchLabel} · IMD: ${summary.batchLabel || '—'} · PO: ${summary.poNumber || '—'}`
        : `IMD: ${summary.batchLabel || '—'} · PO: ${summary.poNumber || '—'}`,
      issuedCount: leaves.length,
      leaves
    };
  }

  private formatDateShortVi(d: Date | null): string {
    if (!d) {
      return '—';
    }
    return d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private qtyOriginal(inv: InventoryRow): string {
    const q = inv.quantity;
    return q > 0 ? this.formatQtyOnly(q) : '—';
  }

  private totalExportedQty(issues: TraceabilityIssue[]): number {
    let s = 0;
    for (const i of issues || []) {
      const n = Number(i.exportQty);
      if (!Number.isNaN(n) && n > 0) {
        s += n;
      }
    }
    return s;
  }

  private rebuildDashboard(inv: InventoryRow, summary: TraceabilitySummary, qc: TraceabilityQcNode, issues: TraceabilityIssue[]): void {
    const impD = this.parseFirestoreDate(inv.importDate as unknown);
    const qcDone =
      !!inv.qcCheckedAt ||
      ['PASS', 'PASSED', 'NG', 'LOCK', 'DAMAGED', 'HOLD', 'CHỜ XÁC NHẬN'].includes((inv.iqcStatus || '').trim().toUpperCase());
    const iqcU = (inv.iqcStatus || '').trim().toUpperCase();
    const stored = !!(inv.location && inv.location !== '—');
    const exportedTotal = this.totalExportedQty(issues);
    const q0 = inv.quantity || 0;
    const stockNum =
      inv.stock != null && !Number.isNaN(inv.stock)
        ? inv.stock
        : Math.max(0, q0 - (inv.exported != null ? inv.exported : exportedTotal));

    const outboundDone = q0 > 0 ? exportedTotal >= q0 : issues.length > 0;
    const latestExport = issues.length ? issues.reduce((a, b) => ((b.timestamp?.getTime() || 0) > (a.timestamp?.getTime() || 0) ? b : a)) : null;

    const woSummary =
      issues.length === 0 ? '—' : issues.length <= 2 ? issues.map(i => i.workOrder).join(', ') : `${issues.length} LSX`;

    const storageAt = inv.locationChangedAt || inv.lastModified || inv.qcCheckedAt || impD;
    const storageBy = this.formatPerformerId(inv.locationChangedBy || inv.modifiedBy || '');
    const inboundBy = this.formatPerformerId(inv.modifiedBy || '');

    const exportTimelineAsc = [...issues]
      .filter(i => i.timestamp || i.exportQty > 0)
      .sort((a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0))
      .map(i => ({
        at: i.timestamp,
        performedBy: this.formatPerformerId(i.performedBy),
        label: i.workOrder || 'Xuất kho',
        detail: i.qtyLabel || '—'
      }));

    const latestExportBy = latestExport ? this.formatPerformerId(latestExport.performedBy) : '—';

    this.flowStages = [
      {
        title: 'NHẬP KHO',
        caption: 'INBOUND',
        icon: 'inventory_2',
        badgeLabel: 'Hoàn thành',
        badgeVariant: 'done',
        at: impD,
        performedBy: inboundBy,
        timelineEvents: [
          {
            at: impD,
            performedBy: inboundBy,
            label: 'Tiếp nhận nguyên vật liệu',
            detail: this.qtyOriginal(inv)
          }
        ],
        rows: [
          { label: 'Nhà cung cấp', value: (inv.supplierName || '').trim() || (inv.poNumber ? `Theo PO ${inv.poNumber}` : '—') },
          { label: 'Ngày nhập', value: this.formatDateShortVi(impD) },
          { label: 'ID thực hiện', value: inboundBy },
          { label: 'Số lượng', value: this.qtyOriginal(inv) }
        ],
        subTitle: 'LÔ NHẬP',
        subLines: [
          { label: 'Lô hàng', value: summary.shipmentBatchLabel || '—' },
          { label: 'IMD', value: inv.batchNumber || this.inventoryImdKey(inv) || '—' }
        ]
      },
      {
        title: 'KIỂM HÀNG',
        caption: 'IQC',
        icon: 'verified_user',
        badgeLabel: qcDone ? 'Hoàn thành' : 'Chờ xử lý',
        badgeVariant: qcDone ? 'done' : 'pending',
        at: qc.timestamp,
        performedBy: qc.inspector || '—',
        timelineEvents: [
          {
            at: qc.timestamp,
            performedBy: qc.inspector || '—',
            label: 'Kiểm tra chất lượng',
            detail: qc.conditionLabel || '—'
          }
        ],
        rows: [
          { label: 'Nhân viên', value: qc.inspector || '—' },
          { label: 'Ngày giờ', value: this.formatDateShortVi(qc.timestamp) },
          { label: 'ID thực hiện', value: qc.inspector || '—' },
          { label: 'Kết quả', value: qc.conditionLabel || '—' },
          { label: 'Số đã scan', value: (qc.scannedLabel || '').replace(/^Scanned:\s*/i, '') || '—' }
        ],
        subTitle: 'PHƯƠNG PHÁP',
        subLines: [{ label: 'IQC status', value: inv.iqcStatus || '—' }]
      },
      {
        title: 'LƯU KHO',
        caption: 'STORAGE',
        icon: 'local_shipping',
        badgeLabel: stored ? 'Hoàn thành' : 'Chờ xử lý',
        badgeVariant: stored ? 'done' : 'pending',
        at: storageAt,
        performedBy: storageBy,
        timelineEvents: [
          {
            at: storageAt,
            performedBy: storageBy,
            label: 'Lưu trữ / đổi vị trí',
            detail: inv.location || '—'
          }
        ],
        rows: [
          { label: 'Vị trí', value: inv.location || '—' },
          { label: 'Ngày lưu', value: this.formatDateShortVi(storageAt) },
          { label: 'ID thực hiện', value: storageBy },
          { label: 'SL hiện tại', value: summary.stockDisplay }
        ],
        subTitle: 'KHO',
        subLines: [{ label: 'Xưởng', value: inv.factory || '—' }]
      },
      {
        title: 'XUẤT SẢN XUẤT',
        caption: 'OUTBOUND',
        icon: 'precision_manufacturing',
        badgeLabel: outboundDone ? 'Hoàn thành' : issues.length > 0 ? 'Đang xử lý' : 'Chờ xử lý',
        badgeVariant: outboundDone ? 'done' : issues.length > 0 ? 'neutral' : 'pending',
        at: latestExport?.timestamp ?? null,
        performedBy: latestExportBy,
        timelineEvents: exportTimelineAsc.length
          ? exportTimelineAsc
          : [
              {
                at: null,
                performedBy: '—',
                label: 'Chưa có xuất kho',
                detail: '—'
              }
            ],
        rows: [
          { label: 'Kế hoạch', value: woSummary },
          {
            label: 'Ngày xuất gần nhất',
            value: latestExport?.timestamp ? this.formatDateShortVi(latestExport.timestamp) : '—'
          },
          { label: 'ID xuất gần nhất', value: latestExportBy },
          {
            label: 'Đã xuất',
            value: exportedTotal > 0 ? this.formatQtyOnly(exportedTotal) : outboundDone ? issues[0]?.qtyLabel || '—' : '—'
          }
        ],
        subTitle: 'LSX',
        subLines: [
          {
            label: 'Số phiếu',
            value: issues.length ? `${issues.length}` : '—'
          }
        ]
      }
    ];

    this.overviewRows = [
      { label: 'Lô hàng', value: summary.shipmentBatchLabel || '—' },
      { label: 'IMD', value: summary.batchLabel || '—' },
      { label: 'Material', value: summary.itemCode || '—' },
      { label: 'Mô tả', value: summary.itemName || '—' },
      { label: 'PO', value: summary.poNumber || '—' },
      { label: 'Xưởng', value: inv.factory || '—' },
      { label: 'Trạng thái', value: summary.statusLabel || '—' }
    ];

    const inboundPct = 100;
    let qcPct = 40;
    if (iqcU === 'PASS' || iqcU === 'PASSED') {
      qcPct = 100;
    } else if (iqcU === 'NG' || iqcU === 'LOCK' || iqcU === 'DAMAGED') {
      qcPct = 0;
    } else if (iqcU === 'CHỜ KIỂM' || !iqcU) {
      qcPct = 35;
    } else if (iqcU.includes('HOLD') || iqcU.includes('CHỜ')) {
      qcPct = 60;
    }

    const stockPct = q0 > 0 ? Math.min(100, Math.round((stockNum / q0) * 100)) : stored ? 100 : 0;
    const exportPct = q0 > 0 ? Math.min(100, Math.round((exportedTotal / q0) * 100)) : outboundDone ? 100 : 0;

    this.quickStats = [
      { label: 'Tiến độ nhập', valueLabel: `${inboundPct}%`, pct: inboundPct },
      { label: 'Kiểm QC', valueLabel: `${qcPct}%`, pct: qcPct },
      { label: 'Tồn / nhập', valueLabel: `${stockPct}%`, pct: stockPct },
      { label: 'Đã xuất / nhập', valueLabel: `${exportPct}%`, pct: exportPct }
    ];
  }

  private importDateToImdKey(importDate: unknown): string {
    const d = this.parseFirestoreDate(importDate);
    if (d) {
      return d.toLocaleDateString('en-GB').split('/').join('');
    }
    const s = this.coerceText(importDate);
    const m = /^(\d{8})/.exec(s);
    return m ? m[1] : '';
  }

  /** Lô hàng nhập kho (inbound-materials.batchNumber) gắn với dòng tồn kho. */
  private async loadInboundShipmentBatch(inv: InventoryRow): Promise<string> {
    const factories = [inv.factory, 'ASM1', 'ASM2'].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
    const imdKey = this.inventoryImdKey(inv) || (inv.batchNumber || '').trim();

    if (inv.id) {
      for (const factory of factories) {
        try {
          const snap = await this.firestore
            .collection('inbound-materials', ref =>
              ref.where('factory', '==', factory).where('linkedInventoryDocId', '==', inv.id).limit(1)
            )
            .get()
            .toPromise();
          if (snap && !snap.empty) {
            const bn = this.coerceText(snap.docs[0].data()['batchNumber']);
            if (bn) {
              return bn;
            }
          }
        } catch {
          /* composite index có thể chưa có */
        }
      }
    }

    if (!inv.materialCode || !inv.poNumber) {
      return '';
    }

    for (const factory of factories) {
      try {
        const snap = await this.firestore
          .collection('inbound-materials', ref =>
            ref.where('factory', '==', factory).where('materialCode', '==', inv.materialCode).where('poNumber', '==', inv.poNumber).limit(40)
          )
          .get()
          .toPromise();
        if (!snap || snap.empty) {
          continue;
        }

        let matched = '';
        snap.forEach(doc => {
          const data = doc.data() as Record<string, unknown>;
          const inboundImd = this.importDateToImdKey(data.importDate);
          const linked = this.coerceText(data.linkedInventoryDocId);
          const lot = this.coerceText(data.batchNumber);
          if (!lot) {
            return;
          }
          if (inv.id && linked === inv.id) {
            matched = lot;
            return;
          }
          if (
            !matched &&
            imdKey &&
            inboundImd &&
            (inboundImd === imdKey || imdKey.startsWith(inboundImd) || inboundImd.startsWith(imdKey))
          ) {
            matched = lot;
          }
        });
        if (matched) {
          return matched;
        }
      } catch {
        /* ignore */
      }
    }

    return '';
  }

  private async enrichPoImdCandidatesWithShipmentBatch(): Promise<void> {
    const options = this.poImdCandidates;
    if (!options.length) {
      return;
    }

    await Promise.all(
      options.map(async opt => {
        const row = opt.sourceRow;
        if (!row) {
          return;
        }
        const lot = await this.loadInboundShipmentBatch(row);
        if (!lot) {
          return;
        }
        opt.shipmentBatchLabel = lot;
        opt.label = `Lô hàng: ${lot} · PO: ${opt.poNumber} · IMD: ${opt.imdKey}`;
      })
    );

    if (this.showPoImdPicker) {
      this.poImdCandidates = [...options];
    }
  }

  /** Tra cứu theo mã lô hàng nhập kho (inbound-materials.batchNumber). */
  private async queryByInboundShipmentBatch(lotCode: string): Promise<InventoryRow | null> {
    const lot = lotCode.trim();
    if (!lot) {
      return null;
    }

    for (const factory of ['ASM1', 'ASM2']) {
      const snap = await this.firestore
        .collection('inbound-materials', ref => ref.where('factory', '==', factory).where('batchNumber', '==', lot).limit(15))
        .get()
        .toPromise();
      if (!snap || snap.empty) {
        continue;
      }

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const linkedId = this.coerceText(data.linkedInventoryDocId);
        if (linkedId) {
          const inv = await this.loadInventoryById(linkedId, factory);
          if (inv) {
            return inv;
          }
        }

        const materialCode = this.coerceText(data.materialCode);
        const poNumber = this.coerceText(data.poNumber);
        const imd = this.importDateToImdKey(data.importDate);
        if (materialCode && poNumber && imd) {
          const inv = await this.queryByMaterialPoImd(materialCode, poNumber, imd);
          if (inv) {
            return inv;
          }
        }
      }
    }

    return null;
  }

  private inventoryImdKey(row: InventoryRow): string {
    const bn = (row.batchNumber || '').toString().trim();
    const m = /^(\d{8})/.exec(bn);
    if (m) {
      return m[1];
    }
    const imp = row.importDate;
    if (imp && typeof (imp as { toDate?: () => Date }).toDate === 'function') {
      const d = (imp as { toDate: () => Date }).toDate();
      return d.toLocaleDateString('en-GB').split('/').join('');
    }
    if (imp instanceof Date) {
      return imp.toLocaleDateString('en-GB').split('/').join('');
    }
    return '';
  }

  private normalizeOutboundImdKey(data: Record<string, unknown>): string {
    const raw = data?.importDate ?? data?.batchNumber ?? data?.batch;
    if (raw == null || raw === '') {
      return '';
    }
    if (typeof raw === 'string') {
      const t = raw.trim();
      const full = /^(\d{8})(?:-\d+\/\d+)?$/.exec(t);
      if (full) {
        return full[1];
      }
      const prefix = /^(\d{8})-/.exec(t);
      if (prefix) {
        return prefix[1];
      }
      if (/^\d{8}$/.test(t)) {
        return t;
      }
    }
    if (raw && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
      const d = (raw as { toDate: () => Date }).toDate();
      return d.toLocaleDateString('en-GB').split('/').join('');
    }
    if (raw instanceof Date) {
      return raw.toLocaleDateString('en-GB').split('/').join('');
    }
    return '';
  }

  /** Firestore fields may be string | number | Timestamp; never assume .trim() exists. */
  private coerceText(value: unknown): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return String(value).trim();
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return String(value).trim();
  }

  private parseFirestoreDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      try {
        return (value as { toDate: () => Date }).toDate();
      } catch {
        return null;
      }
    }
    return null;
  }

  private mapDoc(docId: string, data: Record<string, unknown>, factory: string): InventoryRow {
    return {
      id: docId,
      factory: this.coerceText(data.factory) || factory,
      supplierName: this.coerceText(
        (data as Record<string, unknown>).supplierName ??
          (data as Record<string, unknown>).supplier ??
          (data as Record<string, unknown>).vendorName
      ),
      materialCode: this.coerceText(data.materialCode),
      materialName: this.coerceText(data.materialName),
      poNumber: this.coerceText(data.poNumber),
      batchNumber: this.coerceText(data.batchNumber),
      quantity: Number(data.quantity) || 0,
      unit: this.coerceText(data.unit) || '—',
      rollsOrBags: this.coerceText(data.rollsOrBags),
      location: this.coerceText(data.location) || '—',
      iqcStatus: this.coerceText(data.iqcStatus),
      qcCheckedBy: this.coerceText(data.qcCheckedBy),
      qcCheckedAt: this.parseFirestoreDate(data.qcCheckedAt),
      importDate: data.importDate,
      stock: data.stock != null ? Number(data.stock) : undefined,
      exported: data.exported != null ? Number(data.exported) : undefined,
      lastModified: this.parseFirestoreDate(data.lastModified),
      modifiedBy: this.coerceText(data.modifiedBy)
    };
  }

  /** Tải lịch sử đổi vị trí mới nhất cho tồn kho từ `material-location-history`. */
  private async loadLatestLocationChange(inv: InventoryRow): Promise<void> {
    if (!inv.id) return;
    try {
      const snap = await this.firestore
        .collection('material-location-history', ref =>
          ref.where('materialId', '==', inv.id).orderBy('changedAt', 'desc').limit(1)
        )
        .get()
        .toPromise();
      if (!snap || snap.empty) {
        // Fallback: dùng lastModified + modifiedBy từ inventory-materials
        if (inv.lastModified) {
          inv.locationChangedAt = inv.lastModified;
          inv.locationChangedBy = this.formatPerformerId(inv.modifiedBy || '');
        }
        return;
      }
      const d = snap.docs[0].data() as Record<string, unknown>;
      inv.locationChangedBy = this.formatPerformerId(
        this.coerceText(d.changedBy) || this.coerceText(d.modifiedBy)
      );
      inv.locationChangedAt = this.parseFirestoreDate(d.changedAt) || this.parseFirestoreDate(d.lastModified);
    } catch {
      // Nếu lỗi (index chưa tạo, v.v.) thì dùng fallback từ inventory-materials
      if (inv.lastModified) {
        inv.locationChangedAt = inv.lastModified;
        inv.locationChangedBy = this.formatPerformerId(inv.modifiedBy || '');
      }
    }
  }

  private async queryByMaterialPoImd(
    materialCode: string,
    poNumber: string,
    scannedImd: string
  ): Promise<InventoryRow | null> {
    const factories = ['ASM1', 'ASM2'];
    for (const factory of factories) {
      const querySnapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', factory).where('materialCode', '==', materialCode).where('poNumber', '==', poNumber).limit(25)
        )
        .get()
        .toPromise();

      if (!querySnapshot || querySnapshot.empty) {
        continue;
      }

      let found: InventoryRow | null = null;
      querySnapshot.forEach(doc => {
        if (found) {
          return;
        }
        const row = this.mapDoc(doc.id, doc.data() as Record<string, unknown>, factory);
        const materialImd = this.inventoryImdKey(row) || row.batchNumber;
        const imdMatch =
          materialImd === scannedImd ||
          materialImd.startsWith(scannedImd) ||
          scannedImd.startsWith(materialImd);
        if (imdMatch) {
          found = row;
        }
      });

      if (found) {
        return found;
      }
    }
    return null;
  }

  private async queryByBatch(batch: string): Promise<InventoryRow | null> {
    const b = batch.trim();
    for (const factory of ['ASM1', 'ASM2']) {
      const snap = await this.firestore
        .collection('inventory-materials', ref => ref.where('factory', '==', factory).where('batchNumber', '==', b).limit(5))
        .get()
        .toPromise();
      if (snap && !snap.empty) {
        const d = snap.docs[0];
        return this.mapDoc(d.id, d.data() as Record<string, unknown>, factory);
      }
    }
    return null;
  }

  private async queryByMaterialCode(code: string): Promise<InventoryRow | null> {
    const rows = await this.queryAllByMaterialCode(code);
    if (!rows.length) return null;

    let best: InventoryRow | null = null;
    let bestTime = 0;
    for (const row of rows) {
      const t = row.lastModified?.getTime() || 0;
      if (!best || t >= bestTime) {
        best = row;
        bestTime = t;
      }
    }
    return best;
  }

  private async resolveInventory(raw: string): Promise<InventoryRow | null> {
    const t = raw.trim();
    if (!t) {
      return null;
    }
    if (t.includes('|')) {
      const parts = t.split('|').map(p => p.trim());
      if (parts.length >= 4) {
        return this.queryByMaterialPoImd(parts[0], parts[1], parts[3]);
      }
    }
    const upper = t.toUpperCase();
    const byBatch = await this.queryByBatch(upper);
    if (byBatch) {
      return byBatch;
    }
    const byBatchOrig = await this.queryByBatch(t);
    if (byBatchOrig) {
      return byBatchOrig;
    }
    return this.queryByMaterialCode(upper);
  }

  private mapOverallStatus(iqc: string): { label: string; variant: TraceabilitySummary['statusVariant'] } {
    const s = (iqc || '').trim().toUpperCase();
    if (s === 'PASS' || s === 'PASSED') {
      return { label: 'Ready for Production', variant: 'success' };
    }
    if (s === 'NG' || s === 'LOCK' || s === 'DAMAGED') {
      return { label: 'Quarantined', variant: 'danger' };
    }
    if (s === 'CHỜ XÁC NHẬN' || s === 'HOLD' || s === 'ĐẶC CÁCH') {
      return { label: 'On Hold', variant: 'warning' };
    }
    if (s === 'CHỜ KIỂM') {
      return { label: 'Pending QC', variant: 'info' };
    }
    return { label: iqc || 'Unknown', variant: 'info' };
  }

  private mapConditionBadge(iqc: string): { label: string; variant: TraceabilityQcNode['conditionVariant'] } {
    const s = (iqc || '').trim().toUpperCase();
    if (s === 'PASS' || s === 'PASSED') {
      return { label: 'Passed', variant: 'success' };
    }
    if (s === 'NG' || s === 'LOCK') {
      return { label: s === 'LOCK' ? 'Locked' : 'Failed', variant: 'danger' };
    }
    if (s === 'DAMAGED') {
      return { label: 'Damaged', variant: 'danger' };
    }
    if (s === 'CHỜ XÁC NHẬN' || s === 'HOLD') {
      return { label: 'Hold', variant: 'warning' };
    }
    if (s === 'CHỜ KIỂM') {
      return { label: 'Pending', variant: 'info' };
    }
    return { label: iqc || '—', variant: 'info' };
  }

  private buildScannedRollsLabel(row: InventoryRow): string {
    const rb = this.coerceText(row.rollsOrBags);
    if (rb && /\d+\s*\/\s*\d+/.test(rb)) {
      return `Scanned: ${rb.replace(/\s*\/\s*/, '/')} rolls`;
    }
    if (rb && /\d/.test(rb)) {
      return `Scanned: ${rb}`;
    }
    const q = row.quantity;
    if (q > 0) {
      return `Scanned: ${this.formatQtyOnly(q)}`;
    }
    return 'Scanned: —';
  }

  private stockDisplay(row: InventoryRow): string {
    if (row.stock != null && !Number.isNaN(row.stock)) {
      return this.formatQtyOnly(row.stock, '0');
    }
    const exp = row.exported != null ? row.exported : 0;
    const q = row.quantity;
    const remain = Math.max(0, q - exp);
    return this.formatQtyOnly(remain, '0');
  }

  private async loadOutboundIssues(row: InventoryRow): Promise<TraceabilityIssue[]> {
    const materialCode = row.materialCode;
    const poNumber = row.poNumber;
    const batchKey = this.inventoryImdKey(row);

    const factories = [row.factory, 'ASM1', 'ASM2'].filter((v, i, a) => v && a.indexOf(v) === i);

    const issues: TraceabilityIssue[] = [];
    const seenDocIds = new Set<string>();

    for (const factory of factories) {
      let snap: { empty: boolean; forEach: (cb: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void } | null =
        null;
      try {
        snap = (await this.firestore
          .collection('outbound-materials', ref =>
            ref.where('factory', '==', factory).where('materialCode', '==', materialCode).where('poNumber', '==', poNumber)
          )
          .get()
          .toPromise()) as typeof snap;
      } catch {
        snap = null;
      }

      if (!snap || snap.empty) {
        continue;
      }

      snap.forEach(doc => {
        if (seenDocIds.has(doc.id)) {
          return;
        }
        const data = doc.data() as Record<string, unknown>;
        const obKey = this.normalizeOutboundImdKey(data);
        if (batchKey && obKey && obKey !== batchKey) {
          return;
        }
        seenDocIds.add(doc.id);
        const exportQty = Number(data.exportQuantity) || 0;
        const wo = ((data.productionOrder as string) || '').trim() || '—';
        const ts = this.parseFirestoreDate(data.exportDate) || this.parseFirestoreDate(data.updatedAt) || this.parseFirestoreDate(data.createdAt);
        const performedBy = this.formatPerformerId(
          this.coerceText(data.employeeId) || this.coerceText(data.exportedBy) || this.coerceText(data.createdBy)
        );
        issues.push({
          workOrder: wo,
          qtyLabel: exportQty ? `-${this.formatQtyOnly(exportQty)}` : '—',
          exportQty,
          timestamp: ts,
          performedBy
        });
      });
    }

    issues.sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
    return issues;
  }

  async runLookup(): Promise<void> {
    const code = (this.scanCode || '').trim();
    if (!code) {
      this.errorMessage = 'Vui lòng quét hoặc nhập mã lô / QR.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.showPoImdPicker = false;
    this.poImdCandidates = [];
    this.pendingLookupMaterial = '';
    this.summary = null;
    this.qcNode = null;
    this.issues = [];
    this.treeRoot = null;
    this.lastInventory = null;
    this.flowStages = [];
    this.overviewRows = [];
    this.quickStats = [];

    try {
      const parsed = this.parseScanInput(code);
      if (!parsed) {
        this.errorMessage = 'Vui lòng quét hoặc nhập mã lô / QR.';
        return;
      }

      let inv: InventoryRow | null = null;

      if (parsed.type === 'qr') {
        inv = await this.queryByMaterialPoImd(parsed.material, parsed.po, parsed.imd);
      } else if (parsed.type === 'batch') {
        inv = await this.queryByBatch(parsed.batch);
      } else {
        const all = await this.queryAllByMaterialCode(parsed.material);
        if (!all.length) {
          inv = await this.queryByInboundShipmentBatch(code);
          if (!inv) {
            this.errorMessage = `Không tìm thấy mã hàng / lô hàng ${parsed.material} trên tồn kho, nhập kho hoặc lịch sử xuất ASM1/ASM2.`;
            return;
          }
        } else {
          const options = this.buildPoImdOptions(all);
          if (options.length > 1) {
            this.poImdCandidates = options;
            this.pendingLookupMaterial = parsed.material;
            this.showPoImdPicker = true;
            void this.enrichPoImdCandidatesWithShipmentBatch();
            return;
          }
          inv =
            (options[0].inventoryId
              ? await this.loadInventoryById(options[0].inventoryId, options[0].factory)
              : null) ||
            options[0].sourceRow ||
            all[0];
        }
      }

      if (!inv) {
        inv = await this.queryByInboundShipmentBatch(code);
      }

      if (!inv) {
        this.errorMessage = 'Không tìm thấy tồn kho khớp mã quét. Thử QR đầy đủ (Material|PO|SL|IMD), mã lô hàng hoặc chọn PO/IMD.';
        return;
      }

      this.setTraceSummaryFromInventory(inv);
      await this.applyInventoryTrace(inv);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errorMessage = `Lỗi tải dữ liệu: ${msg}`;
    } finally {
      this.isLoading = false;
      this.scanCode = '';
      this.focusScanField();
    }
  }
}
