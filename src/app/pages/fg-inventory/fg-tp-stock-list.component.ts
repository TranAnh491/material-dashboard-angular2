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
  readonly factoryOptions = ['ASM1', 'ASM2', 'TOTAL'];

  isLoading = false;
  catalogItems: ProductCatalogItem[] = [];
  private packingQtyMap = new Map<string, number>();

  allRows: TpStockListRow[] = [];
  filterMa = '';
  filterCustomer = '';
  sortCartonDesc = true;

  showCustomerCartonModal = false;

  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private readTracker: ReadTrackerService,
    private tpCatalogService: TpCatalogFullService,
    private cartonPackingQtyService: CartonPackingQtyService
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
        // Reload nếu data đã về trước catalog — tính lại carton
        if (this.allRows.length) {
          void this.loadData();
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
    this.router.navigate(['/fg-inventory'], {
      queryParams: { factory: this.selectedFactory }
    });
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  selectMaterial(materialCode: string): void {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code) return;
    this.router.navigate(['/fg-inventory'], {
      queryParams: { maTp: code, factory: this.selectedFactory }
    });
  }

  async loadData(): Promise<void> {
    this.isLoading = true;
    this.allRows = [];
    this.filterMa = '';
    this.filterCustomer = '';
    this.cdr.markForCheck();

    try {
      const snap = await this.firestore
        .collection('fg-inventory', (ref) => {
          let q: firebase.firestore.Query = ref;
          if (this.selectedFactory && this.selectedFactory !== 'TOTAL') {
            q = q.where('factory', '==', this.selectedFactory);
          }
          return q.limit(5000);
        })
        .get()
        .toPromise();

      this.readTracker.track('fg-inventory', 'fg-inventory-tp-stock-list', snap?.docs.length || 0);

      const byCode = new Map<string, { quantity: number; carton: number; kkChecked: number; kkTotal: number }>();
      (snap?.docs || []).forEach((doc) => {
        const data = doc.data() as any;
        const ton = Number(data.ton ?? data.stock ?? 0);
        if (ton <= 0) return;
        const code = String(data.materialCode || data.maTP || '').trim().toUpperCase().slice(0, 7);
        if (!code) return;
        const cur = byCode.get(code) || { quantity: 0, carton: 0, kkChecked: 0, kkTotal: 0 };
        cur.quantity += ton;
        // Tồn > 0 & < lượng đóng thùng → 1 carton (Math.ceil), không dùng carton đã lưu (có thể floor = 0)
        const per = this.getPackingQty(code);
        const computed = CartonPackingQtyService.computeCartonOdd(ton, per);
        cur.carton += per > 0 ? computed.carton : Number(data.carton || 0);
        cur.kkTotal += 1;
        if (String(data.viTriKK || data.locationKK || '').trim()) {
          cur.kkChecked += 1;
        }
        byCode.set(code, cur);
      });

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

  openCustomerCartonModal(): void {
    this.showCustomerCartonModal = true;
    this.cdr.markForCheck();
  }

  closeCustomerCartonModal(): void {
    this.showCustomerCartonModal = false;
    this.cdr.markForCheck();
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
