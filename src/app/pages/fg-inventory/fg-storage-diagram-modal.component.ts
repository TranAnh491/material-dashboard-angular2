import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import {
  buildStorageZones,
  extractPalletQrCode,
  getCartonPerPallet,
  inventoryLineMatchesPallet,
  matchesStorageCustomer,
  normalizeStorageLocation,
  parseStorageSlotLocation,
  shortStorageCustomerLabel,
  STORAGE_LAYOUT_RULES,
  StorageInventoryLine,
  StorageLevelSlot,
  StoragePalletSlot,
  StorageZoneView
} from './fg-storage-layout';

export type FgStorageDiagramMode = 'view' | 'move' | 'pick';

@Component({
  selector: 'app-fg-storage-diagram-modal',
  templateUrl: './fg-storage-diagram-modal.component.html',
  styleUrls: ['./fg-storage-diagram-modal.component.scss']
})
export class FgStorageDiagramModalComponent implements OnChanges {
  @Input() open = false;
  @Input() mode: FgStorageDiagramMode = 'view';
  @Input() factory = 'TOTAL';
  /** Dòng tồn (có location) — dùng search / move / hiển thị. */
  @Input() inventoryLines: StorageInventoryLine[] = [];
  /** Carton theo khách để vẽ sơ đồ phân bổ. */
  @Input() cartonRows: Array<{ customer: string; carton: number }> = [];
  /** Khách hiện tại (phiếu nhập / bộ lọc) — highlight trên sơ đồ. */
  @Input() currentCustomer = '';
  @Input() showTempPicker = false;

  @Output() closed = new EventEmitter<void>();
  @Output() pickedLocation = new EventEmitter<string>();
  @Output() moved = new EventEmitter<{ count: number; toLocation: string }>();
  @Output() checkRequested = new EventEmitter<void>();

  readonly storageRules = STORAGE_LAYOUT_RULES;
  readonly tempLocations = ['Temp-1', 'Temp-2', 'Temp-3'] as const;

  storageZones: StorageZoneView[] = [];
  storageSearchInput = '';
  storageSearchMessage = '';
  private storageHighlightedSlots = new Set<string>();

