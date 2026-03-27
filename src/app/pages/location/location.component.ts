import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { Subject, BehaviorSubject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { trigger, state, style, transition, animate } from '@angular/animations';

export interface LocationItem {
  id?: string;
  stt: number;
  viTri: string;
  qrCode: string;
  printCount?: number; // Số lần in (Lần in)
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCode {
  id?: string;
  no: number;
  customer: string;
  group: string;
  code: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FGLocation {
  id?: string;
  stt: number;
  viTri: string;
  qrCode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface LocationRule {
  id?: string;
  factory: 'ASM1' | 'ASM2';
  materialCode: string;
  destinationLocationPrefixes: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-location',
  templateUrl: './location.component.html',
  styleUrls: ['./location.component.scss'],
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateX(0)', opacity: 1 }))
      ])
    ])
  ]
})
export class LocationComponent implements OnInit, OnDestroy, AfterViewInit {
  // Data properties
  locationItems: LocationItem[] = [];
  filteredItems: LocationItem[] = [];
  /** Lookup inventory items by scanned/typed location */
  locationLookupLocation = '';
  locationLookupItems: { id: string; materialCode: string; poNumber?: string; stock?: number }[] = [];
  isLocationLookupLoading = false;
  private locationLookupSeq = 0;
  
  // Loading state
  isLoading = false;
  
  // Search and filter
  searchTerm = '';
  /** Lọc theo từng cột */
  filterByStt = '';
  filterByViTri = '';
  filterByPrintCount = '';
  private searchSubject = new Subject<string>();
  
  // Total counter
  private totalCountSubject = new BehaviorSubject<number>(0);
  public totalCount$ = this.totalCountSubject.asObservable();
  
  // Permission
  canDelete = false;
  
  // Dropdown state
  isDropdownOpen = false;

  // Factory selection (ASM1/ASM2) - required before using Location tab features
  showFactorySelect = true;
  selectedFactory: 'ASM1' | 'ASM2' | null = null;
  
  // New item form
  newItem: Partial<LocationItem> = {
    stt: 0,
    viTri: '',
    qrCode: ''
  };
  
  // Auto STT counter
  nextStt = 1;

  selectFactory(factory: 'ASM1' | 'ASM2') {
    this.selectedFactory = factory;
    this.showFactorySelect = false;
    // Clear lookup state when switching factory
    this.clearLocationLookup();
    this.setupRulesListener();
    this.applyFilters();
  }
  
  // Edit mode
  editingItem: LocationItem | null = null;

  // Multi-select for batch delete
  selectedLocationIds = new Set<string>();
  
  // Store Material Modal (Cất NVL)
  showStoreMaterialModal = false;
  storeMaterialQRInput = '';
  scannedMaterialCodeForStore = '';
  foundMaterialsForStore: any[] = []; // Các materials tìm được theo materialCode
  selectedMaterialForStore: any = null; // Material được chọn để cất
  suggestedLocations: string[] = []; // Danh sách vị trí hiện tại của material
  selectedTargetLocation = ''; // Vị trí đích được chọn
  isSearchingMaterial = false;
  storeMaterialStep: 'scan' | 'select' | 'choose-location' | 'confirm' = 'scan';
  /** Tồn kho của PO được scan (cùng materialCode + poNumber) */
  storeMaterialPOStock: number = 0;
  /** Tồn kho theo từng vị trí (cùng materialCode), dùng để hiển thị khi scan */
  storeMaterialStockByLocation: { location: string; stock: number }[] = [];
  
  // FG Location Modal
  showFGModal = false;
  fgLocations: FGLocation[] = [];
  filteredFGLocations: FGLocation[] = [];
  fgSearchTerm = '';
  
  // Customer Codes
  customerCodes: CustomerCode[] = [];
  filteredCustomerCodes: CustomerCode[] = [];
  customerSearchTerm = '';
  showCustomerModal = false;

  // Rule (materialCode prefix 4 or exact 7 -> allowed destination location prefixes)
  showRuleModal = false;
  ruleMaterialCodeInput = '';
  ruleDestinationLocationInput = '';
  rules: LocationRule[] = [];
  rulesLoadError = '';
  isTargetLocationForced = false;
  forcedAllowedDestinationPrefixes: string[] = [];
  private rulesSub?: Subscription;

  /**
   * Chuẩn hoá mã nguyên liệu:
   * - Xoá whitespace, uppercase
   * - Cắt tối đa 7 ký tự (scanner/QR đang lấy 7 ký tự đầu)
   *
   * Lưu ý: matching rule sẽ dựa trên độ dài key (4 hoặc 7).
   */
  private normalizeMaterialCodeForRule(code: string): string {
    return (code || '').replace(/\s/g, '').toUpperCase().substring(0, 7);
  }

  openRuleModal(): void {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    this.showRuleModal = true;
    this.ruleMaterialCodeInput = '';
    this.ruleDestinationLocationInput = '';
  }

  closeRuleModal(): void {
    this.showRuleModal = false;
  }

  private setupRulesListener(): void {
    if (!this.selectedFactory) {
      this.rules = [];
      this.rulesLoadError = '';
      return;
    }
    this.rulesSub?.unsubscribe();
    this.rulesLoadError = '';
    this.rulesSub = this.firestore
      .collection<LocationRule>('location-rules', ref =>
        // Avoid composite index requirement (factory + orderBy materialCode)
        ref.where('factory', '==', this.selectedFactory)
      )
      .valueChanges({ idField: 'id' })
      .pipe(takeUntil(this.destroy$))
      .subscribe((items: any[]) => {
        this.rules = (items || [])
          .filter(r => r && typeof r.materialCode === 'string')
          .map((r: any) => ({
            id: r.id,
            factory: r.factory,
            materialCode: this.normalizeMaterialCodeForRule(r.materialCode || ''),
            destinationLocationPrefixes: Array.isArray(r.destinationLocationPrefixes)
              ? r.destinationLocationPrefixes
                  .map((p: any) => this.formatViTriInput(String(p || '')))
                  .filter((p: string) => !!p && this.validateViTriInput(p))
              : [],
          }))
          .filter(r => r.materialCode && r.destinationLocationPrefixes.length > 0)
          .sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
      }, (err: any) => {
        console.error('❌ Cannot load location-rules:', err);
        this.rules = [];
        this.rulesLoadError = err?.message || String(err || 'Cannot load rules');
      });
  }

  async upsertRuleFromInputs(): Promise<void> {
    const cleaned = (this.ruleMaterialCodeInput || '').replace(/\s/g, '').toUpperCase();
    const normalized = this.normalizeMaterialCodeForRule(cleaned);
    // matching rule chỉ hỗ trợ key độ dài 4 hoặc 7
    const keyLen = normalized.length;
    const materialCode = normalized;
    const destinationPrefixes = (this.ruleDestinationLocationInput || '')
      .split(',')
      .map(s => this.formatViTriInput(s))
      .filter(s => s && this.validateViTriInput(s));

    if (!materialCode || (keyLen !== 4 && keyLen !== 7)) {
      alert('Vui lòng nhập mã nguyên liệu');
      return;
    }
    if (!destinationPrefixes || destinationPrefixes.length === 0) {
      alert('Vui lòng nhập danh sách prefix vị trí đích (ví dụ: H,J,K)');
      return;
    }

    if (!this.selectedFactory) {
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }

    const existing = this.rules.find(r => r.materialCode === materialCode);
    const payload = {
      factory: this.selectedFactory,
      materialCode,
      destinationLocationPrefixes: destinationPrefixes,
      updatedAt: new Date(),
    };

    if (existing?.id) {
      await this.firestore.collection('location-rules').doc(existing.id).update(payload);
    } else {
      await this.firestore.collection('location-rules').add({
        ...payload,
        createdAt: new Date(),
      });
    }

    // Nếu đang ở bước chọn vị trí cho modal cất -> ép theo rule vừa thêm
    this.applyLocationRuleToSelectedMaterial();

    alert('✅ Đã lưu rule');
    this.ruleMaterialCodeInput = '';
    this.ruleDestinationLocationInput = '';
  }

  async deleteRule(rule: { id?: string; materialCode: string; destinationLocationPrefixes: string[] }): Promise<void> {
    if (!rule?.materialCode) return;
    if (!confirm(`Xóa rule cho mã ${rule.materialCode}?`)) return;
    if (rule.id) {
      await this.firestore.collection('location-rules').doc(rule.id).delete();
    } else {
      // Fallback for legacy in-memory item without id
      this.rules = this.rules.filter(r => r.materialCode !== rule.materialCode);
    }
    this.applyLocationRuleToSelectedMaterial();
  }

