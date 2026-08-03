import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ReadTrackerService } from '../../services/read-tracker.service';
import { TpCatalogFullService } from '../../services/tp-catalog-full.service';
import { CartonPackingQtyService } from '../../services/carton-packing-qty.service';
import { ProductCatalogItem } from './fg-inventory.component';
import {
  buildStorageZones,
  checkStorageLocations,
  shortStorageCustomerLabel,
  STORAGE_LAYOUT_RULES,
  StorageCheckResult,
  StorageInventoryLine,
  StorageZoneView,
  ZONE_A_CUSTOMERS,
  ZONE_A_RESERVED_CUSTOMERS,
  ZONE_AXON_CUSTOMERS,
  ZONE_B_GIL_HOB_CUSTOMERS,
  ZONE_SCIEN_CUSTOMERS
} from './fg-storage-layout';
import { FgCustomerLabelCodeService } from '../../services/fg-customer-label-code.service';
import { CustomerCodeEntry, printCustomerCodeLabels } from './fg-customer-code.util';

export interface TpStockListRow {
  materialCode: string;
  quantity: number;
  carton: number;
  customer: string;
  kkChecked: number;
  kkTotal: number;
}

@Component({
  selector: 'app-fg-tp-stock-list',
  templateUrl: './fg-tp-stock-list.component.html',
  styleUrls: ['./fg-tp-stock-list.component.scss']
})
export class FgTpStockListComponent implements OnInit, OnDestroy {
  selectedFactory = 'ASM1';
  readonly factoryOptions = ['ASM1', 'ASM2', 'ASM3', 'TOTAL'];

  /**
   * Khách thuộc ASM3 (danh mục KH) — tạm thời cố định, bổ sung thêm sau.
   * So khớp không phân biệt hoa thường.
   */
  private static readonly ASM3_CUSTOMERS = new Set(['GNRAC', 'HPPPS']);

  isLoading = false;
  catalogItems: ProductCatalogItem[] = [];
  private packingQtyMap = new Map<string, number>();

  allRows: TpStockListRow[] = [];
  /** Chi tiết từng dòng FG Inventory (để Check vị trí / dời pallet). */
  inventoryDetailLines: StorageInventoryLine[] = [];
  filterMa = '';
  filterCustomer = '';
  sortCartonDesc = true;

