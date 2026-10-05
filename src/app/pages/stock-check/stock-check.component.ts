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

interface KkHistoryItem {
  id: string;
  materialCode: string;
  materialName: string;
  location: string;
  checkedBy: string;
  factory: string;
  checkedAt: Date | null;
  action: 'tick' | 'untick';
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
  uiMode: 'laptop' | 'pda' = 'laptop';
  kkHistory: KkHistoryItem[] = [];
  historyLoading = false;
  historyCode = '';

  private factoryRows: StockCheckRow[] = [];
  private factoryRowsKey = '';
  private historyRequest = 0;
  private historyCache = new Map<string, KkHistoryItem[]>();

  constructor(
    private firestore: AngularFirestore,
    private router: Router
  ) {
    const saved = localStorage.getItem('stock-check-ui');
    if (saved === 'laptop' || saved === 'pda') {
      this.uiMode = saved;
    } else if (window.innerWidth <= 1024) {
      this.uiMode = 'pda';
    }
  }

  setUiMode(mode: 'laptop' | 'pda'): void {
    this.uiMode = mode;
    localStorage.setItem('stock-check-ui', mode);
  }

  clearSelection(): void {
    this.selectedId = '';
    this.resetScan();
    this.error = '';
    this.clearKkHistory();
  }

  get remainCount(): number {
    return Math.max(0, this.rows.length - this.doneCount);
  }

  get progressPercent(): number {
    if (!this.rows.length) return 0;
    return Math.round((this.doneCount / this.rows.length) * 100);
  }