  private applyLocationRuleToSelectedMaterial(): void {
    if (!this.selectedMaterialForStore) {
      this.isTargetLocationForced = false;
      this.forcedAllowedDestinationPrefixes = [];
      return;
    }

    const scannedCode7 = this.normalizeMaterialCodeForRule(this.selectedMaterialForStore.materialCode);

    // Ưu tiên exact match cho key 7 ký tự
    const exactRule = this.rules.find(
      r => r.materialCode.length === 7 && r.materialCode === scannedCode7
    );
    if (exactRule) {
      this.isTargetLocationForced = true;
      this.forcedAllowedDestinationPrefixes = exactRule.destinationLocationPrefixes || [];
      return;
    }

    // Nếu không có exact 7, áp dụng rule nhóm theo prefix (ưu tiên rule dài hơn)
    // - Rule dài 4 ký tự sẽ match theo 4 ký tự đầu
    // - Nếu có rule cũ dài <4 thì vẫn có thể match (tùy dữ liệu đã lưu)
    const prefixRules = this.rules
      .filter(r => r.materialCode.length < 7)
      .filter(r => scannedCode7.startsWith(r.materialCode));

    // Nếu có nhiều rule trùng prefix 4 (hiếm), lấy rule cụ thể nhất.
    // Hiện tại tất cả prefix rule đều dài 4, nhưng vẫn giữ sort để an toàn.
    const matchedRule = prefixRules.sort((a, b) => b.materialCode.length - a.materialCode.length)[0];
    this.isTargetLocationForced = !!matchedRule;
    this.forcedAllowedDestinationPrefixes = matchedRule?.destinationLocationPrefixes || [];

    if (this.isTargetLocationForced) {
      const allowedSuggested = this.suggestedLocations.filter(loc => this.isDestinationAllowed(loc));
      // "Ép" theo rule: chỉ giữ giá trị hợp lệ nếu đang chọn; còn lại chọn option phù hợp đầu tiên
      if (!this.selectedTargetLocation || !this.isDestinationAllowed(this.selectedTargetLocation)) {
        this.selectedTargetLocation = allowedSuggested[0] || '';
      }
    } else {
      this.forcedAllowedDestinationPrefixes = [];
    }
  }

  private findMatchedRuleFromList(materialCode: string): LocationRule | null {
    const scannedCode7 = this.normalizeMaterialCodeForRule(materialCode);
    const exactRule = this.rules.find(
      r => r.materialCode.length === 7 && r.materialCode === scannedCode7
    );
    if (exactRule) return exactRule;

    const prefixRules = this.rules
      .filter(r => r.materialCode.length < 7)
      .filter(r => scannedCode7.startsWith(r.materialCode))
      .sort((a, b) => b.materialCode.length - a.materialCode.length);

    return prefixRules[0] || null;
  }

  private async resolveMatchedRule(materialCode: string): Promise<LocationRule | null> {
    // 1) Try in-memory rules first
    const fromMemory = this.findMatchedRuleFromList(materialCode);
    if (fromMemory) return fromMemory;

    // 2) Fallback query from Firestore (avoid stale/late listener state)
    if (!this.selectedFactory) return null;
    const scannedCode7 = this.normalizeMaterialCodeForRule(materialCode);
    const prefix4 = scannedCode7.substring(0, 4);

    try {
      const snap = await this.firestore
        .collection<LocationRule>('location-rules', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', 'in', [scannedCode7, prefix4])
        )
        .get()
        .toPromise();

      const fetched: LocationRule[] = [];
      snap?.forEach(doc => {
        const d = doc.data() as any;
        fetched.push({
          id: doc.id,
          factory: d.factory,
          materialCode: this.normalizeMaterialCodeForRule(d.materialCode || ''),
          destinationLocationPrefixes: Array.isArray(d.destinationLocationPrefixes)
            ? d.destinationLocationPrefixes
                .map((p: any) => this.formatViTriInput(String(p || '')))
                .filter((p: string) => !!p && this.validateViTriInput(p))
            : [],
          createdAt: d.createdAt,
          updatedAt: d.updatedAt
        });
      });

      if (fetched.length > 0) {
        // merge lightweight cache update
        const map = new Map<string, LocationRule>();
        [...this.rules, ...fetched].forEach(r => map.set(`${r.factory}:${r.materialCode}`, r));
        this.rules = Array.from(map.values())
          .filter(r => r.factory === this.selectedFactory)
          .sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
      }

      return this.findMatchedRuleFromList(materialCode);
    } catch (e) {
      console.warn('resolveMatchedRule fallback failed:', e);
      return null;
    }
  }

  isDestinationAllowed(location: string): boolean {
    const formatted = this.formatViTriInput(location || '');
    if (!formatted) return false;
    if (!this.isTargetLocationForced) return true;
    return this.forcedAllowedDestinationPrefixes.some(prefix => formatted.startsWith(prefix));
  }

  // Dời Kệ (Move Shelf) Modal
  showMoveShelfModal = false;
  moveShelfStep: 'scan-location' | 'select-items' | 'scan-new-location' | 'complete' = 'scan-location';
  moveShelfCurrentLocation = '';
  moveShelfNewLocation = '';
  moveShelfItems: any[] = [];
  moveShelfSelectedItems: Set<string> = new Set();
  isMoveShelfLoading = false;
  
