import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';

export interface TraceabilitySummary {
  itemCode: string;
  itemName: string;
  batchLabel: string;
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
}

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

export interface TraceFlowStage {
  title: string;
  caption: string;
  icon: string;
  badgeLabel: string;
  badgeVariant: TraceFlowBadgeVariant;
  rows: { label: string; value: string }[];
  subTitle: string;
  subLines: { label: string; value: string }[];
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

  /** KPI hàng trên — giá trị mặc định khi chưa search giống mock */
  get kpiStockDisplay(): string {
    return this.summary?.stockDisplay ?? '0 PCS';
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
      return '0 PCS';
    }
    const unit = (this.lastInventory.unit || '').trim() || 'PCS';
    const total = this.totalExportedQty(this.issues);
    return `${total} ${unit}`.trim();
  }

  get kpiRemainAfterExportDisplay(): string {
    return this.summary?.stockDisplay ?? '0 PCS';
  }

  get issueRows(): TraceIssueRow[] {
    if (!this.summary || !this.lastInventory) {
      return [];
    }

    const unit = ((this.lastInventory.unit as string) || '').trim() || 'PCS';
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
          exportQtyLabel: exp > 0 ? `${exp} ${unit}`.trim() : `— ${unit}`.trim(),
          exportDateLabel: issue.timestamp ? this.formatDateShortVi(issue.timestamp) : '—',
          factoryLineLabel: (this.lastInventory?.factory || '—').toString(),
          issuerLabel: (this.qcNode?.inspector || '—').toString(),
          statusLabel,
          statusTone,
          remainAfterLabel: `${remain} ${unit}`.trim()
        };
      });
  }

  ngAfterViewInit(): void {
    this.focusScanField();
  }

  onScanInput(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    this.scanCode = el?.value ?? '';
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
      subTitle: `Lô: ${summary.batchLabel || '—'} · PO: ${summary.poNumber || '—'}`,
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
    const u = (inv.unit || '').trim() || '—';
    return q > 0 ? `${q} ${u}` : `— ${u}`;
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

    this.flowStages = [
      {
        title: 'NHẬP KHO',
        caption: 'INBOUND',
        icon: 'inventory_2',
        badgeLabel: 'Hoàn thành',
        badgeVariant: 'done',
        rows: [
          { label: 'Nhà cung cấp', value: (inv.supplierName || '').trim() || (inv.poNumber ? `Theo PO ${inv.poNumber}` : '—') },
          { label: 'Ngày nhập', value: this.formatDateShortVi(impD) },
          { label: 'Số lượng', value: this.qtyOriginal(inv) }
        ],
        subTitle: 'LÔ NHẬP',
        subLines: [{ label: 'Mã lô', value: inv.batchNumber || this.inventoryImdKey(inv) || '—' }]
      },
      {
        title: 'KIỂM HÀNG',
        caption: 'IQC',
        icon: 'verified_user',
        badgeLabel: qcDone ? 'Hoàn thành' : 'Chờ xử lý',
        badgeVariant: qcDone ? 'done' : 'pending',
        rows: [
          { label: 'Nhân viên', value: qc.inspector || '—' },
          { label: 'Ngày giờ', value: this.formatDateShortVi(qc.timestamp) },
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
        rows: [
          { label: 'Vị trí', value: inv.location || '—' },
          { label: 'Ngày lưu', value: this.formatDateShortVi(inv.qcCheckedAt || impD) },
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
        rows: [
          { label: 'Kế hoạch', value: woSummary },
          {
            label: 'Ngày xuất gần nhất',
            value: latestExport?.timestamp ? this.formatDateShortVi(latestExport.timestamp) : '—'
          },
          {
            label: 'Đã xuất',
            value:
              exportedTotal > 0 ? `${exportedTotal} ${(inv.unit || '').trim() || ''}`.trim() : outboundDone ? issues[0]?.qtyLabel || '—' : '—'
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
      { label: 'Mã lô', value: summary.batchLabel || '—' },
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
      exported: data.exported != null ? Number(data.exported) : undefined
    };
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
    const c = code.trim().toUpperCase();
    let best: InventoryRow | null = null;
    let bestTime = 0;
    for (const factory of ['ASM1', 'ASM2']) {
      const snap = await this.firestore
        .collection('inventory-materials', ref => ref.where('factory', '==', factory).where('materialCode', '==', c).limit(40))
        .get()
        .toPromise();
      if (!snap || snap.empty) {
        continue;
      }
      snap.forEach(doc => {
        const row = this.mapDoc(doc.id, doc.data() as Record<string, unknown>, factory);
        const ua = this.parseFirestoreDate((doc.data() as Record<string, unknown>).updatedAt)?.getTime() || 0;
        if (!best || ua >= bestTime) {
          best = row;
          bestTime = ua;
        }
      });
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
    const u = row.unit || 'rolls';
    if (q > 0) {
      return `Scanned: ${q} ${u}`;
    }
    return 'Scanned: —';
  }

  private stockDisplay(row: InventoryRow): string {
    if (row.stock != null && !Number.isNaN(row.stock)) {
      return `${row.stock} ${row.unit}`.trim();
    }
    const exp = row.exported != null ? row.exported : 0;
    const q = row.quantity;
    const remain = Math.max(0, q - exp);
    return `${remain} ${row.unit}`.trim();
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
        const unit = ((data.unit as string) || row.unit || '').trim() || 'rolls';
        const wo = ((data.productionOrder as string) || '').trim() || '—';
        const ts = this.parseFirestoreDate(data.exportDate) || this.parseFirestoreDate(data.updatedAt) || this.parseFirestoreDate(data.createdAt);
        issues.push({
          workOrder: wo,
          qtyLabel: exportQty ? `-${exportQty} ${unit}` : `— ${unit}`,
          exportQty,
          timestamp: ts
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
    this.summary = null;
    this.qcNode = null;
    this.issues = [];
    this.treeRoot = null;
    this.lastInventory = null;
    this.flowStages = [];
    this.overviewRows = [];
    this.quickStats = [];

    try {
      const inv = await this.resolveInventory(code);
      if (!inv) {
        this.errorMessage = 'Không tìm thấy tồn kho khớp mã quét. Thử QR đầy đủ (Material|PO|SL|IMD) hoặc mã lô chính xác.';
        return;
      }

      const status = this.mapOverallStatus(inv.iqcStatus || '');
      const cond = this.mapConditionBadge(inv.iqcStatus || '');
      const qcTime = inv.qcCheckedAt || this.parseFirestoreDate(inv.importDate as unknown);

      this.summary = {
        itemCode: inv.materialCode,
        itemName: inv.materialName || '—',
        batchLabel: inv.batchNumber || this.inventoryImdKey(inv) || '—',
        poNumber: inv.poNumber || '—',
        stockDisplay: this.stockDisplay(inv),
        location: inv.location || '—',
        statusLabel: status.label,
        statusVariant: status.variant
      };

      this.qcNode = {
        inspector: inv.qcCheckedBy || '—',
        timestamp: qcTime,
        scannedLabel: this.buildScannedRollsLabel(inv),
        conditionLabel: cond.label,
        conditionVariant: cond.variant
      };

      this.lastInventory = inv;
      this.issues = await this.loadOutboundIssues(inv);
      this.treeRoot = this.buildIssuedTree(this.summary, this.issues);
      this.rebuildDashboard(inv, this.summary, this.qcNode, this.issues);
      this.touchUpdatedAt();
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