  showCustomerCartonModal = false;
  showCustomerCodeModal = false;
  customerCodeCatalog: CustomerCodeEntry[] = [];
  isSyncingCustomerCodes = false;
  showStorageDiagramModal = false;
  showStorageCheckModal = false;
  isStorageChecking = false;
  storageCheckResult: StorageCheckResult | null = null;
  readonly storageRules = STORAGE_LAYOUT_RULES;

  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private readTracker: ReadTrackerService,
    private tpCatalogService: TpCatalogFullService,
    private cartonPackingQtyService: CartonPackingQtyService,
    private customerLabelCodeService: FgCustomerLabelCodeService
  ) {}

  ngOnInit(): void {
    const factory = this.route.snapshot.queryParamMap.get('factory');
    if (factory && this.factoryOptions.includes(factory)) {
      this.selectedFactory = factory;
    }

    Promise.all([
      this.tpCatalogService.getCatalogItemsCached(),
      this.cartonPackingQtyService.loadAllAsMap()
    ])
      .then(([items, packingMap]) => {
        this.catalogItems = items;
        this.packingQtyMap = packingMap;
        this.cdr.markForCheck();
        // Reload nếu data đã về trước catalog — tính lại carton / phân ASM3 theo KH
        if (this.allRows.length || this.selectedFactory === 'ASM3') {
          void this.loadData();
        } else {
          void this.syncCustomerLabelCodes();
        }
      })
      .catch((err) => console.error('Load catalog/packing qty failed:', err));

    void this.loadData();

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const f = params.get('factory');
      if (f && this.factoryOptions.includes(f) && f !== this.selectedFactory) {
        this.selectedFactory = f;
        void this.loadData();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setFactory(factory: string): void {
    if (this.selectedFactory === factory) return;
    this.selectedFactory = factory;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { factory },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    void this.loadData();
  }

  goToFgInventory(): void {
    // FG Inventory chưa có tab ASM3 — mở TOTAL để còn tra mã
    const factory = this.selectedFactory === 'ASM3' ? 'TOTAL' : this.selectedFactory;
    this.router.navigate(['/fg-inventory'], {
      queryParams: { factory }
    });
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  selectMaterial(materialCode: string): void {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code) return;
    const factory = this.selectedFactory === 'ASM3' ? 'TOTAL' : this.selectedFactory;
    this.router.navigate(['/fg-inventory'], {
      queryParams: { maTp: code, factory }
    });
  }

  /** Khách thuộc ASM3 theo danh mục (GNRAC, HPPPS, …). */
  private isAsm3Customer(customerName: string | undefined | null): boolean {
    const name = String(customerName || '').trim().toUpperCase();
    return !!name && FgTpStockListComponent.ASM3_CUSTOMERS.has(name);
  }

  /** Dòng có thuộc nhà máy đang chọn không (ASM3 theo danh mục KH). */
  private matchesSelectedFactory(data: any, materialCode7: string): boolean {
    const factory = String(data?.factory || 'ASM1').trim().toUpperCase() || 'ASM1';
    const customer = this.getCustomerName(materialCode7).trim();
    const isAsm3Kh = this.isAsm3Customer(customer);

    if (this.selectedFactory === 'TOTAL') return true;
    if (this.selectedFactory === 'ASM3') return isAsm3Kh;
    // ASM1 / ASM2: theo field factory, loại trừ khách ASM3
    if (isAsm3Kh) return false;
    return factory === this.selectedFactory;
  }

  async loadData(): Promise<void> {
    this.isLoading = true;
    this.allRows = [];
    this.inventoryDetailLines = [];
    this.filterMa = '';
    this.filterCustomer = '';
    this.cdr.markForCheck();

    try {
      // ASM3 lọc theo danh mục KH — load rộng rồi lọc client.
      // ASM1/ASM2 query theo factory rồi loại khách ASM3 phía client.
      const snap = await this.firestore
        .collection('fg-inventory', (ref) => {
          let q: firebase.firestore.Query = ref;
          if (this.selectedFactory === 'ASM1' || this.selectedFactory === 'ASM2') {
            q = q.where('factory', '==', this.selectedFactory);
          }
          return q.limit(5000);
        })
        .get()
        .toPromise();

      this.readTracker.track('fg-inventory', 'fg-inventory-tp-stock-list', snap?.docs.length || 0);

      const byCode = new Map<string, { quantity: number; carton: number; kkChecked: number; kkTotal: number }>();
      const detailLines: StorageInventoryLine[] = [];
      (snap?.docs || []).forEach((doc) => {
        const data = doc.data() as any;
        const ton = Number(data.ton ?? data.stock ?? 0);
        if (ton <= 0) return;
        const code = String(data.materialCode || data.maTP || '').trim().toUpperCase().slice(0, 7);
        if (!code) return;
        if (!this.matchesSelectedFactory(data, code)) return;

        const location = String(data.location || data.viTri || '').trim();
        const customer = this.getCustomerName(code).trim() || 'Không xác định';
        const packingPer = this.getPackingQty(code);
        const computed = CartonPackingQtyService.computeCartonOdd(ton, packingPer);
        const lineCarton = packingPer > 0 ? computed.carton : Number(data.carton || 0);
        detailLines.push({
          id: doc.id,
          materialCode: code,
          customer,
          location,
          ton,
          carton: lineCarton,
          batchNumber: String(data.batchNumber || '').trim(),
          lot: String(data.lot || '').trim(),
          lsx: String(data.lsx || '').trim(),
          factory: String(data.factory || 'ASM1').trim(),
          editHistory: Array.isArray(data.editHistory) ? data.editHistory : []
        });

        const cur = byCode.get(code) || { quantity: 0, carton: 0, kkChecked: 0, kkTotal: 0 };
        cur.quantity += ton;
        cur.carton += lineCarton;
        cur.kkTotal += 1;
        if (String(data.viTriKK || data.locationKK || '').trim()) {
          cur.kkChecked += 1;
        }
        byCode.set(code, cur);
      });

      this.inventoryDetailLines = detailLines;
      this.allRows = Array.from(byCode.entries()).map(([materialCode, v]) => ({
        materialCode,
        quantity: v.quantity,
        carton: v.carton,
        customer: this.getCustomerName(materialCode).trim() || 'Không xác định',
        kkChecked: v.kkChecked,
        kkTotal: v.kkTotal
      }));
    } catch (e) {
      console.error('FgTpStockList loadData failed', e);
      this.allRows = [];
    } finally {
      this.isLoading = false;
      void this.syncCustomerLabelCodes();
      this.cdr.markForCheck();
    }
  }

  private collectCustomerNames(): string[] {
    const names = new Set<string>();
    for (const c of this.catalogItems) {
      const n = String(c.customer || '').trim();
      if (n) names.add(n);
    }
    for (const r of this.allRows) {
      const n = String(r.customer || '').trim();
      if (n) names.add(n);
    }
    for (const code of [
      ...ZONE_A_CUSTOMERS,
      ...ZONE_A_RESERVED_CUSTOMERS,
      ...ZONE_B_GIL_HOB_CUSTOMERS,
      ...ZONE_SCIEN_CUSTOMERS,
      ...ZONE_AXON_CUSTOMERS
    ]) {
      names.add(code);
    }
    return [...names];
  }

  /** Đồng bộ danh mục mã KH — khách mới nhận số tiếp theo, mã cũ không đổi. */
  async syncCustomerLabelCodes(): Promise<void> {
    if (this.isSyncingCustomerCodes) return;
    this.isSyncingCustomerCodes = true;
    try {
      this.customerCodeCatalog = await this.customerLabelCodeService.syncCustomers(this.collectCustomerNames());
    } catch (e) {
      console.error('syncCustomerLabelCodes failed', e);
      this.customerCodeCatalog = this.customerLabelCodeService.getCatalog();
    } finally {
      this.isSyncingCustomerCodes = false;
      this.cdr.markForCheck();
    }
  }

  get maFilterOptions(): string[] {
    return Array.from(new Set(this.allRows.map((r) => r.materialCode))).sort((a, b) =>
      a.localeCompare(b, 'vi')
    );
  }

  get customerFilterOptions(): string[] {
    return Array.from(new Set(this.allRows.map((r) => r.customer).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'vi')
    );
  }

  get displayRows(): TpStockListRow[] {
    let rows = this.allRows;
    if (this.filterMa) {
      rows = rows.filter((r) => r.materialCode === this.filterMa);
    }
    if (this.filterCustomer) {
      rows = rows.filter((r) => r.customer === this.filterCustomer);
    }
    return [...rows].sort((a, b) => (this.sortCartonDesc ? b.carton - a.carton : a.carton - b.carton));
  }

  get totalCarton(): number {
    return this.displayRows.reduce((s, r) => s + (Number(r.carton) || 0), 0);
  }

  get totalQuantity(): number {
    return this.displayRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  }

  get totalKkChecked(): number {
    return this.displayRows.reduce((s, r) => s + (Number(r.kkChecked) || 0), 0);
  }

  get totalKkTotal(): number {
    return this.displayRows.reduce((s, r) => s + (Number(r.kkTotal) || 0), 0);
  }

  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) return '0';
    return value.toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  }

  formatKk(row: TpStockListRow): string {
    return `${row.kkChecked || 0}/${row.kkTotal || 0}`;
  }

  isKkComplete(row: TpStockListRow): boolean {
    return (row.kkTotal || 0) > 0 && row.kkChecked === row.kkTotal;
  }

  onFilterMaChange(value: string): void {
    this.filterMa = String(value || '').toUpperCase();
    this.cdr.markForCheck();
  }

  onFilterCustomerChange(value: string): void {
    this.filterCustomer = String(value || '').trim();
    this.cdr.markForCheck();
  }

  clearFilters(): void {
    this.filterMa = '';
    this.filterCustomer = '';
    this.cdr.markForCheck();
  }

  toggleCartonSort(): void {
    this.sortCartonDesc = !this.sortCartonDesc;
    this.cdr.markForCheck();
  }

  /** Gom carton theo khách (toàn bộ mã TP nhà máy đang chọn), sắp cao → thấp. */
  get customerCartonRows(): Array<{ customer: string; totalCarton: number; materialCount: number }> {
    const byCustomer = new Map<string, { totalCarton: number; materialCount: number }>();
    for (const row of this.allRows) {
      const customer = String(row.customer || '').trim() || 'Không xác định';
      const cur = byCustomer.get(customer) || { totalCarton: 0, materialCount: 0 };
      cur.totalCarton += Number(row.carton) || 0;
      cur.materialCount += 1;
      byCustomer.set(customer, cur);
    }
    return Array.from(byCustomer.entries())
      .map(([customer, v]) => ({
        customer,
        totalCarton: v.totalCarton,
        materialCount: v.materialCount
      }))
      .sort((a, b) => b.totalCarton - a.totalCarton || a.customer.localeCompare(b.customer, 'vi'));
  }

  get customerCartonTotal(): number {
    return this.customerCartonRows.reduce((s, r) => s + (Number(r.totalCarton) || 0), 0);
  }

  /** Danh mục mã hóa KH (lưu Firebase — mã cũ cố định). */
  getCustomerCode(customer: string): string {
    const code = this.customerLabelCodeService.getCode(customer);
    return code || '—';
  }

  async openCustomerCodeModal(): Promise<void> {
    await this.syncCustomerLabelCodes();
    this.showCustomerCodeModal = true;
    this.cdr.markForCheck();
  }

  closeCustomerCodeModal(): void {
    this.showCustomerCodeModal = false;
    this.cdr.markForCheck();
  }

  printCustomerCodeLabel(entry: CustomerCodeEntry): void {
    if (!printCustomerCodeLabels([entry])) {
      alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
    }
  }

  printCustomerCodeByName(customer: string): void {
    const entry = this.customerCodeCatalog.find((e) => e.customer === String(customer || '').trim());
    if (!entry) return;
    this.printCustomerCodeLabel(entry);
  }

  printAllCustomerCodeLabels(): void {
    const list = this.customerCodeCatalog;
    if (!list.length) {
      alert('Không có khách hàng để in tem.');
      return;
    }
    if (!printCustomerCodeLabels(list)) {
      alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
    }
  }

  openCustomerCartonModal(): void {
    this.showCustomerCartonModal = true;
    this.cdr.markForCheck();
  }

  closeCustomerCartonModal(): void {
    this.showCustomerCartonModal = false;
    this.cdr.markForCheck();
  }

  /** Sơ đồ lưu trữ — phân bổ carton theo quy tắc kệ A/B/C. */
  get storageZones(): StorageZoneView[] {
    return buildStorageZones(this.allRows);
  }

  get storageCartonRows(): Array<{ customer: string; carton: number }> {
    return this.allRows.map((r) => ({ customer: r.customer, carton: r.carton }));
  }

  openStorageDiagramModal(): void {
    this.showStorageDiagramModal = true;
    this.cdr.markForCheck();
  }

  closeStorageDiagramModal(): void {
    this.showStorageDiagramModal = false;
    this.cdr.markForCheck();
  }

  async onStorageMoved(): Promise<void> {
    await this.loadData();
  }

  shortKh(name: string): string {
    return shortStorageCustomerLabel(name);
  }

  async runStorageLocationCheck(): Promise<void> {
    this.isStorageChecking = true;
    this.storageCheckResult = null;
    this.showStorageCheckModal = true;
    this.cdr.markForCheck();

    try {
      if (!this.inventoryDetailLines.length && !this.isLoading) {
        await this.loadData();
      }
      this.storageCheckResult = checkStorageLocations(this.inventoryDetailLines);
    } catch (e) {
      console.error('runStorageLocationCheck failed', e);
      this.storageCheckResult = {
        scannedLines: 0,
        scannedSlots: 0,
        wrongSlotCount: 0,
        issues: []
      };
    } finally {
      this.isStorageChecking = false;
      this.cdr.markForCheck();
    }
  }

  closeStorageCheckModal(): void {
    this.showStorageCheckModal = false;
    this.cdr.markForCheck();
  }

  storageIssueLabel(type: string): string {
    switch (type) {
      case 'multi_customer':
        return '2+ khách / mâm';
      case 'wrong_zone':
        return 'Sai khu kệ';
      case 'invalid_location':
        return 'Vị trí không hợp lệ';
      case 'unknown_rack':
        return 'Kệ không có trên sơ đồ';
      default:
        return type;
    }
  }

  /** Ưu tiên Lượng Đóng Thùng; không có thì Standard danh mục TP. */
  private getPackingQty(materialCode: string): number {
    const code7 = String(materialCode || '').trim().toUpperCase().slice(0, 7);
    if (!code7) return 0;
    const override = this.packingQtyMap.get(code7);
    if (override && override > 0) return override;
    const catalogItem = this.catalogItems.find(
      (c) => (c.materialCode || '').trim().toUpperCase().slice(0, 7) === code7
    );
    const standard = catalogItem ? parseFloat(String(catalogItem.standard)) : NaN;
    return !isNaN(standard) && standard > 0 ? standard : 0;
  }

  private getCustomerName(materialCode: string): string {
    const code7 = String(materialCode || '').trim().toUpperCase().slice(0, 7);
    if (!code7) return '';
    const catalogItem = this.catalogItems.find(
      (c) => (c.materialCode || '').trim().toUpperCase().slice(0, 7) === code7
    );
    return catalogItem ? catalogItem.customer || '' : '';
  }
}
