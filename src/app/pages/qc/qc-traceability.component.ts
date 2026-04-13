import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

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
  timestamp: Date | null;
}

interface InventoryRow {
  id: string;
  factory: string;
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

  scanCode = '';
  isLoading = false;
  errorMessage = '';
  summary: TraceabilitySummary | null = null;
  qcNode: TraceabilityQcNode | null = null;
  issues: TraceabilityIssue[] = [];

  constructor(private firestore: AngularFirestore) {}

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

  clearView(): void {
    this.summary = null;
    this.qcNode = null;
    this.issues = [];
    this.errorMessage = '';
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

      this.issues = await this.loadOutboundIssues(inv);
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