  // ==================== BULK CHANGE LOCATION (ASM1) ====================
  showBulkChangeLocationModal = false;
  bulkStep: 'scan-location' | 'select-items' | 'scan-targets' | 'complete' = 'scan-location';
  bulkScanLocationInput = '';
  bulkCurrentLocation = '';
  bulkItems: any[] = [];
  bulkSelectedItems: Set<string> = new Set();
  isBulkLoading = false;
  bulkNewLocationInput = '';
  bulkNewPalletInput = '';
  skipBulkNewLocation = false;
  skipBulkNewPallet = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private cdr: ChangeDetectorRef
  ) {
    // Setup search debouncing
    this.searchSubject.pipe(
      takeUntil(this.destroy$),
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(term => {
      this.performSearch(term);
    });
  }

  ngOnInit() {
    // Require choosing ASM1/ASM2 when opening Location tab
    this.showFactorySelect = true;
    this.selectedFactory = null;

    this.checkPermissions();
    this.loadLocationData();
    this.loadCustomerCodes();
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.rulesSub?.unsubscribe();
    
    // Remove event listeners
    document.removeEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  private async checkPermissions() {
    try {
      this.tabPermissionService.canAccessTab('location')
        .pipe(takeUntil(this.destroy$))
        .subscribe(canAccess => {
          this.canDelete = canAccess;
        });
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  }

  private async loadLocationData() {
    this.isLoading = true;
    try {
      this.firestore.collection('locations', ref => ref.orderBy('stt', 'asc'))
        .valueChanges({ idField: 'id' })
        .pipe(takeUntil(this.destroy$))
        .subscribe((items: any[]) => {
          this.locationItems = items;
          
          // Sort by Vị Trí (A,B,C) then by STT
          this.locationItems.sort((a, b) => {
            // First sort by Vị Trí alphabetically
            const viTriComparison = a.viTri.localeCompare(b.viTri);
            if (viTriComparison !== 0) return viTriComparison;
            // If Vị Trí is same, sort by STT
            return a.stt - b.stt;
          });
          
          // Reassign STT automatically starting from 1
          this.locationItems.forEach((item, index) => {
            item.stt = index + 1;
          });
          
          this.applyFilters();
          this.calculateNextStt();
          this.isLoading = false;
        });
    } catch (error) {
      console.error('Error loading location data:', error);
      this.isLoading = false;
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  private updateTotalCount() {
    this.totalCountSubject.next(this.filteredItems.length);
  }
  
  private calculateNextStt() {
    // STT sẽ luôn là số tiếp theo sau số cuối cùng
    this.nextStt = this.locationItems.length + 1;
  }

  onSearchInput(event: any) {
    const term = event.target.value;
    this.searchTerm = term;
    this.searchSubject.next(term);
  }

  onSearchKeyUp(event: any) {
    if (event.key === 'Enter') {
      this.performSearch(this.searchTerm);
    }
  }

  private applyFilters() {
    let items = [...this.locationItems];
    // Search filter (ô tìm kiếm chung - Vị Trí)
    if (this.searchTerm && this.searchTerm.trim().length >= 2) {
      const formattedTerm = this.formatViTriInput(this.searchTerm.trim());
      const searchLower = formattedTerm.toLowerCase();
      items = items.filter(item => item.viTri.toLowerCase().includes(searchLower));
      // Only lookup inventory after factory is chosen
      if (this.selectedFactory) this.lookupInventoryByLocation(formattedTerm);
    } else {
      this.clearLocationLookup();
    }
    // Lọc theo cột STT
    if (this.filterByStt.trim()) {
      const term = this.filterByStt.trim().toLowerCase();
      items = items.filter(item => String(item.stt).toLowerCase().includes(term));
    }
    // Lọc theo cột Vị Trí
    if (this.filterByViTri.trim()) {
      const term = this.filterByViTri.trim().toLowerCase();
      items = items.filter(item => item.viTri.toLowerCase().includes(term));
    }
    // Lọc theo cột Lần in
    if (this.filterByPrintCount.trim()) {
      const term = this.filterByPrintCount.trim();
      if (term === '>0' || term === '> 0') {
        items = items.filter(item => (item.printCount ?? 0) > 0);
      } else {
        const numStr = String(term);
        items = items.filter(item => String(item.printCount ?? 0).includes(numStr));
      }
    }
    this.filteredItems = items;
    this.updateTotalCount();
  }

  private performSearch(term: string) {
    this.applyFilters();
  }

  onColumnFilterChange() {
    this.applyFilters();
  }

  clearColumnFilters() {
    this.filterByStt = '';
    this.filterByViTri = '';
    this.filterByPrintCount = '';
    this.applyFilters();
  }

  clearSearch() {
    this.searchTerm = '';
    this.applyFilters();
  }

  private clearLocationLookup(): void {
    this.locationLookupLocation = '';
    this.locationLookupItems = [];
    this.isLocationLookupLoading = false;
  }

  private async lookupInventoryByLocation(locationTerm: string): Promise<void> {
    if (!this.selectedFactory) {
      this.clearLocationLookup();
      return;
    }
    // Only lookup when the location exists (avoid unnecessary queries on partial typing)
    const normalized = this.normalizeLocationCode(locationTerm);
    const matchedLocation = this.locationItems.find(
      l => this.normalizeLocationCode(l.viTri) === normalized
    )?.viTri;

    if (!matchedLocation) {
      this.clearLocationLookup();
      return;
    }

    const seq = ++this.locationLookupSeq;
    this.isLocationLookupLoading = true;
    this.locationLookupLocation = matchedLocation;
    this.locationLookupItems = [];

    try {
      const snapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory).where('location', '==', matchedLocation)
        )
        .get()
        .toPromise();

      // If a newer lookup started, ignore this result
      if (seq !== this.locationLookupSeq) return;

      const items: { id: string; materialCode: string; poNumber?: string; stock?: number }[] = [];
      snapshot?.forEach(doc => {
        const data = doc.data() as any;
        const openingStock = Number(data.openingStock) || 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const stock = openingStock + quantity - exported - xt;

        items.push({
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          stock
        });
      });

      items.sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
      this.locationLookupItems = items.filter(i => !!i.materialCode);
    } catch (error) {
      // Keep silent UI; do not alert on every keystroke
      console.error('❌ Error lookup inventory by location:', error);
      if (seq !== this.locationLookupSeq) return;
      this.locationLookupItems = [];
    } finally {
      if (seq === this.locationLookupSeq) {
        this.isLocationLookupLoading = false;
      }
    }
  }

  refreshData() {
    this.loadLocationData();
  }

  // Generate QR code based on location
  generateQRCode(viTri: string): string {
    if (!viTri) return '';
    // QR code chỉ chứa nội dung vị trí
    return viTri.toUpperCase();
  }

  // Normalize location code for duplicate checking
  // Q1.1(L) -> Q11L, Q-1-1-L -> Q11L
  normalizeLocationCode(viTri: string): string {
    if (!viTri) return '';
    
    // Convert to uppercase and remove all special characters (dots, hyphens, parentheses)
    return viTri.toUpperCase().replace(/[.\-()]/g, '');
  }

  // Format and validate viTri input
  formatViTriInput(input: string): string {
    if (!input) return '';
    
    // Remove all spaces and convert to uppercase
    let formatted = input.replace(/\s/g, '').toUpperCase();
    
    // Only allow letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    formatted = formatted.replace(/[^A-Z0-9.\-()]/g, '');
    
    return formatted;
  }

  // Validate viTri input
  validateViTriInput(input: string): boolean {
    if (!input) return false;
    
    // Check if contains only allowed characters: letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    const allowedPattern = /^[A-Z0-9.\-()]+$/;
    return allowedPattern.test(input);
  }

  // Handle viTri input change
  onViTriInputChange(event: any, isEditing: boolean = false) {
    const input = event.target.value;
    const formatted = this.formatViTriInput(input);
    
    if (isEditing && this.editingItem) {
      this.editingItem.viTri = formatted;
    } else {
      this.newItem.viTri = formatted;
    }
    
    // Update the input value to show formatted result
    event.target.value = formatted;
  }

  // Add new location item
  addLocationItem() {
    if (!this.newItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.newItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match)
    if (this.locationItems.find(item => item.viTri === this.newItem.viTri)) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.newItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.newItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
      return;
    }

    const newItem: Omit<LocationItem, 'id'> = {
      stt: this.nextStt, // Use auto-generated STT
      viTri: this.newItem.viTri!,
      qrCode: this.generateQRCode(this.newItem.viTri!),
      printCount: 0,
      createdAt: new Date()
    };

    this.firestore.collection('locations').add(newItem).then(() => {
      console.log('Added new location item');
      this.resetNewItemForm();
      this.refreshData();
    }).catch(error => {
      console.error('Error adding location item:', error);
    });
  }

  // Edit location item
  editLocationItem(item: LocationItem) {
    this.editingItem = { ...item };
  }

  // Save edited item
  saveEditedItem() {
    if (!this.editingItem) return;

    if (!this.editingItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.editingItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match, excluding current item)
    if (this.locationItems.find(item => 
      item.viTri === this.editingItem!.viTri && item.id !== this.editingItem!.id
    )) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.editingItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      if (item.id === this.editingItem!.id) return false; // Skip current item
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.editingItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
      return;
    }

    const updatedItem = {
      stt: this.editingItem.stt,
      viTri: this.editingItem.viTri,
      qrCode: this.generateQRCode(this.editingItem.viTri),
      updatedAt: new Date()
    };

    this.firestore.collection('locations').doc(this.editingItem.id!).update(updatedItem).then(() => {
      console.log('Updated location item');
      this.cancelEdit();
      this.refreshData();
    }).catch(error => {
      console.error('Error updating location item:', error);
    });
  }

  // Cancel edit
  cancelEdit() {
    this.editingItem = null;
  }

  // Reset new item form
  resetNewItemForm() {
    this.newItem = {
      viTri: '',
      qrCode: ''
    };
  }

  /** Lấy số box tiếp theo: BOX-0001 .. BOX-9999 */
  private getNextBoxNumber(): string {
    const boxRegex = /^BOX-(\d{1,4})$/i;
    let maxNum = 0;
    this.locationItems.forEach(item => {
      const m = item.viTri.match(boxRegex);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 9999) maxNum = Math.max(maxNum, n);
      }
    });
    const next = Math.min(maxNum + 1, 9999);
    return `BOX-${String(next).padStart(4, '0')}`;
  }

  /** Thêm BOX: tự tạo BOX-0001, BOX-0002, ... */
  addBoxItem() {
    const boxCode = this.getNextBoxNumber();

    if (this.locationItems.find(item => item.viTri === boxCode)) {
      alert(`Box ${boxCode} đã tồn tại. Vui lòng thử lại.`);
      return;
    }

    const newItem: Omit<LocationItem, 'id'> = {
      stt: this.nextStt,
      viTri: boxCode,
      qrCode: this.generateQRCode(boxCode),
      printCount: 0,
      createdAt: new Date()
    };

    this.firestore.collection('locations').add(newItem).then(() => {
      console.log('Added new box:', boxCode);
      this.refreshData();
    }).catch(error => {
      console.error('Error adding box:', error);
    });
  }

  // Delete location item
  deleteLocationItem(item: LocationItem) {
    if (confirm(`Bạn có chắc muốn xóa vị trí ${item.viTri}?`)) {
      this.firestore.collection('locations').doc(item.id!).delete().then(() => {
        console.log(`Deleted location item: ${item.viTri}`);
        this.refreshData();
      }).catch(error => {
        console.error('Error deleting location item:', error);
      });
    }
  }

  // Multi-select for batch delete
  isItemSelected(item: LocationItem): boolean {
    return item.id ? this.selectedLocationIds.has(item.id) : false;
  }

  isAllSelected(): boolean {
    if (this.filteredItems.length === 0) return false;
    return this.filteredItems.every(item => item.id && this.selectedLocationIds.has(item.id));
  }

  toggleSelectItem(item: LocationItem) {
    if (!item.id) return;
    if (this.selectedLocationIds.has(item.id)) {
      this.selectedLocationIds.delete(item.id);
    } else {
      this.selectedLocationIds.add(item.id);
    }
    this.selectedLocationIds = new Set(this.selectedLocationIds);
  }

  toggleSelectAll() {
    if (this.isAllSelected()) {
      this.filteredItems.forEach(item => {
        if (item.id) this.selectedLocationIds.delete(item.id);
      });
    } else {
      this.filteredItems.forEach(item => {
        if (item.id) this.selectedLocationIds.add(item.id);
      });
    }
    this.selectedLocationIds = new Set(this.selectedLocationIds);
  }

  deleteSelectedItems() {
    const ids = Array.from(this.selectedLocationIds);
    if (ids.length === 0) {
      alert('Chưa chọn dòng nào để xóa');
      return;
    }
    if (!confirm(`Bạn có chắc muốn xóa ${ids.length} vị trí đã chọn?`)) return;
    const batch = this.firestore.firestore.batch();
    ids.forEach(id => {
      batch.delete(this.firestore.collection('locations').doc(id).ref);
    });
    batch.commit().then(() => {
      this.selectedLocationIds = new Set();
      this.refreshData();
    }).catch(error => {
      console.error('Error deleting selected items:', error);
    });
  }

  // Export to Excel
  exportToExcel() {
    try {
      const exportData = this.filteredItems.map(item => ({
        'STT': item.stt,
        'Vị Trí': item.viTri,
        'QR Code': item.qrCode
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Data');
      
      XLSX.writeFile(wb, `Location_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
    }
  }

  // Initialize sample data
  initializeSampleData() {
    const sampleData: Omit<LocationItem, 'id'>[] = [
      { stt: 0, viTri: 'A1-01', qrCode: this.generateQRCode('A1-01'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'A1-02', qrCode: this.generateQRCode('A1-02'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'A2-01', qrCode: this.generateQRCode('A2-01'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'A2-02', qrCode: this.generateQRCode('A2-02'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'B1-01', qrCode: this.generateQRCode('B1-01'), printCount: 0, createdAt: new Date() }
    ];

    // Clear existing data first
    this.firestore.collection('locations').get().subscribe(snapshot => {
      const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      batch.commit().then(() => {
        // Add sample data
        const addBatch = this.firestore.firestore.batch();
        sampleData.forEach(item => {
          const docRef = this.firestore.collection('locations').doc().ref;
          addBatch.set(docRef, item);
        });
        
        addBatch.commit().then(() => {
          console.log('Sample data initialized');
          this.refreshData();
        });
      });
    });
  }

  // Import locations from file
  importLocations() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportFile(file);
      }
    };
    input.click();
  }

  // Process imported file
  // IMPORTANT: This function ADDS new data to existing data, does NOT replace/delete existing data
  private processImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('📋 Imported data:', jsonData);
        console.log('ℹ️ IMPORT MODE: Adding new data to existing data (not replacing)');
        
        // Skip header row (dòng 1) and process all data from row 2 onwards
        const locations = [];
        const normalizedCodes = new Set<string>(); // Track normalized codes to prevent duplicates
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row && row[0] && row[0].toString().trim()) {
            const viTri = row[0].toString().trim().toUpperCase();
            console.log(`📋 Processing row ${i + 1}: "${viTri}"`);
            
            if (this.validateViTriInput(viTri)) {
              const normalizedCode = this.normalizeLocationCode(viTri);
              
              // Check for duplicates within import data
              if (normalizedCodes.has(normalizedCode)) {
                console.log(`❌ Duplicate in import data: ${viTri} (normalized: ${normalizedCode})`);
                continue;
              }
              
              // Check for duplicates with existing data
              const existingDuplicate = this.locationItems.find(item => {
                const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
                return normalizedExistingViTri === normalizedCode;
              });
              
              if (existingDuplicate) {
                console.log(`❌ Duplicate with existing: ${viTri} vs ${existingDuplicate.viTri} (both normalized to: ${normalizedCode})`);
                continue;
              }
              
              normalizedCodes.add(normalizedCode);
              locations.push({
                stt: 0, // Will be auto-assigned
                viTri: viTri,
                qrCode: this.generateQRCode(viTri),
                printCount: 0,
                createdAt: new Date()
              });
              console.log(`✅ Valid location added: ${viTri} (normalized: ${normalizedCode})`);
            } else {
              console.log(`❌ Invalid location format: ${viTri}`);
            }
          } else {
            console.log(`⚠️ Empty row ${i + 1}, skipping`);
          }
        }
        
        console.log(`📊 Total valid locations found: ${locations.length}`);
        
        if (locations.length > 0) {
          this.saveImportedLocations(locations);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ để import. Vui lòng kiểm tra:\n- Dòng 1 phải là tiêu đề "Vị trí"\n- Từ dòng 2 trở đi phải có dữ liệu vị trí\n- Định dạng vị trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
        }
      } catch (error) {
        console.error('Error processing file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Save imported locations to database
  // IMPORTANT: This function ADDS new locations to existing data, does NOT replace existing data
  private saveImportedLocations(locations: Omit<LocationItem, 'id'>[]) {
    const batch = this.firestore.firestore.batch();
    
    // Add each new location as a new document (preserves existing data)
    locations.forEach(location => {
      const docRef = this.firestore.collection('locations').doc().ref;
      batch.set(docRef, location); // This ADDS new data, doesn't replace
    });
    
    batch.commit().then(() => {
      console.log(`✅ Imported ${locations.length} new locations (added to existing data)`);
      this.refreshData();
      alert(`✅ Đã import thành công ${locations.length} vị trí mới!\n\n📝 Lưu ý: Dữ liệu mới được THÊM VÀO dữ liệu cũ, không thay thế dữ liệu cũ.`);
    }).catch(error => {
      console.error('Error importing locations:', error);
      alert('Lỗi khi import dữ liệu. Vui lòng thử lại.');
    });
  }

  // Download template file
  downloadTemplate() {
    try {
      const templateData = [
        ['Vị trí'], // Tiêu đề cột
        ['A1-01'],  // Dòng 2 - sẽ được import
        ['A1-02'],  // Dòng 3 - sẽ được import
        ['A2-01'],  // Dòng 4 - sẽ được import
        ['A2-02'],  // Dòng 5 - sẽ được import
        ['B1-01'],  // Dòng 6 - sẽ được import
        ['B1-02'],  // Dòng 7 - sẽ được import
        ['B2-01'],  // Dòng 8 - sẽ được import
        ['C1-01'],  // Dòng 9 - sẽ được import
        ['C1-02'],  // Dòng 10 - sẽ được import
        ['D1.01'],  // Dòng 11 - ví dụ với dấu chấm
        ['D1.02'],  // Dòng 12 - ví dụ với dấu chấm
        ['E1(01)'], // Dòng 13 - ví dụ với dấu ngoặc đơn
        ['E1(02)'], // Dòng 14 - ví dụ với dấu ngoặc đơn
        ['F1-01.02'], // Dòng 15 - ví dụ kết hợp dấu gạch ngang và chấm
        ['G1(01)-02'] // Dòng 16 - ví dụ kết hợp dấu ngoặc đơn và gạch ngang
      ];

      const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Template');
      
      XLSX.writeFile(wb, 'Location_Template.xlsx');
    } catch (error) {
      console.error('Error creating template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  // Delete all locations
  deleteAllLocations() {
    if (confirm('Bạn có chắc muốn xóa TẤT CẢ vị trí? Hành động này không thể hoàn tác!')) {
      this.firestore.collection('locations').get().subscribe(snapshot => {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batch.commit().then(() => {
          console.log('All locations deleted');
          this.refreshData();
          alert('Đã xóa tất cả vị trí');
        }).catch(error => {
          console.error('Error deleting all locations:', error);
          alert('Lỗi khi xóa dữ liệu. Vui lòng thử lại.');
        });
      });
    }
  }

    // Print QR Code - Tem 50mm x 30mm
  async printQRCode(item: LocationItem) {
    try {
      // Tăng lần in và lưu vào Firestore
      const newPrintCount = (item.printCount ?? 0) + 1;
      if (item.id) {
        this.firestore.collection('locations').doc(item.id).update({ printCount: newPrintCount }).catch(err => console.error('Error updating printCount:', err));
      }
      item.printCount = newPrintCount;

      // Tạo mã QR thực sự từ vị trí
      const qrImage = await QRCode.toDataURL(item.viTri, {
        width: 200, // 200px để đảm bảo chất lượng khi in
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Tạo nội dung để in QR code với kích thước 50mm x 30mm
      const printContent = `
        <div class="qr-label" style="
          width: 50mm; 
          height: 30mm; 
          border: 1px solid #000; 
          display: flex; 
          align-items: center; 
          padding: 2mm;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
          background: white;
        ">
          <!-- Phía trái: Mã QR 25mm x 25mm -->
          <div class="qr-section" style="
            width: 25mm; 
            height: 25mm; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            border: 1px solid #ccc;
            background: #f8f9fa;
            overflow: hidden;
          ">
            <img src="${qrImage}" 
                 alt="QR Code for ${item.viTri}" 
                 style="
                   width: 100%; 
                   height: 100%; 
                   object-fit: contain;
                   max-width: 23mm;
                   max-height: 23mm;
                 "
                 title="QR Code: ${item.viTri}">
          </div>
          
          <!-- Phía phải: Tên vị trí -->
          <div class="location-section" style="
            width: 20mm; 
            height: 25mm; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding-left: 2mm;
          ">
            <div style="
              font-size: 14px; 
              font-weight: bold; 
              color: #000;
              font-family: 'Arial', sans-serif;
              text-align: center;
              line-height: 1.2;
              word-break: break-word;
            ">
              ${item.viTri}
            </div>
          </div>
        </div>
      `;
    
          const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Location QR Code - ${item.viTri}</title>
              <style>
                body { 
                  margin: 0; 
                  padding: 10mm; 
                  font-family: Arial, sans-serif; 
                  background: #f0f0f0;
                }
                
                .qr-label {
                  margin: 0 auto;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                
                @media print {
                  body { 
                    margin: 0; 
                    padding: 0; 
                    background: white;
                  }
                  .no-print { display: none; }
                  .qr-label {
                    box-shadow: none;
                    border: 1px solid #000 !important;
                  }
                }
              </style>
            </head>
            <body>
              ${printContent}
              <div class="no-print" style="margin-top: 20px; text-align: center;">
                <button onclick="window.print()" style="
                  background: #007bff; 
                  color: white; 
                  border: none; 
                  padding: 10px 20px; 
                  border-radius: 5px; 
                  cursor: pointer;
                  margin-right: 10px;
                ">Print QR Code</button>
                <button onclick="window.close()" style="
                  background: #6c757d; 
                  color: white; 
                  border: none; 
                  padding: 10px 20px; 
                  border-radius: 5px; 
                  cursor: pointer;
                ">Close</button>
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    } catch (error) {
      console.error('Error generating QR code:', error);
      alert('Lỗi khi tạo mã QR. Vui lòng thử lại.');
    }
  }

  trackByFn(index: number, item: LocationItem): string {
    return item.id || index.toString();
  }

  trackByRule(index: number, item: { materialCode: string }): string {
    return item.materialCode || index.toString();
  }

  trackByFG(index: number, item: FGLocation): string {
    return item.id || index.toString();
  }

  // Store Material (Cất NVL) Functions
  openStoreMaterialModal(): void {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    this.showStoreMaterialModal = true;
    this.storeMaterialStep = 'scan';
    this.storeMaterialQRInput = '';
    this.scannedMaterialCodeForStore = '';
    this.foundMaterialsForStore = [];
    this.selectedMaterialForStore = null;
    this.suggestedLocations = [];
    this.selectedTargetLocation = '';
    this.isTargetLocationForced = false;
    this.forcedAllowedDestinationPrefixes = [];
    this.isSearchingMaterial = false;
    this.storeMaterialPOStock = 0;
    this.storeMaterialStockByLocation = [];
    
    // Force change detection để đảm bảo modal đã render
    this.cdr.detectChanges();
    
    // Auto focus vào input sau khi modal mở
    setTimeout(() => {
      const input = document.getElementById('storeMaterialQRInput') as HTMLInputElement;
      if (input) {
        input.focus();
        // Không select() để người dùng có thể scan ngay
        console.log('✅ Input focused for store material');
      } else {
        console.log('⚠️ Input not found, retrying...');
        // Retry sau 200ms nếu chưa tìm thấy
        setTimeout(() => {
          const retryInput = document.getElementById('storeMaterialQRInput') as HTMLInputElement;
          if (retryInput) {
            retryInput.focus();
            console.log('✅ Input focused on retry');
          }
        }, 200);
      }
    }, 150);
  }

  closeStoreMaterialModal(): void {
    this.showStoreMaterialModal = false;
    this.storeMaterialStep = 'scan';
    this.storeMaterialQRInput = '';
    this.scannedMaterialCodeForStore = '';
    this.foundMaterialsForStore = [];
    this.selectedMaterialForStore = null;
    this.suggestedLocations = [];
    this.selectedTargetLocation = '';
    this.isTargetLocationForced = false;
    this.forcedAllowedDestinationPrefixes = [];
    this.isSearchingMaterial = false;
    this.storeMaterialPOStock = 0;
    this.storeMaterialStockByLocation = [];
  }

  async processStoreMaterialQR(): Promise<void> {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    const qrCode = this.storeMaterialQRInput.trim();
    if (!qrCode) {
      alert('⚠️ Vui lòng nhập hoặc scan mã QR');
      return;
    }

    this.isSearchingMaterial = true;
    this.scannedMaterialCodeForStore = qrCode;

    try {
      // Parse QR code: MaterialCode|PO|Quantity|Date
      const parts = qrCode.split('|');
      let materialCode = '';
      let poNumber = '';
      let imd = '';

      if (parts.length >= 2) {
        materialCode = parts[0].trim().substring(0, 7); // Lấy 7 ký tự đầu
        poNumber = parts[1].trim(); // PO number
        if (parts.length >= 4) {
          imd = parts[3].trim(); // IMD (DDMMYYYY)
        }
      } else if (parts.length >= 1) {
        materialCode = parts[0].trim().substring(0, 7);
        if (parts.length >= 4) {
          imd = parts[3].trim();
        }
      } else {
        materialCode = qrCode.trim().substring(0, 7);
      }

      if (!materialCode) {
        alert('❌ Không thể đọc mã hàng từ QR code');
        this.isSearchingMaterial = false;
        return;
      }

      console.log(`🔍 Searching for material: ${materialCode}, PO: ${poNumber || 'N/A'}, IMD: ${imd || 'N/A'}`);

      const toDDMMYYYY = (dateValue: any): string => {
        if (!dateValue) return '';
        try {
          const d: Date =
            typeof dateValue?.toDate === 'function' ? dateValue.toDate() : new Date(dateValue);
          if (Number.isNaN(d.getTime())) return '';
          return d.toLocaleDateString('en-GB').split('/').join('');
        } catch {
          return '';
        }
      };

      // Tìm tất cả materials có materialCode này trong inventory-materials (để lấy các vị trí khác)
      const allMaterialsSnapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', '==', materialCode)
        )
        .get()
        .toPromise();

      if (!allMaterialsSnapshot || allMaterialsSnapshot.empty) {
        alert(`❌ Không tìm thấy material với mã: ${materialCode}`);
        this.isSearchingMaterial = false;
        return;
      }

      // Lấy tất cả materials để tìm các vị trí khác (nhưng chỉ gom "đúng bản ghi" theo Mã + PO + IMD khi có)
      const relevantMaterials: any[] = [];
      const locationSet = new Set<string>();
      let matchedMaterial: any = null;

      allMaterialsSnapshot.forEach(doc => {
        const data = doc.data() as any;
        
        // Tính stock đúng cách: openingStock + quantity - exported - xt
        const openingStockValue = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const calculatedStock = openingStockValue + quantity - exported - xt;
        
        const importDateStr = toDDMMYYYY(data.importDate);
        const material = {
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          location: data.location || '',
          stock: calculatedStock,
          openingStock: data.openingStock,
          quantity: quantity,
          exported: exported,
          xt: xt,
          batchNumber: data.batchNumber || '',
          importDate: data.importDate,
          importDateStr
        };

        const matchesMaterialCode = material.materialCode === materialCode;
        const matchesPO = !poNumber || material.poNumber === poNumber;

        // Yêu cầu: chỉ cần gom theo Mã nguyên liệu + PO để ra đúng vị trí.
        // IMD là duy nhất nên không cần lọc thêm khi hiển thị danh sách vị trí.
        if (matchesMaterialCode && matchesPO) {
          relevantMaterials.push(material);

          if (material.location && material.location.trim() !== '') {
            locationSet.add(material.location);
          }

          // Lấy bản ghi đầu tiên khớp để làm "material được scan"
          if (!matchedMaterial) {
            matchedMaterial = material;
          }
        }
      });

      // Nếu không tìm thấy material khớp chính xác, lấy material đầu tiên
      if (!matchedMaterial) {
        // Theo yêu cầu: tìm theo Mã + PO
        if (!poNumber) {
          alert(`❌ Không tìm thấy material khớp với QR code (Mã: ${materialCode})`);
        } else {
          alert(`❌ Không tìm thấy material đúng theo Mã + PO.\n\nMã: ${materialCode}\nPO: ${poNumber}`);
        }
        this.isSearchingMaterial = false;
        return;
      }

      // Chỉ hiển thị material được scan (khớp với QR code)
      this.foundMaterialsForStore = [matchedMaterial];
      this.selectedMaterialForStore = matchedMaterial;

      // Tồn kho của PO được scan
      this.storeMaterialPOStock = matchedMaterial.stock ?? 0;

      // Tồn kho theo từng vị trí (theo đúng Mã + PO + IMD):
      const stockByLoc = new Map<string, number>();
      relevantMaterials.forEach(m => {
        const loc = (m.location || '').trim();
        if (!loc) return;
        const current = stockByLoc.get(loc) ?? 0;
        stockByLoc.set(loc, current + (m.stock ?? 0));
      });
      this.storeMaterialStockByLocation = Array.from(stockByLoc.entries())
        .map(([location, stock]) => ({ location, stock }))
        .sort((a, b) => a.location.localeCompare(b.location));

      // Danh sách vị trí hiện có của đúng bản ghi (Mã + PO + IMD)
      this.suggestedLocations = Array.from(locationSet).filter(loc => loc && loc.trim() !== '').sort();

      console.log(`✅ Found material: ${matchedMaterial.materialCode} (PO: ${matchedMaterial.poNumber}, IMD: ${matchedMaterial.importDateStr || 'N/A'})`);
      console.log(`📍 Material hiện tại ở vị trí: ${matchedMaterial.location || 'Chưa có'}`);
      console.log(`📍 Tất cả các vị trí hiện có của đúng bản ghi: ${this.suggestedLocations.join(', ') || 'Không có'}`);

      // Chuyển sang bước chọn vị trí
      this.storeMaterialStep = 'choose-location';
      
      // Clear và focus vào input để sẵn sàng scan/nhập vị trí mới
      this.selectedTargetLocation = '';
      this.applyLocationRuleToSelectedMaterial();
      this.storeMaterialQRInput = '';
      this.isSearchingMaterial = false;
      
      // Auto focus vào input vị trí sau khi modal render
      setTimeout(() => {
        const locationInput = document.querySelector('.location-input') as HTMLInputElement;
        if (locationInput) {
          locationInput.focus();
        }
      }, 200);
    } catch (error) {
      console.error('❌ Error searching material:', error);
      alert(`❌ Lỗi khi tìm kiếm material: ${error}`);
      this.isSearchingMaterial = false;
    }
  }

  selectMaterialForStore(material: any): void {
    this.selectedMaterialForStore = material;
    this.storeMaterialStep = 'choose-location';
  }

  async confirmStoreMaterial(): Promise<void> {
    if (!this.selectedMaterialForStore || !this.selectedTargetLocation) {
      alert('⚠️ Vui lòng chọn material và vị trí đích');
      return;
    }

    try {
      // Normalize and validate target location
      const targetFormatted = this.formatViTriInput(this.selectedTargetLocation);
      if (!targetFormatted || !this.validateViTriInput(targetFormatted)) {
        alert('⚠️ Vị trí đích không hợp lệ');
        return;
      }

      // Resolve rule again at confirm-time (strong guard)
      const matchedRule = await this.resolveMatchedRule(this.selectedMaterialForStore.materialCode || '');
      const requiredPrefixes = matchedRule?.destinationLocationPrefixes || [];
      this.isTargetLocationForced = requiredPrefixes.length > 0;
      this.forcedAllowedDestinationPrefixes = requiredPrefixes;

      // Apply rule constraint (prefix match)
      if (requiredPrefixes.length > 0) {
        const ok = requiredPrefixes.some(prefix =>
          targetFormatted.startsWith(prefix)
        );
        if (!ok) {
          alert(`⚠️ Theo rule, vị trí đích phải bắt đầu bằng: ${requiredPrefixes.join(', ')}`);
          return;
        }
      }

      this.selectedTargetLocation = targetFormatted;

      // Cập nhật location trong Firebase
      await this.firestore
        .collection('inventory-materials')
        .doc(this.selectedMaterialForStore.id)
        .update({
          location: this.selectedTargetLocation,
          lastModified: new Date(),
          modifiedBy: 'store-material-scanner'
        });

      alert(`✅ Đã cất material thành công!\n\n` +
            `Mã hàng: ${this.selectedMaterialForStore.materialCode}\n` +
            `PO: ${this.selectedMaterialForStore.poNumber}\n` +
            `Vị trí mới: ${this.selectedTargetLocation}`);

      // Đóng modal và reset
      this.closeStoreMaterialModal();
    } catch (error) {
      console.error('❌ Error storing material:', error);
      alert(`❌ Lỗi khi cất material: ${error}`);
    }
  }

  // ==================== CUSTOMER CODE METHODS ====================

  // Import Customer Codes
  importCustomerCodes() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportCustomerFile(file);
      }
    };
    input.click();
  }

  // Process imported customer file
  private processImportCustomerFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('📋 Imported customer data:', jsonData);
        console.log('ℹ️ IMPORT MODE: New codes will OVERWRITE existing codes');
        
        // Skip header row (row 1) and process all data from row 2 onwards
        const customers = [];
        const codes = new Set<string>(); // Track codes to prevent duplicates within import file
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row && row.length >= 4 && row[0] && row[0].toString().trim()) {
            const no = parseInt(row[0].toString().trim()) || i;
            const customer = row[1] ? row[1].toString().trim() : '';
            const group = row[2] ? row[2].toString().trim() : '';
            const code = row[3] ? row[3].toString().trim() : '';
            
            if (customer && code) {
              // Check for duplicates within import data only (use last occurrence)
              if (codes.has(code)) {
                console.log(`⚠️ Duplicate in import file: ${code} - Will use last occurrence`);
                // Remove previous entry with same code
                const existingIndex = customers.findIndex(c => c.code === code);
                if (existingIndex >= 0) {
                  customers.splice(existingIndex, 1);
                }
              }
              
              // Check if code exists in database
              const existingItem = this.customerCodes.find(item => item.code === code);
              if (existingItem) {
                console.log(`🔄 Code exists in database: ${code} - Will UPDATE`);
                customers.push({
                  id: existingItem.id, // Keep existing ID to update
                  no: no,
                  customer: customer,
                  group: group || '',
                  code: code,
                  updatedAt: new Date()
                });
              } else {
                console.log(`✅ New code: ${code} - Will ADD`);
                customers.push({
                  no: no,
                  customer: customer,
                  group: group || '',
                  code: code,
                  createdAt: new Date()
                });
              }
              
              codes.add(code);
            }
          }
        }
        
        console.log(`📊 Total valid customers: ${customers.length} (includes both new and updates)`);
        
        if (customers.length > 0) {
          this.saveImportedCustomerCodes(customers);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ để import. Vui lòng kiểm tra:\n- Dòng 1 phải là tiêu đề: No, Customer, Group, Code\n- Từ dòng 2 trở đi phải có dữ liệu đầy đủ');
        }
      } catch (error) {
        console.error('Error processing customer file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Save imported customer codes to database (ADD new or UPDATE existing)
  private saveImportedCustomerCodes(customers: any[]) {
    const batch = this.firestore.firestore.batch();
    let addCount = 0;
    let updateCount = 0;
    
    customers.forEach(customer => {
      if (customer.id) {
        // UPDATE existing document
        const docRef = this.firestore.collection('customer-codes').doc(customer.id).ref;
        const updateData = {
          no: customer.no,
          customer: customer.customer,
          group: customer.group,
          code: customer.code,
          updatedAt: new Date()
        };
        batch.update(docRef, updateData);
        updateCount++;
        console.log(`🔄 Updating: ${customer.code}`);
      } else {
        // ADD new document
        const docRef = this.firestore.collection('customer-codes').doc().ref;
        const newData = {
          no: customer.no,
          customer: customer.customer,
          group: customer.group,
          code: customer.code,
          createdAt: new Date()
        };
        batch.set(docRef, newData);
        addCount++;
        console.log(`➕ Adding: ${customer.code}`);
      }
    });
    
    batch.commit().then(() => {
      console.log(`✅ Import complete: ${addCount} added, ${updateCount} updated`);
      alert(`✅ Import thành công!\n- Thêm mới: ${addCount} mã\n- Cập nhật: ${updateCount} mã\n- Tổng: ${customers.length} mã`);
      this.loadCustomerCodes();
    }).catch(error => {
      console.error('Error importing customer codes:', error);
      alert('Lỗi khi import dữ liệu. Vui lòng thử lại.');
    });
  }

  // Delete single customer code
  deleteCustomerCode(customer: CustomerCode) {
    if (!confirm(`⚠️ Xóa mã khách hàng?\n\nCustomer: ${customer.customer}\nCode: ${customer.code}\n\nBạn có chắc muốn xóa?`)) {
      return;
    }

    if (!customer.id) {
      alert('❌ Không tìm thấy ID của mã khách hàng!');
      return;
    }

    this.firestore.collection('customer-codes').doc(customer.id).delete()
      .then(() => {
        console.log(`✅ Deleted customer code: ${customer.code}`);
        alert(`✅ Đã xóa mã khách hàng: ${customer.code}`);
        // Data will auto-reload via subscription in loadCustomerCodes()
      })
      .catch(error => {
        console.error('❌ Error deleting customer code:', error);
        alert('Lỗi khi xóa. Vui lòng thử lại.');
      });
  }

  // Load customer codes from database
  loadCustomerCodes() {
    this.firestore.collection('customer-codes', ref => ref.orderBy('no', 'asc'))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        this.customerCodes = actions.map(action => ({
          id: action.payload.doc.id,
          ...action.payload.doc.data() as CustomerCode
        }));
        // Cập nhật filteredCustomerCodes ngay sau khi load
        this.filteredCustomerCodes = [...this.customerCodes];
      });
  }

  // Download customer code template
  downloadCustomerTemplate() {
    try {
      const templateData = [
        ['No', 'Customer', 'Group', 'Code'], // Header row
        [1, 'Customer A', 'Group 1', 'CUST001'],
        [2, 'Customer B', 'Group 1', 'CUST002'],
        [3, 'Customer C', 'Group 2', 'CUST003'],
        [4, 'Customer D', 'Group 2', 'CUST004'],
        [5, 'Customer E', 'Group 3', 'CUST005']
      ];

      const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Customer Code Template');
      
      XLSX.writeFile(wb, 'Customer_Code_Template.xlsx');
    } catch (error) {
      console.error('Error creating customer template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  // ==================== FG LOCATION METHODS ====================

  // Open FG Location Modal
  openFGModal() {
    this.showFGModal = true;
    this.loadFGLocations();
    this.isDropdownOpen = false;
  }

  // Close FG Location Modal
  closeFGModal() {
    this.showFGModal = false;
    this.fgSearchTerm = '';
    this.filteredFGLocations = [...this.fgLocations];
  }

  // Load FG Locations from database
  loadFGLocations() {
    this.firestore.collection('fg-locations', ref => ref.orderBy('stt', 'asc'))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        this.fgLocations = actions.map(action => ({
          id: action.payload.doc.id,
          ...action.payload.doc.data() as FGLocation
        }));
        this.filteredFGLocations = [...this.fgLocations];
      });
  }

  // Search FG Locations
  onFGSearchInput(event: any) {
    const term = event.target.value.toLowerCase();
    this.fgSearchTerm = term;
    
    if (!term || term.trim().length < 1) {
      this.filteredFGLocations = [...this.fgLocations];
    } else {
      this.filteredFGLocations = this.fgLocations.filter(item => {
        return (
          item.stt.toString().includes(term) ||
          item.viTri.toLowerCase().includes(term) ||
          item.qrCode.toLowerCase().includes(term)
        );
      });
    }
  }

  // Clear FG Search
  clearFGSearch() {
    this.fgSearchTerm = '';
    this.filteredFGLocations = [...this.fgLocations];
  }

  // ==================== CUSTOMER MODAL METHODS ====================

  // Open Customer Modal
  openCustomerModal() {
    this.showCustomerModal = true;
    this.loadCustomerCodes();
  }

  // Close Customer Modal
  closeCustomerModal() {
    this.showCustomerModal = false;
    this.customerSearchTerm = '';
    this.filteredCustomerCodes = [...this.customerCodes];
  }

  // Search Customer Codes
  onCustomerSearchInput(event: any) {
    const term = event.target.value.toLowerCase();
    this.customerSearchTerm = term;
    
    if (!term || term.trim().length < 1) {
      this.filteredCustomerCodes = [...this.customerCodes];
    } else {
      this.filteredCustomerCodes = this.customerCodes.filter(item => {
        return (
          item.no.toString().includes(term) ||
          item.customer.toLowerCase().includes(term) ||
          item.group.toLowerCase().includes(term) ||
          item.code.toLowerCase().includes(term)
        );
      });
    }
  }

  // Clear Customer Search
  clearCustomerSearch() {
    this.customerSearchTerm = '';
    this.filteredCustomerCodes = [...this.customerCodes];
  }

  // ==================== MOVE SHELF (DỜI KỆ) METHODS ====================

  openMoveShelfModal(): void {
    this.showMoveShelfModal = true;
    this.moveShelfStep = 'scan-location';
    this.moveShelfCurrentLocation = '';
    this.moveShelfNewLocation = '';
    this.moveShelfItems = [];
    this.moveShelfSelectedItems = new Set();
    this.isMoveShelfLoading = false;
    
    // Auto focus input
    setTimeout(() => {
      const input = document.getElementById('moveShelfLocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  closeMoveShelfModal(): void {
    this.showMoveShelfModal = false;
    this.moveShelfStep = 'scan-location';
    this.moveShelfCurrentLocation = '';
    this.moveShelfNewLocation = '';
    this.moveShelfItems = [];
    this.moveShelfSelectedItems = new Set();
    this.isMoveShelfLoading = false;
  }

  // ==================== BULK CHANGE LOCATION (ASM1) METHODS ====================
  openBulkChangeLocationModal(): void {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    this.showBulkChangeLocationModal = true;
    this.bulkStep = 'scan-location';
    this.bulkScanLocationInput = '';
    this.bulkCurrentLocation = '';
    this.bulkItems = [];
    this.bulkSelectedItems = new Set();
    this.isBulkLoading = false;
    this.bulkNewLocationInput = '';
    this.bulkNewPalletInput = '';
    this.skipBulkNewLocation = false;
    this.skipBulkNewPallet = false;

    setTimeout(() => {
      const input = document.getElementById('bulkAsm1LocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  closeBulkChangeLocationModal(): void {
    this.showBulkChangeLocationModal = false;
    this.bulkStep = 'scan-location';
    this.bulkScanLocationInput = '';
    this.bulkCurrentLocation = '';
    this.bulkItems = [];
    this.bulkSelectedItems = new Set();
    this.isBulkLoading = false;
    this.bulkNewLocationInput = '';
    this.bulkNewPalletInput = '';
    this.skipBulkNewLocation = false;
    this.skipBulkNewPallet = false;
  }

  async processBulkAsm1Location(): Promise<void> {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    // Bulk ASM1: location có thể chứa prefix "IQC+" nên không dùng formatViTriInput (vì hàm đó loại bỏ dấu '+')
    const raw = (this.bulkScanLocationInput || '').trim();
    const loc = raw
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9.\-()+]/g, '');
    if (!loc) {
      alert(`⚠️ Vui lòng scan vị trí (${this.selectedFactory})`);
      return;
    }

    this.isBulkLoading = true;
    this.bulkCurrentLocation = loc;
    this.bulkItems = [];
    this.bulkSelectedItems.clear();

    try {
      const queryByLocation = async (location: string) => {
        return await this.firestore
          .collection('inventory-materials', ref =>
            ref.where('factory', '==', this.selectedFactory).where('location', '==', location)
          )
          .get()
          .toPromise();
      };

      let snapshot = await queryByLocation(loc);
      let usedLoc = loc;

      // Nếu scan dạng F1-0001..F1-9999 mà không có -> tự thử với IQC+F1-xxxx
      const f1Match = loc.match(/^F1-(\d{4})$/);
      if ((!snapshot || snapshot.empty) && f1Match) {
        const num = parseInt(f1Match[1], 10);
        if (num >= 1 && num <= 9999) {
          const iqcLoc = `IQC+${loc}`;
          const s2 = await queryByLocation(iqcLoc);
          if (s2 && !s2.empty) {
            snapshot = s2;
            usedLoc = iqcLoc;
          }
        }
      }

      if (!snapshot || snapshot.empty) {
        alert(`❌ Không tìm thấy mã hàng nào ở vị trí: ${loc}`);
        this.isBulkLoading = false;
        return;
      }

      // Nếu tìm thấy theo IQC+ thì hiển thị đúng vị trí đang dùng
      this.bulkCurrentLocation = usedLoc;

      const items: any[] = [];
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const openingStock = Number(data.openingStock) || 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const stock = openingStock + quantity - exported - xt;
        items.push({
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          stock,
          location: data.location || '',
          palletId: (data.palletId || '').toString().toUpperCase()
        });
      });

      items.sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
      this.bulkItems = items;
      this.bulkStep = 'select-items';
    } catch (error) {
      console.error(`❌ Error loading ${this.selectedFactory} items by location:`, error);
      alert('❌ Lỗi khi tải mã hàng theo vị trí. Vui lòng thử lại.');
    } finally {
      this.isBulkLoading = false;
    }
  }

  toggleBulkItem(itemId: string): void {
    if (this.bulkSelectedItems.has(itemId)) this.bulkSelectedItems.delete(itemId);
    else this.bulkSelectedItems.add(itemId);
  }

  bulkSelectAll(): void {
    if (this.bulkSelectedItems.size === this.bulkItems.length) {
      this.bulkSelectedItems.clear();
      return;
    }
    this.bulkItems.forEach(i => this.bulkSelectedItems.add(i.id));
  }

  isBulkItemSelected(itemId: string): boolean {
    return this.bulkSelectedItems.has(itemId);
  }

  proceedToBulkTargets(): void {
    if (this.bulkSelectedItems.size === 0) {
      alert('⚠️ Vui lòng chọn ít nhất 1 mã hàng');
      return;
    }
    this.bulkStep = 'scan-targets';
    this.bulkNewLocationInput = '';
    this.bulkNewPalletInput = '';
    this.skipBulkNewLocation = false;
    this.skipBulkNewPallet = false;

    setTimeout(() => {
      const input = document.getElementById('bulkAsm1NewLocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  canConfirmBulkTargets(): boolean {
    const locOk = this.skipBulkNewLocation || (this.bulkNewLocationInput || '').trim().length > 0;
    const palletOk = this.skipBulkNewPallet || (this.bulkNewPalletInput || '').trim().length > 0;
    const bothSkipped = this.skipBulkNewLocation && this.skipBulkNewPallet;
    return locOk && palletOk && !bothSkipped; // Ít nhất phải có vị trí hoặc pallet (không bỏ qua cả hai)
  }

  /** Focus vào ô scan pallet mới (sau khi scan xong vị trí hoặc bỏ qua vị trí). */
  focusBulkPalletInput(): void {
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = document.getElementById('bulkAsm1NewPalletInput') as HTMLInputElement;
      if (el) el.focus();
    }, 50);
  }

  /** Enter ở ô vị trí mới: nhảy sang ô scan pallet mới (không confirm ngay). */
  onBulkLocationEnter(): void {
    if (this.skipBulkNewPallet) {
      this.confirmBulkChange();
      return;
    }
    this.focusBulkPalletInput();
  }

  /** Bỏ qua vị trí mới được tick: nhảy focus sang ô pallet. */
  onSkipBulkLocationChange(): void {
    if (this.skipBulkNewLocation) this.focusBulkPalletInput();
  }

  async confirmBulkChange(): Promise<void> {
    if (!this.canConfirmBulkTargets()) {
      alert('⚠️ Vui lòng scan đủ thông tin hoặc tick bỏ qua.');
      return;
    }

    const newLocationRaw = this.skipBulkNewLocation
      ? ''
      : this.formatViTriInput((this.bulkNewLocationInput || '').trim().toUpperCase());
    const newPalletId = this.skipBulkNewPallet ? '' : (this.bulkNewPalletInput || '').trim().toUpperCase();

    if (!this.skipBulkNewLocation) {
      if (!this.validateViTriInput(newLocationRaw)) {
        alert('❌ Vị trí mới không hợp lệ');
        return;
      }
      const locationExists = this.locationItems.some(item =>
        this.normalizeLocationCode(item.viTri) === this.normalizeLocationCode(newLocationRaw)
      );
      if (!locationExists) {
        alert(`❌ Vị trí "${newLocationRaw}" không tồn tại trong danh sách vị trí`);
        return;
      }
    }

    // Khi scan cả vị trí và pallet: lưu location = "vị trí + pallet"
    const locationToSave = !this.skipBulkNewLocation && !this.skipBulkNewPallet && newLocationRaw && newPalletId
      ? `${newLocationRaw}-${newPalletId}`
      : !this.skipBulkNewLocation
        ? newLocationRaw
        : newPalletId;

    this.isBulkLoading = true;
    try {
      const batch = this.firestore.firestore.batch();
      const selectedIds = Array.from(this.bulkSelectedItems);

      for (const id of selectedIds) {
        const docRef = this.firestore.collection('inventory-materials').doc(id).ref;
        const updateData: any = {
          lastModified: new Date(),
          modifiedBy: `bulk-change-location-${(this.selectedFactory || 'unknown').toLowerCase()}`
        };
        if (!this.skipBulkNewLocation || !this.skipBulkNewPallet) {
          updateData.location = locationToSave;
          if (!this.skipBulkNewPallet) updateData.palletId = newPalletId;
        }
        batch.update(docRef, updateData);
      }

      await batch.commit();
      this.bulkStep = 'complete';
    } catch (error) {
      console.error('❌ Error bulk updating items:', error);
      alert('❌ Lỗi cập nhật vị trí/pallet. Vui lòng thử lại.');
    } finally {
      this.isBulkLoading = false;
    }
  }

  async processMoveShelfLocation(): Promise<void> {
    const location = this.moveShelfCurrentLocation.trim().toUpperCase();
    if (!location) {
      alert('⚠️ Vui lòng nhập hoặc scan vị trí');
      return;
    }

    this.isMoveShelfLoading = true;

    try {
      // Load all materials at this location from inventory-materials
      const snapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('location', '==', location)
        )
        .get()
        .toPromise();

      if (!snapshot || snapshot.empty) {
        alert(`❌ Không tìm thấy mã hàng nào ở vị trí: ${location}`);
        this.isMoveShelfLoading = false;
        return;
      }

      this.moveShelfItems = [];
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        // Calculate stock
        const openingStock = Number(data.openingStock) || 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const stock = openingStock + quantity - exported - xt;

        this.moveShelfItems.push({
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          location: data.location || '',
          stock: stock,
          batchNumber: data.batchNumber || ''
        });
      });

      // Sort by materialCode
      this.moveShelfItems.sort((a, b) => a.materialCode.localeCompare(b.materialCode));

      console.log(`✅ Found ${this.moveShelfItems.length} items at location: ${location}`);
      
      // Move to next step
      this.moveShelfStep = 'select-items';
      this.isMoveShelfLoading = false;

    } catch (error) {
      console.error('❌ Error loading items:', error);
      alert(`❌ Lỗi khi tải dữ liệu: ${error}`);
      this.isMoveShelfLoading = false;
    }
  }

  toggleMoveShelfItem(itemId: string): void {
    if (this.moveShelfSelectedItems.has(itemId)) {
      this.moveShelfSelectedItems.delete(itemId);
    } else {
      this.moveShelfSelectedItems.add(itemId);
    }
  }

  selectAllMoveShelfItems(): void {
    if (this.moveShelfSelectedItems.size === this.moveShelfItems.length) {
      // Deselect all
      this.moveShelfSelectedItems.clear();
    } else {
      // Select all
      this.moveShelfItems.forEach(item => {
        this.moveShelfSelectedItems.add(item.id);
      });
    }
  }

  isMoveShelfItemSelected(itemId: string): boolean {
    return this.moveShelfSelectedItems.has(itemId);
  }

  proceedToNewLocationScan(): void {
    if (this.moveShelfSelectedItems.size === 0) {
      alert('⚠️ Vui lòng chọn ít nhất 1 mã hàng');
      return;
    }
    
    this.moveShelfStep = 'scan-new-location';
    this.moveShelfNewLocation = '';
    
    // Auto focus input
    setTimeout(() => {
      const input = document.getElementById('moveShelfNewLocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  async confirmMoveShelf(): Promise<void> {
    const newLocation = this.moveShelfNewLocation.trim().toUpperCase();
    if (!newLocation) {
      alert('⚠️ Vui lòng nhập hoặc scan vị trí mới');
      return;
    }

    // Validate location format
    if (!this.validateViTriInput(newLocation)) {
      alert('❌ Vị trí không hợp lệ');
      return;
    }

    // Check if location exists
    const locationExists = this.locationItems.some(item =>
      this.normalizeLocationCode(item.viTri) === this.normalizeLocationCode(newLocation)
    );

    if (!locationExists) {
      alert(`❌ Vị trí "${newLocation}" không tồn tại trong danh sách vị trí`);
      return;
    }

    this.isMoveShelfLoading = true;

    try {
      const batch = this.firestore.firestore.batch();
      const selectedItemIds = Array.from(this.moveShelfSelectedItems);
      
      for (const itemId of selectedItemIds) {
        const docRef = this.firestore.collection('inventory-materials').doc(itemId).ref;
        batch.update(docRef, {
          location: newLocation,
          lastModified: new Date(),
          modifiedBy: 'move-shelf-scanner'
        });
      }

      await batch.commit();

      console.log(`✅ Moved ${selectedItemIds.length} items to ${newLocation}`);
      
      // Show success
      this.moveShelfStep = 'complete';
      this.isMoveShelfLoading = false;

      alert(`✅ Đã dời ${selectedItemIds.length} mã hàng từ ${this.moveShelfCurrentLocation} đến ${newLocation}`);
      
      // Close modal after short delay
      setTimeout(() => {
        this.closeMoveShelfModal();
      }, 500);

    } catch (error) {
      console.error('❌ Error moving items:', error);
      alert(`❌ Lỗi khi dời kệ: ${error}`);
      this.isMoveShelfLoading = false;
    }
  }

  goBackToSelectItems(): void {
    this.moveShelfStep = 'select-items';
    this.moveShelfNewLocation = '';
  }

  // Print Customer Label
  async printCustomerLabel(customer: CustomerCode) {
    try {
      // Tạo mã QR từ customer code với độ phân giải cao
      const qrImage = await QRCode.toDataURL(customer.code, {
        width: 800,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Tạo nội dung để in label với kích thước 100mm x 130mm
      // Code text ở trên, QR code ở dưới, mỗi phần chiếm 50% chiều cao
      // Cả tem quay 90 độ để hiển thị dọc
      const printContent = `
        <div class="customer-label" style="
          width: 100mm; 
          height: 130mm; 
          border: none; 
          display: flex; 
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 5mm;
          margin: 0;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
          background: white;
          position: relative;
        ">
          <!-- Code text - Flexible height -->
          <div class="code-section" style="
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            border: none;
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            overflow: visible;
          ">
            <div style="
              font-size: 96px; 
              font-weight: bold; 
              color: #000;
              font-family: 'Arial', sans-serif;
              letter-spacing: 6px;
              display: inline-block;
              writing-mode: vertical-rl;
              text-orientation: mixed;
              transform: rotate(180deg);
              white-space: nowrap;
            ">
              ${customer.code}
            </div>
          </div>
          
          <!-- Spacer - Fixed gap -->
          <div style="height: 10mm; flex-shrink: 0;"></div>
          
          <!-- QR Code - Fixed size -->
          <div class="qr-section" style="
            flex-shrink: 0;
            display: flex; 
            align-items: center; 
            justify-content: center;
            overflow: visible;
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          ">
            <img src="${qrImage}" 
                 alt="QR Code for ${customer.code}" 
                 style="
                   width: 60mm !important; 
                   height: 60mm !important;
                   min-width: 60mm;
                   min-height: 60mm;
                   max-width: 60mm;
                   max-height: 60mm;
                   object-fit: contain;
                   display: block;
                   border: none;
                 "
                 title="QR Code: ${customer.code}">
          </div>
        </div>
      `;
    
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Customer Label</title>
              <style>
                @page {
                  size: 100mm 130mm;
                  margin: 0mm;
                  padding: 0mm;
                }
                
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                  color-adjust: exact;
                }
                
                html {
                  width: 100mm;
                  height: 130mm;
                  margin: 0;
                  padding: 0;
                }
                
                body {
                  width: 100mm;
                  height: 130mm;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: hidden;
                  font-family: Arial, sans-serif;
                  background: white;
                  transform-origin: top left;
                  transform: scale(1);
                }
                
                .customer-label {
                  width: 100mm !important;
                  height: 130mm !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  box-shadow: none;
                  border: none;
                  position: absolute;
                  top: 0;
                  left: 0;
                }
                
                @media print {
                  @page {
                    size: 100mm 130mm;
                    margin: 0mm;
                  }
                  
                  html, body {
                    width: 100mm;
                    height: 130mm;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible;
                  }
                  
                  .customer-label {
                    width: 100mm !important;
                    height: 130mm !important;
                    page-break-after: avoid;
                    page-break-inside: avoid;
                  }
                }
              </style>
            </head>
            <body>
              ${printContent}
              <script>
                window.onload = function() {
                  // Show instruction alert before printing
                  alert('⚠️ QUAN TRỌNG:\\n\\nTrong hộp thoại Print:\\n1. Mở "More settings"\\n2. TẮT "Headers and footers"\\n3. Đặt Scale = 100% (Default)\\n4. Margins = None\\n5. Nhấn Print');
                  
                  setTimeout(function() {
                    window.print();
                    window.onafterprint = function() {
                      window.close();
                    };
                  }, 100);
                };
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    } catch (error) {
      console.error('Error printing customer label:', error);
      alert('❌ Lỗi khi in tem khách hàng');
    }
  }
}