  selectedPalletLabel = '';
  selectedPalletCapacity = 0;
  palletLines: StorageInventoryLine[] = [];
  selectedIds = new Set<string>();
  moveSourceLabel = '';
  isMoving = false;
  isSavingMove = false;
  panelMessage = '';

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.resetInteraction();
      this.rebuildZones();
      if (this.currentCustomer) {
        setTimeout(() => this.scrollToCurrentCustomer(), 120);
      }
    }
    if ((changes['cartonRows'] || changes['inventoryLines']) && this.open) {
      this.rebuildZones();
      if (this.selectedPalletLabel) {
        this.refreshPalletLines(this.selectedPalletLabel);
      }
      if (this.currentCustomer) {
        setTimeout(() => this.scrollToCurrentCustomer(), 120);
      }
    }
    if (changes['currentCustomer'] && this.open && this.currentCustomer) {
      setTimeout(() => this.scrollToCurrentCustomer(), 80);
    }
  }

  get currentCustomerLabel(): string {
    return shortStorageCustomerLabel(this.currentCustomer) || String(this.currentCustomer || '').trim();
  }

  isCurrentCustomerLevel(lv: StorageLevelSlot): boolean {
    return this.customerMatchesCurrent(lv?.customer);
  }

  isCurrentCustomerRack(primaryCustomer: string): boolean {
    return this.customerMatchesCurrent(primaryCustomer);
  }

  private customerMatchesCurrent(slotCustomer: string | undefined | null): boolean {
    const cur = String(this.currentCustomer || '').trim();
    const slot = String(slotCustomer || '').trim();
    if (!cur || !slot || slot === '—') return false;
    return matchesStorageCustomer(cur, slot) || matchesStorageCustomer(slot, cur);
  }

  private scrollToCurrentCustomer(): void {
    for (const zone of this.storageZones) {
      for (const rack of zone.racks) {
        for (const lv of rack.levels) {
          if (!this.isCurrentCustomerLevel(lv)) continue;
          document.getElementById(this.storageSlotDomId(lv.label))?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
          return;
        }
      }
    }
  }

  get title(): string {
    if (this.mode === 'pick') return 'Chọn vị trí lưu trữ';
    if (this.mode === 'move') return 'Sơ đồ lưu trữ — dời pallet';
    return 'Sơ đồ lưu trữ';
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  get allSelected(): boolean {
    return this.palletLines.length > 0 && this.palletLines.every((l) => l.id && this.selectedIds.has(l.id));
  }

  rebuildZones(): void {
    const rows =
      this.cartonRows?.length
        ? this.cartonRows
        : this.aggregateCartonRows(this.inventoryLines || []);
    this.storageZones = buildStorageZones(rows);
    this.cdr.markForCheck();
  }

  private aggregateCartonRows(
    lines: StorageInventoryLine[]
  ): Array<{ customer: string; carton: number }> {
    const map = new Map<string, number>();
    for (const line of lines) {
      const customer = String(line.customer || '').trim() || 'Không xác định';
      const carton =
        Number(line.carton) > 0
          ? Number(line.carton)
          : Math.max(1, Math.ceil((Number(line.ton) || 0) / 100));
      map.set(customer, (map.get(customer) || 0) + carton);
    }
    return Array.from(map.entries()).map(([customer, carton]) => ({ customer, carton }));
  }

  close(): void {
    this.resetInteraction();
    this.closed.emit();
  }

  private resetInteraction(): void {
    this.storageSearchInput = '';
    this.storageSearchMessage = '';
    this.storageHighlightedSlots.clear();
    this.selectedPalletLabel = '';
    this.selectedPalletCapacity = 0;
    this.palletLines = [];
    this.selectedIds.clear();
    this.moveSourceLabel = '';
    this.isMoving = false;
    this.isSavingMove = false;
    this.panelMessage = '';
  }

  shortKh(name: string): string {
    return shortStorageCustomerLabel(name);
  }

  storageSlotDomId(label: string): string {
    return `storage-slot-${String(label || '').replace(/\./g, '-')}`;
  }

  isStorageSlotHighlighted(label: string): boolean {
    return this.storageHighlightedSlots.has(label);
  }

  isAnyPalletHighlighted(lv: StorageLevelSlot): boolean {
    return (lv.pallets || []).some((p) => this.storageHighlightedSlots.has(p.label));
  }

  isPalletSelected(label: string): boolean {
    return this.selectedPalletLabel === label;
  }

  isPalletMoveSource(label: string): boolean {
    return this.moveSourceLabel === label;
  }

  onStorageSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.searchStorageDiagram();
  }

  searchStorageDiagram(): void {
    const term = String(this.storageSearchInput || '').trim().toUpperCase();
    this.storageHighlightedSlots.clear();
    this.storageSearchMessage = '';
    if (!term) {
      this.cdr.markForCheck();
      return;
    }

    const addSlot = (label: string) => {
      if (label) this.storageHighlightedSlots.add(label);
    };

    const parsed = parseStorageSlotLocation(term);
    if (parsed) {
      addSlot(parsed.label);
      if (parsed.palletLabel) addSlot(parsed.palletLabel);
    }

    // Search theo mã QR pallet (nằm cuối vị trí) — dùng khi dời hàng
    for (const line of this.inventoryLines || []) {
      const code = String(line.materialCode || '').trim().toUpperCase();
      const loc = normalizeStorageLocation(line.location);
      if (!loc) continue;
      const qr = extractPalletQrCode(loc);
      const matchQr = !!qr && (qr === term || qr.includes(term) || term.includes(qr));
      const matchLoc =
        code === term ||
        code.startsWith(term) ||
        loc.startsWith(term) ||
        loc.includes(term) ||
        inventoryLineMatchesPallet(loc, term);
      if (matchQr || matchLoc) {
        const locParsed = parseStorageSlotLocation(loc);
        if (locParsed) {
          addSlot(locParsed.label);
          if (locParsed.palletLabel) addSlot(locParsed.palletLabel);
        }
      }
    }

    if (this.storageHighlightedSlots.size === 0) {
      const termCompact = term.replace(/[^A-Z0-9]/g, '');
      for (const zone of this.storageZones) {
        for (const rack of zone.racks) {
          for (const lv of rack.levels) {
            const labelCompact = lv.label.replace(/[^A-Z0-9]/g, '');
            if (labelCompact.startsWith(termCompact) || termCompact.startsWith(labelCompact)) {
              addSlot(lv.label);
            }
            for (const pl of lv.pallets || []) {
              const plCompact = pl.label.replace(/[^A-Z0-9]/g, '');
              if (plCompact.startsWith(termCompact) || termCompact === plCompact) {
                addSlot(lv.label);
                addSlot(pl.label);
              }
            }
          }
        }
      }
    }

    this.storageSearchMessage =
      this.storageHighlightedSlots.size === 0
        ? `Không tìm thấy vị trí cho "${term}"`
        : `Đã tìm thấy ${this.storageHighlightedSlots.size} ô`;
    if (this.storageHighlightedSlots.size) {
      setTimeout(() => this.scrollToHighlightedStorageSlot(), 80);
    }
    this.cdr.markForCheck();
  }

  clearStorageSearch(): void {
    this.storageSearchInput = '';
    this.storageSearchMessage = '';
    this.storageHighlightedSlots.clear();
    this.cdr.markForCheck();
  }

  private scrollToHighlightedStorageSlot(): void {
    const first = [...this.storageHighlightedSlots][0];
    if (!first) return;
    document.getElementById(this.storageSlotDomId(first))?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });
  }

  onPalletClick(pl: StoragePalletSlot, lv: StorageLevelSlot): void {
    const label = pl.label;
    if (this.mode === 'pick') {
      this.pickedLocation.emit(label);
      this.close();
      return;
    }

    if (this.mode === 'move' && this.isMoving && this.selectedCount > 0) {
      if (label === this.moveSourceLabel) {
        this.panelMessage = 'Chọn pallet đích khác pallet nguồn.';
        this.cdr.markForCheck();
        return;
      }
      void this.confirmAndMove(label, pl.capacityCarton);
      return;
    }

    this.selectedPalletLabel = label;
    this.selectedPalletCapacity = pl.capacityCarton || getCartonPerPallet(lv.rackId, lv.level);
    this.selectedIds.clear();
    this.isMoving = false;
    this.moveSourceLabel = '';
    this.panelMessage = '';
    this.refreshPalletLines(label);
  }

  pickTemp(temp: string): void {
    if (this.mode !== 'pick') return;
    this.pickedLocation.emit(temp);
    this.close();
  }

  private refreshPalletLines(palletLabel: string): void {
    this.palletLines = (this.inventoryLines || []).filter((l) =>
      inventoryLineMatchesPallet(l.location, palletLabel)
    );
    this.cdr.markForCheck();
  }

  toggleLine(line: StorageInventoryLine): void {
    if (!line.id || this.mode !== 'move') return;
    if (this.selectedIds.has(line.id)) this.selectedIds.delete(line.id);
    else this.selectedIds.add(line.id);
    this.cdr.markForCheck();
  }

  isLineSelected(line: StorageInventoryLine): boolean {
    return !!line.id && this.selectedIds.has(line.id);
  }

  toggleSelectAll(): void {
    if (this.allSelected) {
      this.selectedIds.clear();
    } else {
      for (const l of this.palletLines) {
        if (l.id) this.selectedIds.add(l.id);
      }
    }
    this.cdr.markForCheck();
  }

  startMove(): void {
    if (this.selectedCount === 0 || !this.selectedPalletLabel) return;
    this.isMoving = true;
    this.moveSourceLabel = this.selectedPalletLabel;
    this.panelMessage = `Đang dời ${this.selectedCount} dòng — bấm pallet đích.`;
    this.cdr.markForCheck();
  }

  cancelMove(): void {
    this.isMoving = false;
    this.moveSourceLabel = '';
    this.selectedIds.clear();
    this.panelMessage = '';
    this.cdr.markForCheck();
  }

  private async confirmAndMove(toLabel: string, destCapacity: number): Promise<void> {
    const ids = [...this.selectedIds];
    if (!ids.length) return;

    const moving = this.palletLines.filter((l) => l.id && this.selectedIds.has(l.id));
    const movingCarton = moving.reduce((s, l) => {
      const c =
        Number(l.carton) > 0
          ? Number(l.carton)
          : Math.max(1, Math.ceil((Number(l.ton) || 0) / Math.max(1, 50)));
      return s + c;
    }, 0);

    const alreadyOnDest = (this.inventoryLines || [])
      .filter((l) => inventoryLineMatchesPallet(l.location, toLabel) && !this.selectedIds.has(l.id || ''))
      .reduce((s, l) => s + (Number(l.carton) || Math.max(1, Math.ceil((Number(l.ton) || 0) / 50))), 0);

    const over = alreadyOnDest + movingCarton > destCapacity;
    let msg = `Dời ${ids.length} dòng từ ${this.moveSourceLabel} → ${toLabel}?`;
    if (over) {
      msg += `\n\n⚠ Vượt sức chứa pallet đích (~${alreadyOnDest + movingCarton}/${destCapacity} ct). Vẫn dời?`;
    }
    if (!confirm(msg)) return;

    this.isSavingMove = true;
    this.cdr.markForCheck();
    try {
      const editorId = await this.resolveEditorId();
      const now = new Date();
      const batch = this.firestore.firestore.batch();
      for (const line of moving) {
        if (!line.id) continue;
        const oldLoc = String(line.location || '').trim();
        const history = [
          ...(line.editHistory || []),
          {
            action: 'VI_TRI',
            by: editorId,
            at: now,
            detail: `${oldLoc || '—'} → ${toLabel}`
          }
        ].slice(-30);
        const ref = this.firestore.collection('fg-inventory').doc(line.id).ref;
        batch.update(ref, {
          location: toLabel,
          viTri: toLabel,
          editHistory: history,
          updatedAt: now
        });
        line.location = toLabel;
        line.editHistory = history;
      }
      await batch.commit();
      this.moved.emit({ count: ids.length, toLocation: toLabel });
      this.panelMessage = `Đã dời ${ids.length} dòng → ${toLabel}`;
      this.isMoving = false;
      this.moveSourceLabel = '';
      this.selectedIds.clear();
      this.selectedPalletLabel = toLabel;
      this.selectedPalletCapacity = destCapacity;
      this.refreshPalletLines(toLabel);
    } catch (e) {
      console.error('confirmAndMove failed', e);
      alert('❌ Không dời được vị trí. Thử lại.');
    } finally {
      this.isSavingMove = false;
      this.cdr.markForCheck();
    }
  }

  private async resolveEditorId(): Promise<string> {
    try {
      const user = await this.afAuth.currentUser;
      if (!user) return 'NV';
      if (user.displayName) return user.displayName.trim();
      if (user.email) return user.email.split('@')[0];
      return user.uid.slice(0, 8);
    } catch {
      return 'NV';
    }
  }

  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) return '0';
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
}
