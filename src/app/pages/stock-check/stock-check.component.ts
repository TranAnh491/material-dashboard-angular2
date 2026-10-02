import { Component } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';
import { isAsm3OrWh3PrefixLocation } from '../layout-warehouse/layout-warehouse-location.util';

type KkFactory = 'ASM1' | 'ASM2';
type ScStep = 'gate' | 'location' | 'work';

interface StockCheckRow {
  id: string;
  factory: KkFactory;
  materialCode: string;
  materialName: string;
  poNumber: string;
  batchNumber: string;
  location: string;
  quantity: number;
  stock: number;
  unit: string;
  kkChecked: boolean;
  kkBy: string;
  kkAt: Date | null;
}

interface MissingReport {
  id: string;
  inventoryDocId: string;
  factory: string;
  location: string;
  materialCode: string;
  materialName: string;
  poNumber: string;
  batchNumber: string;
  stock: number;
  unit: string;
  reportedBy: string;
  status: string;
  createdAt: Date | null;
}

interface ShortageReport {
  id: string;
  inventoryDocId: string;
  factory: string;
  location: string;
  materialCode: string;
  materialName: string;
  poNumber: string;
  batchNumber: string;
  stock: number;
  actualQty: number;
  shortageQty: number;
  unit: string;
  reportedBy: string;
  createdAt: Date | null;
}

@Component({
  selector: 'app-stock-check',
  templateUrl: './stock-check.component.html',
  styleUrls: ['./stock-check.component.scss']
})
export class StockCheckComponent {
  readonly factories: KkFactory[] = ['ASM1', 'ASM2'];

  step: ScStep = 'gate';
  operatorId = '';
  operatorInput = '';
  factory: KkFactory | '' = '';

  locationInput = '';
  location = '';
  searchCode = '';
  rows: StockCheckRow[] = [];
  selectedId = '';
  scanInput = '';
  scanMatched = false;
  actualQtyInput = '';
  showShortageForm = false;

  isLoading = false;
  isSaving = false;
  error = '';
  info = '';

  showMissingCatalog = false;
  showShortageCatalog = false;
  missingReports: MissingReport[] = [];
  shortageReports: ShortageReport[] = [];
  catalogLoading = false;

  private factoryRows: StockCheckRow[] = [];
  private factoryRowsKey = '';

