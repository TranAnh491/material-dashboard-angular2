import { Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';

interface LocationItem {
  id: string;
  factory: string;
  materialCode: string;
  batchNumber: string;
  lot: string;
  lsx: string;
  location: string;
  ton: number;
  selected: boolean;
  palletId?: string;
}

type MobileBottomTab = 'move' | 'factory';
type FactoryChangeMode = 'ma' | 'pallet';
type FactoryChangeStep = 'mode' | 'scan-loc' | 'select-ma' | 'scan-pallet' | 'pick-factory' | 'done';

@Component({
  selector: 'app-fg-location',
  templateUrl: './fg-location.component.html',
  styleUrls: ['./fg-location.component.scss']
})
export class FgLocationComponent implements OnInit, OnDestroy {
  // Mobile shell
  isMobile = false;
  mobileBottomTab: MobileBottomTab = 'move';
  showMobileFactorySelect = false;
  mobileFactorySelected = false;
  private readonly mobileBodyClass = 'fg-loc-mobile-tab';

  // Factory context (ASM1 / ASM2)
  selectedFactory = '';
  availableFactories: string[] = ['ASM1', 'ASM2'];
  targetFactories: string[] = ['ASM1', 'ASM2', 'ASM3'];

  // Đổi vị trí steps
  currentStep = 'select-factory';
  locationScanInput = '';
  newLocationScanInput = '';
  palletIdScanInput = '';
  skipNewLocation = false;
  skipPalletId = false;
  currentLocation = '';
  itemsAtLocation: LocationItem[] = [];
  newLocation = '';
  selectAll = false;

  // Đổi nhà máy
  factoryChangeMode: FactoryChangeMode | null = null;
  factoryChangeStep: FactoryChangeStep = 'mode';
  targetFactory = '';
  factoryChangeItems: LocationItem[] = [];
  factoryChangePalletIds: string[] = [];
  palletScanInput = '';
  factoryChangeLocationInput = '';

  isLoading = false;
  errorMessage = '';
  successMessage = '';
  movedCount = 0;

  @ViewChild('locationInput') locationInput: ElementRef;
  @ViewChild('newLocationInput') newLocationInput: ElementRef;
  @ViewChild('palletIdInput') palletIdInput: ElementRef;
  @ViewChild('factoryLocInput') factoryLocInput: ElementRef;
  @ViewChild('factoryPalletInput') factoryPalletInput: ElementRef;

  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.updateMobileLayout();
  }

  ngOnDestroy(): void {
    document.body.classList.remove(this.mobileBodyClass);
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateMobileLayout();
  }

  private updateMobileLayout(): void {
    const next =
      window.innerWidth <= 768 ||
      /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
        (navigator.userAgent || '').toLowerCase()
      );
    if (next === this.isMobile) return;
    this.isMobile = next;
    if (this.isMobile) {
      document.body.classList.add(this.mobileBodyClass);
      if (!this.mobileFactorySelected) {
        this.showMobileFactorySelect = true;
      }
    } else {
      document.body.classList.remove(this.mobileBodyClass);
      this.showMobileFactorySelect = false;
    }
  }

  selectMobileFactory(factory: string): void {
    this.selectFactory(factory);
    this.mobileFactorySelected = true;
    this.showMobileFactorySelect = false;
  }

  openMobileFactorySelect(): void {
    this.showMobileFactorySelect = true;
  }

  setMobileBottomTab(tab: MobileBottomTab): void {
    this.mobileBottomTab = tab;
    this.errorMessage = '';
    if (tab === 'factory') {
      this.resetFactoryChangeFlow(true);
    }
  }

  goMobileMenu(): void {
    this.router.navigate(['/menu']);
  }

  // ── Đổi vị trí (existing) ──

  selectFactory(factory: string): void {
    this.selectedFactory = factory;
    this.currentStep = 'scan-location';
    this.errorMessage = '';
    this.successMessage = '';
    setTimeout(() => this.locationInput?.nativeElement?.focus(), 100);
  }

  backToFactorySelection(): void {
    this.resetAll();
    if (this.isMobile) {
      this.mobileFactorySelected = false;
      this.showMobileFactorySelect = true;
    }
  }

  async scanLocation(): Promise<void> {
    if (!this.locationScanInput?.trim()) {
      this.errorMessage = 'Vui lòng scan hoặc nhập vị trí';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    const rawInput = this.locationScanInput.trim().toUpperCase();
    try {
      const items = await this.findItemsByLocationKey(rawInput, this.selectedFactory);
      if (!items.length) {
        this.errorMessage = `Không tìm thấy hàng tại vị trí hoặc Pallet "${rawInput}" trong nhà máy ${this.selectedFactory}`;
        this.isLoading = false;
        return;
      }
      this.itemsAtLocation = items;
      const byExact = items.some(i => (i.location || '').toUpperCase() === rawInput);
      this.currentLocation = byExact ? rawInput : (items[0]?.location || rawInput);
      this.currentStep = 'show-items';
      this.selectAll = false;
    } catch (error: any) {
      this.errorMessage = `Lỗi khi tìm kiếm: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  onLocationScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.scanLocation();
  }

  onNewLocationScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      if (this.isNewLocationValid()) this.moveToNewLocation();
      else this.palletIdInput?.nativeElement?.focus();
    }
  }

  onPalletIdScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.isNewLocationValid()) this.moveToNewLocation();
  }

  toggleSelectAll(): void {
    this.selectAll = !this.selectAll;
    this.itemsAtLocation.forEach(item => (item.selected = this.selectAll));
  }

  toggleItemSelection(item: LocationItem): void {
    item.selected = !item.selected;
    this.selectAll = this.itemsAtLocation.length > 0 && this.itemsAtLocation.every(i => i.selected);
  }

  getSelectedCount(): number {
    return this.itemsAtLocation.filter(i => i.selected).length;
  }

  hasSelectedItems(): boolean {
    return this.itemsAtLocation.some(i => i.selected);
  }

  proceedToScanNewLocation(): void {
    if (!this.hasSelectedItems()) {
      this.errorMessage = 'Vui lòng chọn ít nhất một mã hàng để di chuyển';
      return;
    }
    this.currentStep = 'scan-new-location';
    this.newLocationScanInput = '';
    this.palletIdScanInput = '';
    this.skipNewLocation = false;
    this.skipPalletId = false;
    this.errorMessage = '';
    setTimeout(() => this.newLocationInput?.nativeElement?.focus(), 100);
  }

  getDisplayNewLocation(): string {
    const loc = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim().toUpperCase();
    const pallet = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim().toUpperCase();
    if (loc && pallet) return `${loc}-${pallet}`;
    if (loc) return loc;
    if (pallet) return pallet;
    return '?';
  }

  getEffectiveNewLocation(): string {
    const loc = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim().toUpperCase();
    const pallet = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim().toUpperCase();
    if (loc && pallet) return `${loc}-${pallet}`;
    if (loc) return loc;
    return pallet;
  }

  isNewLocationValid(): boolean {
    const loc = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim();
    const pallet = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim();
    if (!this.skipNewLocation && !this.skipPalletId) return loc.length > 0 && pallet.length > 0;
    if (!this.skipNewLocation && loc.length === 0) return false;
    if (!this.skipPalletId && pallet.length === 0) return false;
    return true;
  }

  backToLocationScan(): void {
    this.currentStep = 'scan-location';
    this.locationScanInput = '';
    this.currentLocation = '';
    this.itemsAtLocation = [];
    this.selectAll = false;
    this.errorMessage = '';
    setTimeout(() => this.locationInput?.nativeElement?.focus(), 100);
  }

  backToItemSelection(): void {
    this.currentStep = 'show-items';
    this.newLocationScanInput = '';
    this.errorMessage = '';
  }

  async moveToNewLocation(): Promise<void> {
    if (!this.isNewLocationValid()) {
      this.errorMessage = 'Vui lòng nhập ít nhất một mục: Vị trí mới hoặc Pallet ID';
      return;
    }
    const selectedItems = this.itemsAtLocation.filter(i => i.selected);
    if (!selectedItems.length) {
      this.errorMessage = 'Không có hàng nào được chọn';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    const rackLocation = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim().toUpperCase();
    const palletId = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim().toUpperCase();
    this.newLocation = this.getEffectiveNewLocation();
    if (this.newLocation === this.currentLocation) {
      this.errorMessage = 'Vị trí mới phải khác vị trí hiện tại';
      this.isLoading = false;
      return;
    }
    try {
      const batch = this.firestore.firestore.batch();
      selectedItems.forEach(item => {
        const docRef = this.firestore.collection('fg-inventory').doc(item.id).ref;
        batch.update(docRef, {
          location: this.newLocation,
          updatedAt: new Date(),
          lastModified: new Date(),
          modifiedBy: 'fg-location-scanner',
          palletId: palletId || '',
          rackLocation: rackLocation || this.newLocation || ''
        });
      });
      await batch.commit();
      this.movedCount = selectedItems.length;
      this.successMessage = `Đã di chuyển ${this.movedCount} mã hàng!\n${this.currentLocation} → ${this.newLocation}`;
      this.currentStep = 'success';
    } catch (error: any) {
      this.errorMessage = `Lỗi khi di chuyển: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  scanAnotherLocation(): void {
    this.locationScanInput = '';
    this.newLocationScanInput = '';
    this.palletIdScanInput = '';
    this.skipNewLocation = false;
    this.skipPalletId = false;
    this.currentLocation = '';
    this.newLocation = '';
    this.itemsAtLocation = [];
    this.selectAll = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.movedCount = 0;
    this.currentStep = 'scan-location';
    setTimeout(() => this.locationInput?.nativeElement?.focus(), 100);
  }

  resetAll(): void {
    this.selectedFactory = '';
    this.currentStep = 'select-factory';
    this.locationScanInput = '';
    this.newLocationScanInput = '';
    this.palletIdScanInput = '';
    this.skipNewLocation = false;
    this.skipPalletId = false;
    this.currentLocation = '';
    this.newLocation = '';
    this.itemsAtLocation = [];
    this.selectAll = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.movedCount = 0;
  }

  onLocationInputChange(): void {
    if (this.locationScanInput) this.locationScanInput = this.locationScanInput.toUpperCase();
  }

  onNewLocationInputChange(): void {
    if (this.newLocationScanInput) this.newLocationScanInput = this.newLocationScanInput.toUpperCase();
  }

  onPalletIdInputChange(): void {
    if (this.palletIdScanInput) this.palletIdScanInput = this.palletIdScanInput.toUpperCase();
  }

  // ── Đổi nhà máy ──

  startFactoryChangeMode(mode: FactoryChangeMode): void {
    this.factoryChangeMode = mode;
    this.errorMessage = '';
    this.successMessage = '';
    this.targetFactory = '';
    if (mode === 'ma') {
      this.factoryChangeStep = 'scan-loc';
      this.factoryChangeItems = [];
      this.factoryChangeLocationInput = '';
      setTimeout(() => this.factoryLocInput?.nativeElement?.focus(), 100);
    } else {
      this.factoryChangeStep = 'scan-pallet';
      this.factoryChangeItems = [];
      this.factoryChangePalletIds = [];
      this.palletScanInput = '';
      setTimeout(() => this.factoryPalletInput?.nativeElement?.focus(), 100);
    }
  }

  resetFactoryChangeFlow(backToMode = true): void {
    this.factoryChangeMode = null;
    this.factoryChangeStep = backToMode ? 'mode' : 'mode';
    this.targetFactory = '';
    this.factoryChangeItems = [];
    this.factoryChangePalletIds = [];
    this.palletScanInput = '';
    this.factoryChangeLocationInput = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.movedCount = 0;
  }

  backFactoryChangeStep(): void {
    this.errorMessage = '';
    if (this.factoryChangeStep === 'pick-factory') {
      if (this.factoryChangeMode === 'ma') {
        this.factoryChangeStep = 'select-ma';
      } else {
        this.factoryChangeStep = 'scan-pallet';
      }
      this.targetFactory = '';
      return;
    }
    if (this.factoryChangeStep === 'select-ma') {
      this.factoryChangeStep = 'scan-loc';
      this.factoryChangeItems = [];
      return;
    }
    if (this.factoryChangeStep === 'scan-loc' || this.factoryChangeStep === 'scan-pallet') {
      this.resetFactoryChangeFlow(true);
      return;
    }
    if (this.factoryChangeStep === 'done') {
      this.resetFactoryChangeFlow(true);
    }
  }

  async scanLocationForFactoryChange(): Promise<void> {
    if (!this.factoryChangeLocationInput?.trim()) {
      this.errorMessage = 'Vui lòng scan hoặc nhập vị trí';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    const rawInput = this.factoryChangeLocationInput.trim().toUpperCase();
    try {
      const items = await this.findItemsByLocationKey(rawInput, this.selectedFactory);
      if (!items.length) {
        this.errorMessage = `Không tìm thấy mã hàng tại "${rawInput}"`;
        return;
      }
      this.factoryChangeItems = items.map(i => ({ ...i, selected: false }));
      this.factoryChangeStep = 'select-ma';
    } catch (error: any) {
      this.errorMessage = `Lỗi: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  onFactoryLocKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.scanLocationForFactoryChange();
  }

  onFactoryLocInputChange(): void {
    if (this.factoryChangeLocationInput) {
      this.factoryChangeLocationInput = this.factoryChangeLocationInput.toUpperCase();
    }
  }

  toggleFactoryItemSelection(item: LocationItem): void {
    item.selected = !item.selected;
  }

  toggleFactorySelectAll(): void {
    const all = this.factoryChangeItems.every(i => i.selected);
    this.factoryChangeItems.forEach(i => (i.selected = !all));
  }

  getFactoryChangeSelectedCount(): number {
    return this.factoryChangeItems.filter(i => i.selected).length;
  }

  isAllFactoryItemsSelected(): boolean {
    return this.factoryChangeItems.length > 0 && this.factoryChangeItems.every(i => i.selected);
  }

  proceedToPickFactory(): void {
    const selected = this.factoryChangeItems.filter(i => i.selected);
    if (!selected.length) {
      this.errorMessage = 'Vui lòng chọn ít nhất một mã';
      return;
    }
    this.errorMessage = '';
    this.factoryChangeStep = 'pick-factory';
  }

  async scanPalletForFactoryChange(): Promise<void> {
    if (!this.palletScanInput?.trim()) {
      this.errorMessage = 'Vui lòng scan Pallet ID';
      return;
    }
    const rawInput = this.palletScanInput.trim().toUpperCase();
    if (this.factoryChangePalletIds.includes(rawInput)) {
      this.errorMessage = `Pallet "${rawInput}" đã được scan`;
      this.palletScanInput = '';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const items = await this.findItemsByPalletKey(rawInput, this.selectedFactory);
      if (!items.length) {
        this.errorMessage = `Không tìm thấy hàng cho Pallet "${rawInput}"`;
        return;
      }
      this.factoryChangePalletIds.push(rawInput);
      const existingIds = new Set(this.factoryChangeItems.map(i => i.id));
      items.forEach(item => {
        if (!existingIds.has(item.id)) {
          this.factoryChangeItems.push({ ...item, selected: true });
          existingIds.add(item.id);
        }
      });
      this.palletScanInput = '';
      setTimeout(() => this.factoryPalletInput?.nativeElement?.focus(), 100);
    } catch (error: any) {
      this.errorMessage = `Lỗi: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  onFactoryPalletKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.scanPalletForFactoryChange();
  }

  onFactoryPalletInputChange(): void {
    if (this.palletScanInput) this.palletScanInput = this.palletScanInput.toUpperCase();
  }

  removeScannedPallet(palletId: string): void {
    this.factoryChangePalletIds = this.factoryChangePalletIds.filter(p => p !== palletId);
    this.factoryChangeItems = this.factoryChangeItems.filter(item => {
      const pid = (item.palletId || '').toUpperCase();
      const loc = (item.location || '').toUpperCase();
      return pid !== palletId && !loc.endsWith('-' + palletId);
    });
  }

  proceedPalletToPickFactory(): void {
    if (!this.factoryChangeItems.length) {
      this.errorMessage = 'Vui lòng scan ít nhất một Pallet';
      return;
    }
    this.errorMessage = '';
    this.factoryChangeStep = 'pick-factory';
  }

  selectTargetFactory(factory: string): void {
    this.targetFactory = factory;
  }

  canConfirmFactoryChange(): boolean {
    return !!this.targetFactory && this.getItemsForFactoryChange().length > 0;
  }

  getItemsForFactoryChange(): LocationItem[] {
    if (this.factoryChangeMode === 'ma') {
      return this.factoryChangeItems.filter(i => i.selected);
    }
    return this.factoryChangeItems;
  }

  async confirmFactoryChange(): Promise<void> {
    const items = this.getItemsForFactoryChange();
    if (!items.length || !this.targetFactory) {
      this.errorMessage = 'Chọn nhà máy đích và ít nhất một mã hàng';
      return;
    }
    const sameFactory = items.every(i => i.factory === this.targetFactory);
    if (sameFactory) {
      this.errorMessage = `Tất cả mã đã thuộc nhà máy ${this.targetFactory}`;
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const batch = this.firestore.firestore.batch();
      items.forEach(item => {
        const docRef = this.firestore.collection('fg-inventory').doc(item.id).ref;
        batch.update(docRef, {
          factory: this.targetFactory,
          updatedAt: new Date(),
          lastModified: new Date(),
          modifiedBy: 'fg-location-factory-change'
        });
      });
      await batch.commit();
      this.movedCount = items.length;
      this.successMessage = `Đã đổi nhà máy ${this.movedCount} mã → ${this.targetFactory}`;
      this.factoryChangeStep = 'done';
    } catch (error: any) {
      this.errorMessage = `Lỗi: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  // ── Firestore helpers ──

  private async findItemsByLocationKey(rawInput: string, factory: string): Promise<LocationItem[]> {
    const snapshot = await this.firestore
      .collection('fg-inventory', ref => ref.where('factory', '==', factory))
      .get()
      .toPromise();

    if (!snapshot || snapshot.empty) return [];

    const allDocs = snapshot.docs;
    const byExactLocation = allDocs.filter(d => {
      const data: any = d.data();
      return ((data.location || '').toString().toUpperCase()) === rawInput;
    });
    const byPalletIdOrComposite = allDocs.filter(d => {
      const data: any = d.data();
      const loc = (data.location || '').toString().toUpperCase();
      const pid = (data.palletId || '').toString().toUpperCase();
      if (pid) return pid === rawInput;
      if (!loc) return false;
      return loc === rawInput || loc.endsWith('-' + rawInput);
    });
    const docs = byExactLocation.length > 0 ? byExactLocation : byPalletIdOrComposite;
    return this.mapDocsToItems(docs, factory);
  }

  private async findItemsByPalletKey(rawInput: string, factory: string): Promise<LocationItem[]> {
    const snapshot = await this.firestore
      .collection('fg-inventory', ref => ref.where('factory', '==', factory))
      .get()
      .toPromise();
    if (!snapshot || snapshot.empty) return [];
    const docs = snapshot.docs.filter(d => {
      const data: any = d.data();
      const loc = (data.location || '').toString().toUpperCase();
      const pid = (data.palletId || '').toString().toUpperCase();
      if (pid) return pid === rawInput;
      return loc.endsWith('-' + rawInput) || loc === rawInput;
    });
    return this.mapDocsToItems(docs, factory);
  }

  private mapDocsToItems(docs: { id: string; data: () => any }[], factory: string): LocationItem[] {
    return docs
      .map(doc => {
        const data = doc.data() as any;
        const tonDau = data.tonDau || 0;
        const nhap = data.nhap || data.quantity || 0;
        const xuat = data.xuat || data.exported || 0;
        const ton = data.ton != null ? data.ton : tonDau + nhap - xuat;
        return {
          id: doc.id,
          factory: data.factory || factory,
          materialCode: data.materialCode || '',
          batchNumber: data.batchNumber || '',
          lot: data.lot || '',
          lsx: data.lsx || '',
          location: data.location || '',
          ton,
          selected: false,
          palletId: (data.palletId || '').toString().toUpperCase()
        };
      })
      .filter(item => item.ton > 0)
      .sort((a, b) => a.materialCode.localeCompare(b.materialCode));
  }
}