  get historyPeopleList(): { id: string; tick: number; untick: number }[] {
    const map = new Map<string, { tick: number; untick: number }>();
    this.kkHistory.forEach((item) => {
      const id = item.checkedBy || 'Chưa rõ';
      const current = map.get(id) || { tick: 0, untick: 0 };
      if (item.action === 'untick') current.untick += 1;
      else current.tick += 1;
      map.set(id, current);
    });
    return Array.from(map.entries()).map(([id, value]) => ({ id, tick: value.tick, untick: value.untick }));
  }

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }

  goNav(path: string): void {
    void this.router.navigate([path]);
  }

  formatHistoryTime(value: Date | null): string {
    if (!value) return '—';
    const hh = String(value.getHours()).padStart(2, '0');
    const mi = String(value.getMinutes()).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    return `${hh}:${mi} ${dd}-${mm}-${value.getFullYear()}`;
  }

  onHistorySearch(value: string): void {
    const q = String(value || '').trim().toUpperCase();
    if (!q) {
      this.clearKkHistory();
      return;
    }
    if (this.rows.some((row) => row.materialCode === q)) {
      this.loadHistoryForCode(q);
      return;
    }
    if (this.historyCode && this.historyCode !== q) {
      this.clearKkHistory();
    }
  }

  submitHistorySearch(code?: string): void {
    const q = String(code || this.searchCode || '').trim().toUpperCase();
    if (!q) {
      this.clearKkHistory();
      return;
    }
    this.searchCode = q;
    this.loadHistoryForCode(q);
  }

  get historyCodePicks(): string[] {
    const q = this.searchCode.trim().toUpperCase();
    if (!q || !this.rows.length) return [];
    const codes: string[] = [];
    this.rows.forEach((row) => {
      if (codes.length >= 8 || codes.includes(row.materialCode)) return;
      if (row.materialCode.includes(q)) codes.push(row.materialCode);
    });
    return codes;
  }

  loadHistoryForCode(code: string): void {
    const materialCode = String(code || '').trim().toUpperCase();
    this.historyCode = materialCode;
    if (!materialCode) {
      this.clearKkHistory();
      return;
    }
    const cached = this.historyCache.get(materialCode);
    if (cached) {
      this.kkHistory = cached;
      this.historyLoading = false;
      return;
    }
    const request = ++this.historyRequest;
    this.historyLoading = true;
    this.kkHistory = [];
    this.firestore.collection('inventory-kk-history', (ref) =>
      ref.where('materialCode', '==', materialCode)
    ).get().subscribe((snapshot) => {
      if (request !== this.historyRequest || this.historyCode !== materialCode) return;
      const fetched = snapshot.docs.map((doc) => this.mapKkHistory(doc.id, doc.data() as any));
      const pendingLocal = (this.historyCache.get(materialCode) || [])
        .filter((item) => item.id.startsWith('local-') && !fetched.some((row) =>
          row.checkedBy === item.checkedBy && row.checkedAt?.getTime() === item.checkedAt?.getTime()
        ));
      const items = [...pendingLocal, ...fetched]
        .sort((a, b) => (b.checkedAt?.getTime() || 0) - (a.checkedAt?.getTime() || 0));
      this.historyCache.set(materialCode, items);
      this.kkHistory = items;
      this.historyLoading = false;
    }, () => {
      if (request !== this.historyRequest) return;
      this.historyLoading = false;
    });
  }

  private clearKkHistory(): void {
    this.historyRequest += 1;
    this.historyCode = '';
    this.kkHistory = [];
    this.historyLoading = false;
  }

  private rememberHistoryTick(row: StockCheckRow, checkedAt: Date, action: 'tick' | 'untick'): void {
    const code = row.materialCode.trim().toUpperCase();
    const item: KkHistoryItem = {
      id: `local-${action}-${checkedAt.getTime()}`,
      materialCode: code,
      materialName: row.materialName,
      location: row.location,
      checkedBy: this.operatorId,
      factory: row.factory,
      checkedAt,
      action
    };
    const prev = this.historyCache.get(code) || (this.historyCode === code ? this.kkHistory : []);
    const items = [item, ...prev];
    this.historyCache.set(code, items);
    this.historyCode = code;
    this.kkHistory = items;
    this.historyLoading = false;
  }

  private mapKkHistory(id: string, data: any): KkHistoryItem {
    return {
      id,
      materialCode: String(data?.materialCode || '').trim(),
      materialName: String(data?.materialName || '').trim(),
      location: String(data?.location || '').trim(),
      checkedBy: String(data?.checkedBy || data?.kkBy || '').trim(),
      factory: String(data?.factory || '').trim(),
      checkedAt: this.normalizeTimestamp(data?.checkedAt || data?.kkAt),
      action: data?.action === 'untick' ? 'untick' : 'tick'
    };
  }

  get selectedRow(): StockCheckRow | null {
    return this.rows.find((row) => row.id === this.selectedId) || null;
  }

  get doneCount(): number {
    return this.rows.filter((row) => row.kkChecked).length;
  }

  get filteredRows(): StockCheckRow[] {
    const q = this.searchCode.trim().toUpperCase();
    if (!q) return [];
    return this.rows
      .filter((row) =>
        row.materialCode.includes(q) ||
        row.poNumber.toUpperCase().includes(q) ||
        row.batchNumber.toUpperCase().includes(q)
      )
      .sort((a, b) => {
        if (a.kkChecked !== b.kkChecked) return a.kkChecked ? 1 : -1;
        return a.materialCode.localeCompare(b.materialCode) || a.poNumber.localeCompare(b.poNumber);
      });
  }

  async submitOperator(): Promise<void> {
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
    this.isLoading = true;
    try {
      await this.ensureFactoryRows(this.factory);
      this.rows = this.factoryRows.slice();
      this.location = '';
      this.searchCode = '';
      this.selectedId = '';
      this.resetScan();
      this.clearKkHistory();
      this.step = 'work';
      this.focus('sc-search-input');
    } catch (e) {
      console.error('stock-check search:', e);
      this.error = 'Không tải được danh sách mã.';
    } finally {
      this.isLoading = false;
    }
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
    this.clearKkHistory();
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
      this.clearKkHistory();
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
    this.clearKkHistory();
    this.error = '';
    this.info = '';
    this.focus('sc-location-input');
  }

  selectRow(row: StockCheckRow): void {
    if (this.selectedId === row.id) return;
    this.selectedId = row.id;
    this.searchCode = row.materialCode;
    this.resetScan();
    this.error = '';
    this.info = '';
    this.loadHistoryForCode(row.materialCode);
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

  async clearKkTick(row: StockCheckRow): Promise<void> {
    if (!row.kkChecked || this.isSaving) return;
    this.isSaving = true;
    this.error = '';
    try {
      const kkAt = new Date();
      await this.firestore.collection('inventory-materials').doc(row.id).update({
        kkChecked: false,
        kkBy: '',
        kkAt: null,
        updatedAt: kkAt
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
        action: 'untick',
        checkedBy: this.operatorId,
        checkedAt: kkAt,
        checkedDateKey: this.toDateKey(kkAt),
        createdAt: kkAt
      });
      this.rememberHistoryTick(row, kkAt, 'untick');
      row.kkChecked = false;
      row.kkBy = '';
      row.kkAt = null;
      const cached = this.factoryRows.find((item) => item.id === row.id);
      if (cached) {
        cached.kkChecked = false;
        cached.kkBy = '';
        cached.kkAt = null;
      }
      this.selectedId = row.id;
      this.resetScan();
      this.info = `Đã bỏ tick KK ${row.materialCode}. Có thể kiểm lại.`;
      this.focus('sc-scan-input');
    } catch (e) {
      console.error('stock-check untick:', e);
      this.error = 'Không bỏ được tick KK.';
    } finally {
      this.isSaving = false;
    }
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
        this.clearKkHistory();
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
        action: 'tick',
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
      this.rememberHistoryTick(row, kkAt, 'tick');
      this.info = `Done ${row.materialCode}.`;
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