  constructor(
    private firestore: AngularFirestore,
    private router: Router
  ) {}

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }

  get selectedRow(): StockCheckRow | null {
    return this.rows.find((row) => row.id === this.selectedId) || null;
  }

  get doneCount(): number {
    return this.rows.filter((row) => row.kkChecked).length;
  }

  get filteredRows(): StockCheckRow[] {
    const q = this.searchCode.trim().toUpperCase();
    const rows = q
      ? this.rows.filter((row) =>
          row.materialCode.includes(q) ||
          row.poNumber.toUpperCase().includes(q) ||
          row.batchNumber.toUpperCase().includes(q)
        )
      : this.rows.slice();
    return rows.sort((a, b) => {
      if (a.kkChecked !== b.kkChecked) return a.kkChecked ? 1 : -1;
      return a.materialCode.localeCompare(b.materialCode) || a.poNumber.localeCompare(b.poNumber);
    });
  }

  submitOperator(): void {
    const code = this.parseEmployee(this.operatorInput);
    if (!code) {
      this.error = 'Mã nhân viên không đúng. Quét theo chuẩn ASP + 4 số.';
      return;
    }
    if (this.factory !== 'ASM1' && this.factory !== 'ASM2') {
      this.error = 'Chọn ASM1 hoặc ASM2.';
      return;
    }
    this.operatorId = code;
    this.error = '';
    this.info = '';
    this.step = 'location';
    this.focus('sc-location-input');
  }

  setFactory(factory: KkFactory): void {
    if (this.factory === factory) return;
    this.factory = factory;
    this.factoryRows = [];
    this.factoryRowsKey = '';
    this.rows = [];
    this.location = '';
    this.selectedId = '';
    this.resetScan();
  }

  async submitLocation(): Promise<void> {
    const loc = this.normLoc(this.locationInput);
    if (!loc) {
      this.error = 'Quét vị trí trước.';
      return;
    }
    if (this.factory !== 'ASM1' && this.factory !== 'ASM2') {
      this.error = 'Chọn ASM1 hoặc ASM2.';
      this.step = 'gate';
      return;
    }
    this.isLoading = true;
    this.error = '';
    this.info = '';
    try {
      await this.ensureFactoryRows(this.factory);
      this.location = loc;
      this.rows = this.factoryRows.filter((row) => this.normLoc(row.location) === loc);
      this.selectedId = '';
      this.searchCode = '';
      this.resetScan();
      this.step = 'work';
      if (!this.rows.length) {
        this.info = `Không có mã tại vị trí ${loc}.`;
      }
      this.focus('sc-search-input');
    } catch (e) {
      console.error('stock-check location:', e);
      this.error = 'Không tải được mã tại vị trí này.';
    } finally {
      this.isLoading = false;
    }
  }

  changeLocation(): void {
    this.step = 'location';
    this.location = '';
    this.locationInput = '';
    this.rows = [];
    this.selectedId = '';
    this.searchCode = '';
    this.resetScan();
    this.error = '';
    this.info = '';
    this.focus('sc-location-input');
  }

  selectRow(row: StockCheckRow): void {
    if (this.selectedId === row.id) return;
    this.selectedId = row.id;
    this.resetScan();
    this.error = '';
    this.info = '';
    if (!row.kkChecked) this.focus('sc-scan-input');
  }

  submitScan(): void {
    const row = this.selectedRow;
    if (!row) {
      this.error = 'Chọn một mã trong danh sách.';
      return;
    }
    const scanned = this.parseLabel(this.scanInput);
    if (!scanned.code) {
      this.error = 'Quét mã hàng.';
      return;
    }
    if (scanned.code !== row.materialCode) {
      this.scanMatched = false;
      this.error = `Sai mã. Quét ${scanned.code}, cần ${row.materialCode}.`;
      return;
    }
    if (scanned.po && row.poNumber && scanned.po !== row.poNumber.toUpperCase()) {
      this.scanMatched = false;
      this.error = `Sai PO. Quét ${scanned.po}, cần ${row.poNumber}.`;
      return;
    }
    this.scanMatched = true;
    this.error = '';
    this.info = `Đã khớp mã ${row.materialCode}. Tồn ${this.formatQty(row.stock)} ${row.unit}.`;
  }

  async confirmEnough(): Promise<void> {
    const row = this.selectedRow;
    if (!row || !this.scanMatched || row.kkChecked || this.isSaving) return;
    await this.markDone(row);
  }

  async reportMissing(): Promise<void> {
    const row = this.selectedRow;
    if (!row || this.isSaving) return;
    this.isSaving = true;
    this.error = '';
    try {
      await this.firestore.collection('stock-check-missing').add({
        inventoryDocId: row.id,
        factory: row.factory,
        location: row.location,
        materialCode: row.materialCode,
        materialName: row.materialName,
        poNumber: row.poNumber,
        batchNumber: row.batchNumber,
        stock: row.stock,
        unit: row.unit,
        reportedBy: this.operatorId,
        status: 'pending',
        createdAt: new Date()
      });
      this.info = `Đã báo mã ${row.materialCode} không có. Quản lý duyệt xóa trong danh sách.`;
      this.showShortageForm = false;
      await this.openMissingCatalog();
    } catch (e) {
      console.error('stock-check missing:', e);
      this.error = 'Không lưu được báo cáo mã không có.';
    } finally {
      this.isSaving = false;
    }
  }

  openShortageForm(): void {
    const row = this.selectedRow;
    if (!row || !this.scanMatched) {
      this.error = 'Quét đúng mã trước khi báo thiếu lượng.';
      return;
    }
    this.showShortageForm = true;
    this.actualQtyInput = '';
    this.error = '';
    this.focus('sc-actual-qty');
  }

  async submitShortage(): Promise<void> {
    const row = this.selectedRow;
    if (!row || !this.scanMatched || this.isSaving) return;
    const actual = Number(String(this.actualQtyInput).replace(',', '.'));
    if (!Number.isFinite(actual) || actual < 0) {
      this.error = 'Nhập số lượng thực tế.';
      return;
    }
    const stock = Math.round(row.stock * 1000) / 1000;
    const actualQty = Math.round(actual * 1000) / 1000;
    if (actualQty >= stock) {
      this.error = `Số thực tế ${this.formatQty(actualQty)} không nhỏ hơn tồn ${this.formatQty(stock)}.`;
      return;
    }
    this.isSaving = true;
    this.error = '';
    try {
      await this.firestore.collection('stock-check-shortage').add({
        inventoryDocId: row.id,
        factory: row.factory,
        location: row.location,
        materialCode: row.materialCode,
        materialName: row.materialName,
        poNumber: row.poNumber,
        batchNumber: row.batchNumber,
        stock,
        actualQty,
        shortageQty: Math.round((stock - actualQty) * 1000) / 1000,
        unit: row.unit,
        reportedBy: this.operatorId,
        createdAt: new Date()
      });
      this.info = `Đã ghi thiếu lượng ${row.materialCode}: thực tế ${this.formatQty(actualQty)} / tồn ${this.formatQty(stock)}.`;
      this.showShortageForm = false;
      this.actualQtyInput = '';
      await this.openShortageCatalog();
    } catch (e) {
      console.error('stock-check shortage:', e);
      this.error = 'Không lưu được báo thiếu lượng.';
    } finally {
      this.isSaving = false;
    }
  }

  async openMissingCatalog(): Promise<void> {
    this.showMissingCatalog = true;
    this.catalogLoading = true;
    this.missingReports = [];
    try {
      const snap = await this.firestore
        .collection('stock-check-missing', (ref) => ref.where('status', '==', 'pending').limit(300))
        .get()
        .toPromise();
      this.missingReports = (snap?.docs || [])
        .map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            inventoryDocId: String(data.inventoryDocId || ''),
            factory: String(data.factory || ''),
            location: String(data.location || ''),
            materialCode: String(data.materialCode || ''),
            materialName: String(data.materialName || ''),
            poNumber: String(data.poNumber || ''),
            batchNumber: String(data.batchNumber || ''),
            stock: Number(data.stock) || 0,
            unit: String(data.unit || ''),
            reportedBy: String(data.reportedBy || ''),
            status: String(data.status || 'pending'),
            createdAt: this.normalizeTimestamp(data.createdAt)
          } as MissingReport;
        })
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    } catch (e) {
      console.error('stock-check missing list:', e);
      this.error = 'Không tải được danh sách mã không có.';
      this.showMissingCatalog = false;
    } finally {
      this.catalogLoading = false;
    }
  }

  closeMissingCatalog(): void {
    if (this.isSaving) return;
    this.showMissingCatalog = false;
  }

  async approveMissing(report: MissingReport): Promise<void> {
    if (this.isSaving) return;
    this.isSaving = true;
    this.error = '';
    try {
      if (report.inventoryDocId) {
        await this.firestore.collection('inventory-materials').doc(report.inventoryDocId).delete();
      }
      await this.firestore.collection('stock-check-missing').doc(report.id).update({
        status: 'approved',
        approvedBy: this.operatorId || '',
        approvedAt: new Date()
      });
      this.missingReports = this.missingReports.filter((row) => row.id !== report.id);
      this.factoryRows = this.factoryRows.filter((row) => row.id !== report.inventoryDocId);
      this.rows = this.rows.filter((row) => row.id !== report.inventoryDocId);
      if (this.selectedId === report.inventoryDocId) {
        this.selectedId = '';
        this.resetScan();
      }
      this.info = `Đã duyệt xóa mã ${report.materialCode}.`;
    } catch (e) {
      console.error('stock-check approve missing:', e);
      this.error = 'Không duyệt xóa được mã này.';
    } finally {
      this.isSaving = false;
    }
  }

  async openShortageCatalog(): Promise<void> {
    this.showShortageCatalog = true;
    this.catalogLoading = true;
    this.shortageReports = [];
    try {
      const snap = await this.firestore
        .collection('stock-check-shortage', (ref) => ref.limit(300))
        .get()
        .toPromise();
      this.shortageReports = (snap?.docs || [])
        .map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            inventoryDocId: String(data.inventoryDocId || ''),
            factory: String(data.factory || ''),
            location: String(data.location || ''),
            materialCode: String(data.materialCode || ''),
            materialName: String(data.materialName || ''),
            poNumber: String(data.poNumber || ''),
            batchNumber: String(data.batchNumber || ''),
            stock: Number(data.stock) || 0,
            actualQty: Number(data.actualQty) || 0,
            shortageQty: Number(data.shortageQty) || 0,
            unit: String(data.unit || ''),
            reportedBy: String(data.reportedBy || ''),
            createdAt: this.normalizeTimestamp(data.createdAt)
          } as ShortageReport;
        })
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    } catch (e) {
      console.error('stock-check shortage list:', e);
      this.error = 'Không tải được danh mục thiếu lượng.';
      this.showShortageCatalog = false;
    } finally {
      this.catalogLoading = false;
    }
  }

  closeShortageCatalog(): void {
    this.showShortageCatalog = false;
  }

  formatQty(value: number): string {
    const n = Math.round((Number(value) || 0) * 1000) / 1000;
    return String(n);
  }

  formatDateTime(value: Date | null): string {
    if (!value) return '—';
    return value.toLocaleString('vi-VN');
  }

  private async markDone(row: StockCheckRow): Promise<void> {
    const kkAt = new Date();
    this.isSaving = true;
    this.error = '';
    try {
      await this.firestore.collection('inventory-materials').doc(row.id).update({
        kkChecked: true,
        kkBy: this.operatorId,
        kkAt,
        updatedAt: new Date()
      });
      await this.firestore.collection('inventory-kk-history').add({
        inventoryDocId: row.id,
        factory: row.factory,
        materialCode: row.materialCode,
        materialName: row.materialName,
        poNumber: row.poNumber,
        batchNumber: row.batchNumber,
        location: row.location,
        quantity: row.quantity,
        stock: row.stock,
        unit: row.unit,
        checkedBy: this.operatorId,
        checkedAt: kkAt,
        checkedDateKey: this.toDateKey(kkAt),
        createdAt: new Date()
      });
      row.kkChecked = true;
      row.kkBy = this.operatorId;
      row.kkAt = kkAt;
      const cached = this.factoryRows.find((item) => item.id === row.id);
      if (cached) {
        cached.kkChecked = true;
        cached.kkBy = this.operatorId;
        cached.kkAt = kkAt;
      }
      this.info = `Done ${row.materialCode}.`;
      this.selectedId = '';
      this.resetScan();
      if (this.doneCount === this.rows.length && this.rows.length) {
        this.info = `Đã kiểm xong vị trí ${this.location}.`;
      }
    } catch (e) {
      console.error('stock-check done:', e);
      this.error = 'Không lưu được xác nhận đủ lượng.';
    } finally {
      this.isSaving = false;
    }
  }

  private async ensureFactoryRows(factory: KkFactory): Promise<void> {
    if (this.factoryRowsKey === factory && this.factoryRows.length) return;
    const snapshot = await this.firestore
      .collection('inventory-materials', (ref) => ref.where('factory', '==', factory).limit(10000))
      .get()
      .toPromise();
    this.factoryRows = (snapshot?.docs || [])
      .filter((doc) => !isAsm3OrWh3PrefixLocation(String((doc.data() as any).location || '')))
      .map((doc) => {
        const data = doc.data() as any;
        return {
          id: String(doc.id || ''),
          factory,
          materialCode: String(data.materialCode || '').trim().toUpperCase(),
          materialName: String(data.materialName || '').trim(),
          poNumber: String(data.poNumber || '').trim(),
          batchNumber: String(data.batchNumber || '').trim(),
          location: String(data.location || '').trim().toUpperCase(),
          quantity: Number(data.quantity) || 0,
          stock: this.calculateStockFromDoc(data),
          unit: String(data.unit || '').trim(),
          kkChecked: data.kkChecked === true,
          kkBy: String(data.kkBy || '').trim(),
          kkAt: this.normalizeTimestamp(data.kkAt)
        } as StockCheckRow;
      })
      .filter((row) => !!row.materialCode);
    this.factoryRowsKey = factory;
  }

  private resetScan(): void {
    this.scanInput = '';
    this.scanMatched = false;
    this.showShortageForm = false;
    this.actualQtyInput = '';
  }

  private parseEmployee(raw: string): string {
    const normalized = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    const match = normalized.match(/ASP\d{4}/);
    return match ? match[0] : '';
  }

  private parseLabel(raw: string): { code: string; po: string } {
    const clean = String(raw || '').trim().toUpperCase();
    if (!clean) return { code: '', po: '' };
    const parts = clean.split('|').map((part) => part.trim()).filter(Boolean);
    const code = (parts[0] || clean).replace(/\s+/g, '');
    return { code, po: parts[1] || '' };
  }

  private normLoc(value: string): string {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  private calculateStockFromDoc(data: any): number {
    const openingStock = data?.openingStock != null ? Number(data.openingStock) : 0;
    const quantity = Number(data?.quantity) || 0;
    const exported = Number(data?.exported) || 0;
    const xt = Number(data?.xt) || 0;
    return openingStock + quantity - exported - xt;
  }

  private normalizeTimestamp(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const ts = value as { toDate?: () => Date; seconds?: number };
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    return null;
  }

  private toDateKey(value: Date): string {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private focus(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }
}
