import { Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import * as QRCode from 'qrcode';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const TP_CODES_PER_PRINT_PAGE = 60;
const TP_CODE_PATTERN = /^P\d{6}$/;

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

type MobileBottomTab = 'move' | 'factory' | 'kk';
type FactoryChangeMode = 'ma' | 'pallet';
type FactoryChangeStep = 'mode' | 'scan-loc' | 'select-ma' | 'scan-pallet' | 'pick-factory' | 'done';
type KkStep = 'scan-location' | 'scan-codes' | 'done';

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

  // Kiểm kê (scan vị trí → scan mã TP → cập nhật viTriKK)
  kkStep: KkStep = 'scan-location';
  kkLocation = '';
  kkLocationInput = '';
  kkCodeInput = '';
  kkScannedCodes: string[] = [];
  /** Đang ở luồng kiểm kê (desktop) hoặc tab Kiểm kê (mobile) */
  kkPanelActive = false;

  isLoading = false;
  errorMessage = '';
  successMessage = '';
  movedCount = 0;

  @ViewChild('locationInput') locationInput: ElementRef;
  @ViewChild('newLocationInput') newLocationInput: ElementRef;
  @ViewChild('palletIdInput') palletIdInput: ElementRef;
  @ViewChild('factoryLocInput') factoryLocInput: ElementRef;
  @ViewChild('factoryPalletInput') factoryPalletInput: ElementRef;
  @ViewChild('kkLocationInputRef') kkLocationInputRef: ElementRef;
  @ViewChild('kkCodeInputRef') kkCodeInputRef: ElementRef;

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
    if (tab === 'kk') {
      this.kkPanelActive = true;
      this.resetKkFlow(false);
      if (this.selectedFactory) {
        setTimeout(() => this.kkLocationInputRef?.nativeElement?.focus(), 100);
      }
    }
    if (tab === 'move') {
      this.kkPanelActive = false;
    }
  }

  goMobileMenu(): void {
    this.router.navigate(['/menu']);
  }

  // ── Đổi vị trí (existing) ──

  selectFactory(factory: string): void {
    this.selectedFactory = factory;
    this.currentStep = 'hub';
    this.errorMessage = '';
    this.successMessage = '';
  }

  startMoveFlow(): void {
    this.kkPanelActive = false;
    this.currentStep = 'scan-location';
    this.errorMessage = '';
    setTimeout(() => this.locationInput?.nativeElement?.focus(), 100);
  }

  startKkFlow(): void {
    this.kkPanelActive = true;
    this.resetKkFlow(true);
    this.mobileBottomTab = 'kk';
  }

  backToHub(): void {
    this.kkPanelActive = false;
    this.currentStep = 'hub';
    this.errorMessage = '';
    this.successMessage = '';
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
    this.resetKkFlow(false);
  }

  private resetKkFlow(focusInput: boolean): void {
    this.kkStep = 'scan-location';
    this.kkLocation = '';
    this.kkLocationInput = '';
    this.kkCodeInput = '';
    this.kkScannedCodes = [];
    if (focusInput && this.selectedFactory) {
      setTimeout(() => this.kkLocationInputRef?.nativeElement?.focus(), 100);
    }
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

  // ── In danh sách mã TP (60 mã / A4, không trùng, sắp A→Z, có STT) ──

  async printTpCodeSheet(): Promise<void> {
    if (!this.selectedFactory) {
      this.errorMessage = 'Vui lòng chọn nhà máy trước khi in';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const codes = await this.loadDistinctTpCodesInStock(this.selectedFactory);
      if (!codes.length) {
        alert(`Không có mã TP tồn > 0 tại ${this.selectedFactory}`);
        return;
      }
      await this.openTpPrintWindow(codes, this.selectedFactory);
    } catch (e: any) {
      this.errorMessage = `Lỗi in mã TP: ${e?.message || e}`;
    } finally {
      this.isLoading = false;
    }
  }

  private async loadDistinctTpCodesInStock(factory: string): Promise<string[]> {
    const snapshot = await this.firestore
      .collection('fg-inventory', ref => ref.where('factory', '==', factory))
      .get()
      .toPromise();
    const unique = new Set<string>();
    (snapshot?.docs || []).forEach(doc => {
      const data = doc.data() as any;
      const tonDau = data.tonDau || 0;
      const nhap = data.nhap || data.quantity || 0;
      const xuat = data.xuat || data.exported || 0;
      const ton = data.ton != null ? data.ton : tonDau + nhap - xuat;
      if (!(ton > 0)) return;
      const code7 = this.normalizeTpCode7(data.materialCode);
      if (code7) unique.add(code7);
    });
    return Array.from(unique).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })
    );
  }

  private normalizeTpCode7(raw: string): string {
    const s = String(raw || '').trim().toUpperCase();
    if (!s) return '';
    const head = s.slice(0, 7);
    return TP_CODE_PATTERN.test(head) ? head : '';
  }

  /** Nhóm in: 4 ký tự đầu (VD P001001 → P001). */
  private getTpPrintGroupKey(code: string): string {
    return String(code || '').trim().toUpperCase().slice(0, 4);
  }

  private buildTpPrintItems(codes: string[]): Array<
    { kind: 'group'; label: string } | { kind: 'code'; code: string; stt: number }
  > {
    const items: Array<
      { kind: 'group'; label: string } | { kind: 'code'; code: string; stt: number }
    > = [];
    let lastGroup = '';
    let stt = 0;
    for (const code of codes) {
      const group = this.getTpPrintGroupKey(code);
      if (group && group !== lastGroup) {
        items.push({ kind: 'group', label: `Nhóm ${group}` });
        lastGroup = group;
      }
      stt++;
      items.push({ kind: 'code', code, stt });
    }
    return items;
  }

  private paginateTpPrintItems(
    items: Array<{ kind: 'group'; label: string } | { kind: 'code'; code: string; stt: number }>
  ): Array<Array<{ kind: 'group'; label: string } | { kind: 'code'; code: string; stt: number }>> {
    const pages: Array<
      Array<{ kind: 'group'; label: string } | { kind: 'code'; code: string; stt: number }>
    > = [];
    let current: Array<{ kind: 'group'; label: string } | { kind: 'code'; code: string; stt: number }> =
      [];
    let codesOnPage = 0;

    for (const item of items) {
      if (item.kind === 'group') {
        current.push(item);
        continue;
      }
      if (codesOnPage >= TP_CODES_PER_PRINT_PAGE) {
        pages.push(current);
        current = [];
        codesOnPage = 0;
      }
      current.push(item);
      codesOnPage++;
    }
    if (current.length) pages.push(current);
    return pages;
  }

  private async renderTpCodeCell(code: string, stt: number): Promise<string> {
    const qr = await QRCode.toDataURL(code, { width: 88, margin: 0 });
    return `
      <div class="tp-cell">
        <img class="tp-qr" src="${qr}" alt="${code}" />
        <div class="tp-right">
          <div class="tp-stt">${stt}</div>
          <div class="tp-code">${code}</div>
          <div class="tp-check-row">
            <span class="tp-check-label">Yes</span>
            <span class="tp-check">☐</span>
          </div>
        </div>
      </div>
    `;
  }

  private async openTpPrintWindow(codes: string[], factory: string): Promise<void> {
    const printItems = this.buildTpPrintItems(codes);
    const itemPages = this.paginateTpPrintItems(printItems);
    const totalPages = itemPages.length;
    const printDate = new Date().toLocaleDateString('vi-VN');
    const pages: string[] = [];

    for (let p = 0; p < itemPages.length; p++) {
      const chunk = itemPages[p];
      const cells: string[] = [];
      for (const item of chunk) {
        if (item.kind === 'group') {
          cells.push(`<div class="tp-group-row">${item.label}</div>`);
        } else {
          cells.push(await this.renderTpCodeCell(item.code, item.stt));
        }
      }
      pages.push(`
        <section class="tp-page">
          <header class="tp-header">
            <div class="tp-header-top">
              <div class="tp-header-field tp-header-field--left">
                <span class="tp-field-label">Vị trí:</span>
                <div class="tp-field-box"></div>
              </div>
              <div class="tp-header-center">
                <h1>Danh sách mã TP — ${factory}</h1>
              </div>
              <div class="tp-header-field tp-header-field--right">
                <span class="tp-field-label">Ký tên:</span>
                <div class="tp-field-box"></div>
              </div>
            </div>
            <p>Ngày in: ${printDate} · Trang ${p + 1}/${totalPages} · Tối đa ${TP_CODES_PER_PRINT_PAGE} mã/trang</p>
            <p class="tp-hint">Tick ☐ Yes nếu có hàng · QR mã = nội dung scan kiểm kê</p>
          </header>
          <div class="tp-grid">${cells.join('')}</div>
        </section>
      `);
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>In mã TP — ${factory}</title>
          <style>
            @page { size: A4 portrait; margin: 8mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111; }
            .tp-page { page-break-after: always; }
            .tp-page:last-child { page-break-after: auto; }
            .tp-header { margin-bottom: 6px; border-bottom: 2px solid #333; padding-bottom: 6px; }
            .tp-header-top {
              display: grid;
              grid-template-columns: 1fr auto 1fr;
              align-items: end;
              gap: 10px;
              margin-bottom: 4px;
            }
            .tp-header-center { text-align: center; padding: 0 8px; }
            .tp-header-center h1 { font-size: 14px; margin: 0; white-space: nowrap; }
            .tp-header-field {
              display: flex;
              flex-direction: column;
              gap: 3px;
              min-width: 0;
            }
            .tp-header-field--left { align-items: flex-start; }
            .tp-header-field--right { align-items: flex-end; }
            .tp-field-label { font-size: 10px; font-weight: 700; color: #222; }
            .tp-field-box {
              width: 100%;
              max-width: 140px;
              min-width: 100px;
              height: 28px;
              border: 1px solid #333;
              border-radius: 2px;
              background: #fff;
            }
            .tp-header-field--right .tp-field-box { margin-left: auto; }
            .tp-header p { margin: 2px 0; font-size: 10px; color: #444; text-align: center; }
            .tp-header h1 { font-size: 14px; margin: 0 0 2px; }
            .tp-hint { font-style: italic; }
            .tp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
            .tp-group-row {
              grid-column: 1 / -1;
              font-size: 12px;
              font-weight: 800;
              padding: 5px 8px;
              background: #e8e8e8;
              border: 1px solid #666;
              border-radius: 3px;
              color: #111;
            }
            .tp-cell {
              border: 1px solid #999;
              border-radius: 3px;
              padding: 5px 6px;
              min-height: 58px;
              display: flex;
              flex-direction: row;
              align-items: center;
              gap: 5px;
            }
            .tp-qr { width: 50px; height: 50px; flex-shrink: 0; }
            .tp-right {
              flex: 1;
              display: flex;
              flex-direction: column;
              align-items: flex-end;
              justify-content: center;
              gap: 2px;
              min-width: 0;
            }
            .tp-stt {
              font-size: 9px;
              font-weight: 700;
              color: #666;
              line-height: 1;
            }
            .tp-code {
              font-size: 12px;
              font-weight: 700;
              letter-spacing: 0.25px;
              text-align: right;
              line-height: 1.15;
            }
            .tp-check-row {
              display: flex;
              flex-direction: row;
              align-items: center;
              justify-content: flex-end;
              gap: 4px;
              margin-top: 1px;
            }
            .tp-check-label { font-size: 9px; font-weight: 600; color: #333; }
            .tp-check {
              font-size: 12px;
              line-height: 1;
              width: 15px;
              height: 15px;
              border: 1.5px solid #222;
              display: inline-flex;
              align-items: center;
              justify-content: center;
            }
            .no-print { margin: 16px; text-align: center; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          ${pages.join('')}
          <div class="no-print">
            <button type="button" onclick="window.print()">In A4</button>
            <button type="button" onclick="window.close()">Đóng</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  // ── Kiểm kê: scan vị trí → scan mã → cập nhật viTriKK ──

  onKkLocationInputChange(): void {
    if (this.kkLocationInput) this.kkLocationInput = this.kkLocationInput.toUpperCase();
  }

  onKkCodeInputChange(): void {
    if (this.kkCodeInput) this.kkCodeInput = this.kkCodeInput.toUpperCase();
  }

  onKkLocationKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.confirmKkLocation();
  }

  onKkCodeKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.addKkScannedCode();
  }

  confirmKkLocation(): void {
    const loc = (this.kkLocationInput || '').trim().toUpperCase();
    if (!loc) {
      this.errorMessage = 'Vui lòng scan vị trí trên kệ';
      return;
    }
    if (!this.selectedFactory) {
      this.errorMessage = 'Vui lòng chọn nhà máy';
      return;
    }
    this.kkLocation = loc;
    this.kkStep = 'scan-codes';
    this.kkScannedCodes = [];
    this.kkCodeInput = '';
    this.errorMessage = '';
    setTimeout(() => this.kkCodeInputRef?.nativeElement?.focus(), 100);
  }

  addKkScannedCode(): void {
    const raw = (this.kkCodeInput || '').trim().toUpperCase();
    this.kkCodeInput = '';
    if (!raw) return;
    const code7 = this.normalizeTpCode7(raw);
    if (!code7) {
      this.errorMessage = `Mã không hợp lệ (cần P + 6 số): ${raw}`;
      return;
    }
    if (!this.kkScannedCodes.includes(code7)) {
      this.kkScannedCodes = [...this.kkScannedCodes, code7];
    }
    this.errorMessage = '';
  }

  removeKkCode(code: string): void {
    this.kkScannedCodes = this.kkScannedCodes.filter(c => c !== code);
  }

  backKkStep(): void {
    if (this.kkStep === 'scan-codes') {
      this.kkStep = 'scan-location';
      this.kkLocation = '';
      this.kkScannedCodes = [];
      setTimeout(() => this.kkLocationInputRef?.nativeElement?.focus(), 100);
    } else if (this.isMobile) {
      this.kkPanelActive = false;
      this.mobileBottomTab = 'move';
      if (this.selectedFactory) this.currentStep = 'hub';
      else this.currentStep = 'select-factory';
    } else {
      this.backToHub();
    }
    this.errorMessage = '';
  }

  async completeKkSession(): Promise<void> {
    if (!this.kkLocation || !this.selectedFactory) return;
    if (!this.kkScannedCodes.length) {
      const ok = confirm(
        `Không có mã nào được scan.\n\nHoàn tất sẽ XÓA mọi「Vị trí KK」đang ghi ${this.kkLocation}.\nTiếp tục?`
      );
      if (!ok) return;
    } else {
      const ok = confirm(
        `Vị trí KK: ${this.kkLocation}\nSố mã scan: ${this.kkScannedCodes.length}\n\n` +
          `Mã đã scan → ghi Vị trí KK.\nMã cũ ở ${this.kkLocation} nhưng không scan → xóa Vị trí KK.\n\nXác nhận?`
      );
      if (!ok) return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const location = this.kkLocation.trim().toUpperCase();
    const scannedSet = new Set(this.kkScannedCodes);
    const now = new Date();

    try {
      const snapshot = await this.firestore
        .collection('fg-inventory', ref => ref.where('factory', '==', this.selectedFactory))
        .get()
        .toPromise();
      if (!snapshot) throw new Error('Không tải được FG Inventory');

      const batch = this.firestore.firestore.batch();
      let updated = 0;
      let cleared = 0;

      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const code7 = this.normalizeTpCode7(data.materialCode);
        const currentKk = String(data.viTriKK || data.locationKK || '').trim().toUpperCase();
        const ref = this.firestore.collection('fg-inventory').doc(doc.id).ref;

        if (currentKk === location && code7 && !scannedSet.has(code7)) {
          batch.update(ref, {
            viTriKK: firebase.firestore.FieldValue.delete(),
            updatedAt: now,
            kkUpdatedAt: now
          });
          cleared++;
          return;
        }

        if (code7 && scannedSet.has(code7)) {
          batch.update(ref, {
            viTriKK: location,
            updatedAt: now,
            kkUpdatedAt: now
          });
          updated++;
        }
      });

      await batch.commit();
      this.kkStep = 'done';
      this.successMessage =
        `Kiểm kê ${location}: ${this.kkScannedCodes.length} mã scan · ` +
        `${updated} dòng cập nhật Vị trí KK · ${cleared} dòng xóa KK cũ`;
    } catch (e: any) {
      this.errorMessage = `Lỗi kiểm kê: ${e?.message || e}`;
    } finally {
      this.isLoading = false;
    }
  }

  resetKkAfterDone(): void {
    this.successMessage = '';
    this.resetKkFlow(true);
  }
}
