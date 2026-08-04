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
  buildActualStorageZones,
  buildStorageZones,
  extractPalletQrCode,
  getCartonPerPallet,
  inventoryLineMatchesPallet,
  isSampleStorageSlot,
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

  readonly storageRules = STORAGE_LAYOUT_RULES;
  readonly tempLocations = ['Temp-1', 'Temp-2', 'Temp-3'] as const;

  storageZones: StorageZoneView[] = [];
  /** false = sơ đồ gốc (mô phỏng theo quy tắc); true = check — show khách thực tế + tô sai. */
  showActualPlacement = false;
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
      this.showActualPlacement = false;
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
    if (this.mode !== 'pick' && this.showActualPlacement) {
      // Check — đọc location thực tế từng dòng để show đúng khách đang thực sự ở đó + tô sai.
      this.storageZones = buildActualStorageZones(this.inventoryLines || []);
    } else {
      // Sơ đồ gốc — mô phỏng phân bổ theo quy tắc (không phụ thuộc location thực tế).
      const rows =
        this.cartonRows?.length
          ? this.cartonRows
          : this.aggregateCartonRows(this.inventoryLines || []);
      this.storageZones = buildStorageZones(rows);
    }
    this.cdr.markForCheck();
  }

  toggleActualPlacement(): void {
    if (this.mode === 'pick') return;
    this.showActualPlacement = !this.showActualPlacement;
    this.rebuildZones();
  }

  isMultiCustomerLevel(lv: StorageLevelSlot): boolean {
    return String(lv?.customer || '').includes(' + ');
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

  isSampleLevel(lv: StorageLevelSlot): boolean {
    return isSampleStorageSlot(lv?.label) || String(lv?.customer || '').toUpperCase() === 'SAMPLE';
  }

  /** In sơ đồ layout ra giấy A4. */
  printLayout(): void {
    if (!this.storageZones?.length) {
      this.rebuildZones();
    }
    const escape = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const zonesHtml = this.storageZones
      .map((zone) => {
        const racksHtml = zone.racks
          .map((rack) => {
            const showRackKh = zone.key !== 'A' && rack.primaryCustomer && rack.primaryCustomer !== '—';
            const levelsHtml = rack.levels
              .map((lv) => {
                const isSample = this.isSampleLevel(lv);
                const kh = lv.customer ? shortStorageCustomerLabel(lv.customer) : '—';
                const palletsHtml = (lv.pallets || [])
                  .map(
                    (pl) =>
                      `<span class="pl${pl.wrong ? ' wrong' : ''}">${escape(pl.slotLetter || String(pl.palletNo))}</span>`
                  )
                  .join('');
                return `<div class="lv${isSample ? ' sample' : ''}${lv.wrong ? ' wrong' : ''}">
                  <div class="lv-h"><b>${escape(lv.label)}</b><span>${escape(kh)}${lv.wrong ? ' ⚠' : ''}</span></div>
                  <div class="pls">${palletsHtml}</div>
                </div>`;
              })
              .join('');
            return `<div class="rack">
              <div class="rack-id">${escape(rack.id)}</div>
              ${showRackKh ? `<div class="rack-kh">${escape(shortStorageCustomerLabel(rack.primaryCustomer))}</div>` : ''}
              <div class="levels">${levelsHtml}</div>
              <div class="rack-meta">${rack.totalCarton}/${rack.capacityCarton} ct</div>
            </div>`;
          })
          .join('');
        return `<section class="zone">
          <header><h2>${escape(zone.title)}</h2><p>${escape(zone.subtitle)}</p></header>
          <div class="rack-grid">${racksHtml}</div>
        </section>`;
      })
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Sơ đồ lưu trữ — ${escape(this.factory)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; padding: 10mm; font-size: 9pt; }
  h1 { font-size: 14pt; margin-bottom: 2mm; }
  .meta { font-size: 8pt; color: #475569; margin-bottom: 4mm; }
  .zone { margin-bottom: 5mm; page-break-inside: avoid; }
  .zone header h2 { font-size: 11pt; }
  .zone header p { font-size: 7.5pt; color: #64748b; margin: 1mm 0 2mm; }
  .rack-grid { display: flex; flex-wrap: wrap; gap: 2.5mm; }
  .rack {
    border: 1px solid #38bdf8; border-radius: 2mm; padding: 1.5mm;
    width: 32mm; min-height: 38mm;
  }
  .rack-id { font-weight: 900; text-align: center; font-size: 10pt; }
  .rack-kh { text-align: center; font-size: 7pt; font-weight: 700; min-height: 2.5mm; }
  .levels { display: flex; flex-direction: column; gap: 1mm; margin-top: 1mm; }
  .lv { border: 1px solid #bae6fd; border-radius: 1mm; padding: 0.8mm 1mm; }
  .lv.sample { background: #fef9c3; border-color: #facc15; }
  .lv.wrong { background: #fef2f2; border-color: #dc2626; }
  .lv-h { display: flex; justify-content: space-between; gap: 1mm; font-size: 7pt; }
  .lv-h b { font-weight: 800; }
  .pls { display: flex; gap: 0.6mm; margin-top: 0.6mm; }
  .pl {
    flex: 1; text-align: center; border: 1px solid #7dd3fc; border-radius: 0.6mm;
    font-size: 7pt; font-weight: 800; padding: 0.4mm 0;
  }
  .pl.wrong { background: #fee2e2; border-color: #dc2626; }
  .rack-meta { text-align: center; font-size: 6.5pt; color: #64748b; margin-top: 1mm; }
  @page { size: A4 portrait; margin: 8mm; }
  @media print {
    body { padding: 0; }
    .zone { break-inside: avoid; }
  }
</style></head><body>
  <h1>Sơ đồ lưu trữ</h1>
  <p class="meta">Nhà máy: <b>${escape(this.factory)}</b> · In lúc ${new Date().toLocaleString('vi-VN')} · Mâm A/B/C · A1.2 = SAMPLE</p>
  ${zonesHtml}
  <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      alert('Không mở được cửa sổ in. Cho phép popup rồi thử lại.');
      return;
    }
    w.document.write(html);
    w.document.close();
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
      // Đã update location tại chỗ (cùng reference với inventoryLines của parent) —
      // vẽ lại sơ đồ ngay từ dữ liệu đang có, khỏi đọc lại Firestore.
      this.rebuildZones();
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
