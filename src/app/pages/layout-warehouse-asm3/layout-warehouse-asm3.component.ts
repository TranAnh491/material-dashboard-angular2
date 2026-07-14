import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as QRCode from 'qrcode';

interface Asm3RackSlot {
  name: string;
  row: string;
  index: number;
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

interface Asm3RackRow {
  letter: string;
  /** Vị trí theo chiều ngang (trục Y trên sơ đồ) */
  yM: number;
  /** Bề dày kệ theo chiều ngang (trục Y) */
  hM: number;
  slots: Asm3RackSlot[];
}

interface Asm3AisleZone {
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

interface Asm3AisleLabel {
  xM: number;
  yM: number;
  wM: number;
  hM: number;
  label: string;
}

interface GridMapBlock {
  type: 'row' | 'aisle';
  row?: Asm3RackRow;
  aisleLabel?: string;
}

/**
 * Sơ đồ tĩnh Kho ASM3 — 30m (ngang, mặt A↔D) x 100m (dài, mặt C↔B).
 * 8 dãy kệ A–H nằm NGANG, mỗi kệ dài 30m dọc theo chiều dài (WH3-A1..A30, ~1m/ô),
 * xếp CHỒNG từ trên xuống dọc chiều ngang: dãy A trên cùng (cách mặt C 5m),
 * cả khối kệ cách mặt A 10m. A | 2m | B,C (sát nhau) | 2m | D,E (sát nhau) | 2m | F,G (sát nhau) | 2m | H.
 */
@Component({
  selector: 'app-layout-warehouse-asm3',
  templateUrl: './layout-warehouse-asm3.component.html',
  styleUrls: ['./layout-warehouse-asm3.component.scss']
})
export class LayoutWarehouseAsm3Component implements OnInit {
  private readonly WAREHOUSE_WIDTH_M = 30; // mặt A (trái) ↔ mặt D (phải) — chồng 8 dãy kệ dọc theo đây
  private readonly WAREHOUSE_LENGTH_M = 100; // mặt C (trên) ↔ mặt B (dưới) — mỗi kệ dài 30 ô dọc theo đây
  private readonly SLOTS_PER_RACK = 30;
  /** Bề rộng 1 ô (pallet) — không đổi khi xoay sơ đồ */
  private readonly SLOT_LEN_M = 1;
  private readonly RACK_DEPTH_M = 1.5;
  private readonly AISLE_GAP_M = 2;
  /** Dãy A cách mặt C 5m */
  private readonly TOP_MARGIN_M = 5;
  /** Cả khối kệ cách mặt A 10m */
  readonly LEFT_MARGIN_M = 10;
  /** px / mét trong viewBox SVG */
  private readonly SCALE = 12;

  readonly svgWidth = this.WAREHOUSE_LENGTH_M * this.SCALE;
  readonly svgHeight = this.WAREHOUSE_WIDTH_M * this.SCALE;

  rackRows: Asm3RackRow[] = [];
  aisleZones: Asm3AisleZone[] = [];
  aisleLabels: Asm3AisleLabel[] = [];
  gridBlocks: GridMapBlock[] = [];

  readonly CELL_W = 26;
  readonly CELL_H = 22;
  readonly GRID_GAP = 3;
  readonly ROW_LABEL_W = 30;
  readonly colHeaders: string[] = Array.from({ length: 30 }, (_, i) =>
    String(i + 1).padStart(2, '0')
  );

  @ViewChild('viewport') viewportRef?: ElementRef<HTMLDivElement>;
  @ViewChild('searchInputRef') searchInputRef?: ElementRef<HTMLInputElement>;

  zoom = 1;
  private fitZoom = 1;

  isMobileLayout = false;
  private readonly MOBILE_BREAKPOINT = 768;

  searchQuery = '';
  filterRow = 'ALL';
  lastUpdated: Date | null = null;

  selectedSlot: Asm3RackSlot | null = null;
  hoveredSlot: Asm3RackSlot | null = null;

  readonly rackLetters: string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  readonly slotIndexes: number[] = Array.from({ length: this.SLOTS_PER_RACK }, (_, i) => i + 1);

  showPrintLabelModal = false;
  printLabelRow = 'A';
  printLabelIndex = 1;
  isPrintingLabel = false;

  /** Mã pallet đang gán cho từng ô — key = tên ô (VD: WH3-A1). */
  slotPallets: Map<string, string> = new Map();
  showScanInput = false;
  scanPalletInput = '';
  isSavingPallet = false;

  /** Chế độ đổi vị trí: chọn ô nguồn (có pallet) → chọn ô đích trống. */
  moveMode = false;
  moveFromSlot: Asm3RackSlot | null = null;
  movePalletCode = '';
  isMovingPallet = false;

  private readonly SLOT_PALLET_COLLECTION = 'asm3-slot-pallets';
  /** Tiền tố mã vị trí kho ASM3 — VD: WH3-A1 */
  private readonly WAREHOUSE_SLOT_PREFIX = 'WH3';

  @ViewChild('scanPalletInputRef') scanPalletInputRef?: ElementRef<HTMLInputElement>;

  constructor(private router: Router, private location: Location, private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.rackRows = this.buildRackRows();
    this.aisleZones = this.buildAisleZones();
    this.aisleLabels = this.buildAisleLabels();
    this.gridBlocks = this.buildGridBlocks();
    this.updateLayoutMode();
    setTimeout(() => this.applyFitZoom(), 0);
    void this.loadSlotPallets();
  }

  get totalSlots(): number {
    return this.rackRows.length * this.SLOTS_PER_RACK;
  }

  get occupiedCount(): number {
    return this.slotPallets.size;
  }

  get emptyCount(): number {
    return Math.max(0, this.totalSlots - this.occupiedCount);
  }

  get utilizationPct(): number {
    if (!this.totalSlots) return 0;
    return Math.round((this.occupiedCount / this.totalSlots) * 100);
  }

  get displayGridBlocks(): GridMapBlock[] {
    if (this.filterRow === 'ALL') return this.gridBlocks;
    const row = this.rackRows.find(r => r.letter === this.filterRow);
    return row ? [{ type: 'row', row }] : [];
  }

  get gridNaturalWidth(): number {
    return this.ROW_LABEL_W + this.SLOTS_PER_RACK * (this.CELL_W + this.GRID_GAP);
  }

  get gridNaturalHeight(): number {
    let h = 24;
    for (const block of this.displayGridBlocks) {
      h += block.type === 'aisle' ? 32 : this.CELL_H + this.GRID_GAP;
    }
    return h + 12;
  }

  private async loadSlotPallets(): Promise<void> {
    try {
      const snap = await this.firestore.collection(this.SLOT_PALLET_COLLECTION).get().toPromise();
      const map = new Map<string, string>();
      (snap?.docs || []).forEach(doc => {
        const data = doc.data() as { palletCode?: string };
        const code = String(data?.palletCode || '').trim();
        if (code) map.set(this.normalizeSlotName(doc.id), code);
      });
      this.slotPallets = map;
      this.lastUpdated = new Date();
    } catch (e) {
      console.error('[LayoutWarehouseAsm3] loadSlotPallets failed', e);
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateLayoutMode();
    this.applyFitZoom(false);
  }

  @HostListener('document:keydown', ['$event'])
  onDocKeydown(ev: KeyboardEvent): void {
    if (ev.key === '/' && !this.isInputFocused()) {
      ev.preventDefault();
      this.focusSearch();
    }
  }

  private isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  /** Nhãn ngắn trên ô lưới — VD: A1, B15 (không gồm tiền tố WH3). */
  slotShortCode(slot: Asm3RackSlot | null): string {
    if (!slot) return '';
    return `${slot.row}${slot.index}`;
  }

  private buildSlotName(row: string, index: number): string {
    return `${this.WAREHOUSE_SLOT_PREFIX}-${row}${index}`;
  }

  private normalizeSlotName(slotName: string): string {
    return slotName.trim().replace(/^F3-/i, `${this.WAREHOUSE_SLOT_PREFIX}-`);
  }

  private updateLayoutMode(): void {
    const w = window.innerWidth;
    this.isMobileLayout = w < this.MOBILE_BREAKPOINT;
  }

  private buildGridBlocks(): GridMapBlock[] {
    const groups: string[][] = [['A'], ['B', 'C'], ['D', 'E'], ['F', 'G'], ['H']];
    const blocks: GridMapBlock[] = [];
    let aisleNum = 1;

    groups.forEach((letters, groupIdx) => {
      if (groupIdx > 0) {
        blocks.push({ type: 'aisle', aisleLabel: `AISLE ${aisleNum++}` });
      }
      letters.forEach(letter => {
        const row = this.rackRows.find(r => r.letter === letter);
        if (row) blocks.push({ type: 'row', row });
      });
    });
    return blocks;
  }

  isSlotOccupied(slot: Asm3RackSlot | null): boolean {
    return !!this.palletAtSlot(slot);
  }

  isSearchMatch(slot: Asm3RackSlot): boolean {
    const q = this.searchQuery.trim().toUpperCase();
    if (!q) return false;
    return slot.name.toUpperCase().includes(q) || this.palletAtSlot(slot).toUpperCase().includes(q);
  }

  onFilterRowChange(): void {
    setTimeout(() => this.applyFitZoom(true), 0);
  }

  onSearchSubmit(): void {
    const q = this.searchQuery.trim().toUpperCase();
    if (!q) return;

    for (const row of this.rackRows) {
      for (const slot of row.slots) {
        if (slot.name.toUpperCase().includes(q) || this.palletAtSlot(slot).toUpperCase().includes(q)) {
          this.filterRow = 'ALL';
          this.selectSlot(slot);
          this.scrollToSlot(slot);
          return;
        }
      }
    }
    alert('Không tìm thấy vị trí hoặc pallet khớp.');
  }

  scrollToSlot(slot: Asm3RackSlot): void {
    setTimeout(() => {
      const el = this.viewportRef?.nativeElement?.querySelector(`[data-slot="${slot.name}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }, 50);
  }

  focusSearch(): void {
    this.searchInputRef?.nativeElement?.focus();
  }

  openQuickScan(): void {
    if (this.selectedSlot) {
      this.openScanForSelectedSlot();
      return;
    }
    alert('Vui lòng chọn một ô trên sơ đồ trước.');
  }

  openScanForFirstEmpty(): void {
    for (const row of this.rackRows) {
      for (const slot of row.slots) {
        if (!this.isSlotOccupied(slot)) {
          this.filterRow = 'ALL';
          this.selectSlot(slot);
          this.scrollToSlot(slot);
          this.openScanForSelectedSlot();
          return;
        }
      }
    }
    alert('Không còn ô trống.');
  }

  async refreshData(): Promise<void> {
    await this.loadSlotPallets();
  }

  exportLayout(): void {
    const lines = ['Vi_tri,Dãy,Ô,Pallet,Trạng_thái'];
    for (const row of this.rackRows) {
      for (const slot of row.slots) {
        const pallet = this.palletAtSlot(slot);
        lines.push([
          slot.name,
          slot.row,
          String(slot.index),
          pallet || '',
          pallet ? 'Occupied' : 'Empty'
        ].join(','));
      }
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `asm3-layout-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  goBack(): void {
    this.location.back();
  }

  private buildRackRows(): Asm3RackRow[] {
    // A đứng riêng — B,C sát nhau — D,E sát nhau — F,G sát nhau — H đứng riêng (chồng từ trên xuống)
    const groups: string[][] = [['A'], ['B', 'C'], ['D', 'E'], ['F', 'G'], ['H']];
    const slotLenM = this.SLOT_LEN_M;

    const rows: Asm3RackRow[] = [];
    let cursorM = this.TOP_MARGIN_M;

    groups.forEach((group, groupIdx) => {
      group.forEach(letter => {
        const slots: Asm3RackSlot[] = [];
        for (let i = 0; i < this.SLOTS_PER_RACK; i++) {
          slots.push({
            name: this.buildSlotName(letter, i + 1),
            row: letter,
            index: i + 1,
            xM: this.LEFT_MARGIN_M + i * slotLenM,
            yM: cursorM,
            wM: slotLenM,
            hM: this.RACK_DEPTH_M
          });
        }
        rows.push({ letter, yM: cursorM, hM: this.RACK_DEPTH_M, slots });
        cursorM += this.RACK_DEPTH_M;
      });
      if (groupIdx < groups.length - 1) {
        cursorM += this.AISLE_GAP_M;
      }
    });

    return rows;
  }

  private buildAisleZones(): Asm3AisleZone[] {
    const zones: Asm3AisleZone[] = [];
    const rackSpanM = this.SLOTS_PER_RACK * this.SLOT_LEN_M;
    const xM = this.LEFT_MARGIN_M;
    const wM = rackSpanM;

    for (let i = 0; i < this.rackRows.length - 1; i++) {
      const current = this.rackRows[i];
      const next = this.rackRows[i + 1];
      const gapStart = current.yM + current.hM;
      const gapEnd = next.yM;
      const gapH = gapEnd - gapStart;
      if (gapH >= 1) {
        zones.push({ xM, yM: gapStart, wM, hM: gapH });
      }
    }
    return zones;
  }

  private buildAisleLabels(): Asm3AisleLabel[] {
    const labels: Asm3AisleLabel[] = [];
    let aisleNum = 1;
    for (let i = 0; i < this.rackRows.length - 1; i++) {
      const current = this.rackRows[i];
      const next = this.rackRows[i + 1];
      const gapStart = current.yM + current.hM;
      const gapEnd = next.yM;
      const gapH = gapEnd - gapStart;
      if (gapH >= 1.5) {
        labels.push({
          xM: this.LEFT_MARGIN_M,
          yM: gapStart,
          wM: this.SLOTS_PER_RACK * this.SLOT_LEN_M,
          hM: gapH,
          label: `AISLE ${aisleNum++}`
        });
      }
    }
    return labels;
  }

  selectSlot(slot: Asm3RackSlot): void {
    if (this.moveMode && this.moveFromSlot) {
      void this.completeMoveToSlot(slot);
      return;
    }

    this.selectedSlot = slot;
    if (this.isSlotOccupied(slot)) {
      this.showScanInput = false;
      this.scanPalletInput = '';
    }
    this.scrollToSlot(slot);
  }

  onSlotHover(slot: Asm3RackSlot | null): void {
    this.hoveredSlot = slot;
  }

  clearSelection(): void {
    if (this.moveMode) return;
    this.selectedSlot = null;
    this.hoveredSlot = null;
    this.showScanInput = false;
    this.scanPalletInput = '';
    setTimeout(() => this.applyFitZoom(false), 0);
  }

  startMovePosition(): void {
    if (!this.selectedSlot || !this.isSlotOccupied(this.selectedSlot)) {
      alert('Chỉ đổi vị trí được khi ô đang có pallet.');
      return;
    }
    this.moveMode = true;
    this.moveFromSlot = this.selectedSlot;
    this.movePalletCode = this.palletAtSlot(this.selectedSlot);
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  cancelMovePosition(): void {
    this.moveMode = false;
    this.moveFromSlot = null;
    this.movePalletCode = '';
    this.isMovingPallet = false;
  }

  private async completeMoveToSlot(target: Asm3RackSlot): Promise<void> {
    if (!this.moveFromSlot || this.isMovingPallet) return;

    if (target.name === this.moveFromSlot.name) {
      this.cancelMovePosition();
      this.selectedSlot = target;
      return;
    }

    if (this.isSlotOccupied(target)) {
      alert(`Vị trí ${this.slotShortCode(target)} đã có pallet. Hãy chọn ô trống.`);
      return;
    }

    const fromName = this.moveFromSlot.name;
    const toName = target.name;
    const palletCode = this.movePalletCode;
    if (!palletCode) {
      this.cancelMovePosition();
      return;
    }

    if (!confirm(`Chuyển pallet "${palletCode}" từ ${this.slotShortCode(this.moveFromSlot)} → ${this.slotShortCode(target)}?`)) {
      return;
    }

    this.isMovingPallet = true;
    try {
      const col = this.firestore.collection(this.SLOT_PALLET_COLLECTION);
      await col.doc(toName).set({
        slotName: toName,
        palletCode,
        updatedAt: new Date(),
        movedFrom: fromName
      });
      await col.doc(fromName).delete();

      this.slotPallets.delete(fromName);
      this.slotPallets.set(toName, palletCode);
      this.slotPallets = new Map(this.slotPallets);
      this.lastUpdated = new Date();

      this.cancelMovePosition();
      this.selectedSlot = target;
      this.scrollToSlot(target);
    } catch (e) {
      console.error('[LayoutWarehouseAsm3] move pallet failed', e);
      alert('Lỗi khi đổi vị trí. Vui lòng thử lại.');
    } finally {
      this.isMovingPallet = false;
    }
  }

  palletAtSlot(slot: Asm3RackSlot | null): string {
    if (!slot) return '';
    return this.slotPallets.get(slot.name) || '';
  }

  openScanForSelectedSlot(): void {
    if (!this.selectedSlot) return;
    if (this.isSlotOccupied(this.selectedSlot)) {
      alert('Vị trí này đã có pallet. Mỗi vị trí chỉ được gán một pallet. Xóa pallet hiện tại trước khi gán mới.');
      return;
    }
    this.showScanInput = true;
    this.scanPalletInput = '';
    setTimeout(() => this.scanPalletInputRef?.nativeElement?.focus(), 0);
  }

  cancelScanPallet(): void {
    this.showScanInput = false;
    this.scanPalletInput = '';
  }

  async submitScanPallet(): Promise<void> {
    if (!this.selectedSlot || this.isSavingPallet) return;
    const code = this.scanPalletInput.trim();
    if (!code) return;

    const slotName = this.selectedSlot.name;
    if (this.isSlotOccupied(this.selectedSlot)) {
      alert('Vị trí này đã có pallet. Mỗi vị trí chỉ được gán một pallet.');
      return;
    }

    const duplicateSlot = this.findSlotByPallet(code);
    if (duplicateSlot) {
      alert(`Pallet "${code}" đã được gán tại vị trí ${duplicateSlot}. Mỗi pallet chỉ được gán một vị trí.`);
      return;
    }

    this.isSavingPallet = true;
    try {
      await this.firestore.collection(this.SLOT_PALLET_COLLECTION).doc(slotName).set({
        slotName,
        palletCode: code,
        updatedAt: new Date()
      });
      this.slotPallets.set(slotName, code);
      this.slotPallets = new Map(this.slotPallets);
      this.lastUpdated = new Date();
      this.showScanInput = false;
      this.scanPalletInput = '';
    } catch (e) {
      console.error('[LayoutWarehouseAsm3] submitScanPallet failed', e);
      alert('Lỗi khi lưu pallet. Vui lòng thử lại.');
    } finally {
      this.isSavingPallet = false;
    }
  }

  private findSlotByPallet(palletCode: string, excludeSlot?: string): string | null {
    const code = palletCode.trim().toUpperCase();
    if (!code) return null;
    for (const [slotName, pallet] of this.slotPallets.entries()) {
      if (excludeSlot && slotName === excludeSlot) continue;
      if (pallet.trim().toUpperCase() === code) return slotName;
    }
    return null;
  }

  async clearSlotPallet(): Promise<void> {
    if (!this.selectedSlot) return;
    const slotName = this.selectedSlot.name;
    if (!this.slotPallets.has(slotName)) return;
    if (!confirm(`Xóa pallet đang gán cho ${slotName}?`)) return;

    try {
      await this.firestore.collection(this.SLOT_PALLET_COLLECTION).doc(slotName).delete();
      this.slotPallets.delete(slotName);
      this.slotPallets = new Map(this.slotPallets);
      this.lastUpdated = new Date();
    } catch (e) {
      console.error('[LayoutWarehouseAsm3] clearSlotPallet failed', e);
      alert('Lỗi khi xóa pallet. Vui lòng thử lại.');
    }
  }

  openPrintLabelModal(): void {
    if (this.selectedSlot) {
      this.printLabelRow = this.selectedSlot.row;
      this.printLabelIndex = this.selectedSlot.index;
    }
    this.showPrintLabelModal = true;
  }

  closePrintLabelModal(): void {
    if (this.isPrintingLabel) return;
    this.showPrintLabelModal = false;
  }

  get printLabelName(): string {
    return this.buildSlotName(this.printLabelRow, this.printLabelIndex);
  }

  /** In tem vị trí 57×32mm — QR bên trái, chữ "WH3-Xy" bên phải (giống tem vị trí ở tab Location). */
  async printAsm3Label(): Promise<void> {
    if (this.isPrintingLabel) return;
    this.isPrintingLabel = true;
    try {
      const name = this.printLabelName;
      const qrImage = await QRCode.toDataURL(name, {
        width: 280,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>Tem vị trí ${name}</title>
            <style>${this.buildLabelPrintCss()}</style>
          </head>
          <body>
            <div class="asm3-label">
              <div class="asm3-label__qr">
                <img src="${qrImage}" alt="QR ${name}">
              </div>
              <div class="asm3-label__text">${name}</div>
            </div>
            <div class="no-print asm3-label-actions">
              <button type="button" onclick="window.print()">In tem</button>
              <button type="button" onclick="window.close()">Đóng</button>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      this.showPrintLabelModal = false;
    } catch (e) {
      console.error('[LayoutWarehouseAsm3] print label failed', e);
      alert('Lỗi khi tạo mã QR. Vui lòng thử lại.');
    } finally {
      this.isPrintingLabel = false;
    }
  }

  private buildLabelPrintCss(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        background: #f0f0f0;
        width: 57mm;
        height: 32mm;
      }
      .asm3-label {
        width: 57mm;
        height: 32mm;
        border: 1px solid #000;
        display: flex;
        align-items: stretch;
        background: #fff;
        overflow: hidden;
      }
      .asm3-label__qr {
        width: 30mm;
        height: 32mm;
        display: flex;
        align-items: center;
        justify-content: center;
        border-right: 1px solid #ccc;
        flex-shrink: 0;
      }
      .asm3-label__qr img {
        width: 28mm;
        height: 28mm;
        object-fit: contain;
        display: block;
      }
      .asm3-label__text {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1mm 2mm;
        text-align: center;
        font-size: 18px;
        font-weight: bold;
        color: #000;
        word-break: break-word;
      }
      .asm3-label-actions {
        margin-top: 12px;
        text-align: center;
      }
      .asm3-label-actions button {
        margin: 0 6px;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        background: #007bff;
        color: #fff;
      }
      .asm3-label-actions button:last-child { background: #6c757d; }
      @media print {
        body { margin: 0 !important; padding: 0 !important; background: #fff !important; width: 57mm !important; height: 32mm !important; }
        @page { margin: 0; size: 57mm 32mm; }
        .no-print { display: none !important; }
        .asm3-label { box-shadow: none; border: 1px solid #000 !important; }
      }
    `;
  }

  px(m: number): number {
    return m * this.SCALE;
  }

  setZoom(delta: number): void {
    this.zoom = Math.min(2.5, Math.max(0.5, Math.round((this.zoom + delta) * 100) / 100));
  }

  setZoomFromSlider(value: number): void {
    this.zoom = Math.min(2.5, Math.max(0.5, Math.round(value * 100) / 100));
  }

  resetZoom(): void {
    this.zoom = this.fitZoom;
  }

  private applyFitZoom(updateCurrent = true): void {
    const vp = this.viewportRef?.nativeElement;
    if (!vp) return;

    const pad = this.getViewportPadding();
    const availableW = Math.max(200, vp.clientWidth - pad * 2);
    const availableH = Math.max(160, vp.clientHeight - pad * 2);
    const scaleW = availableW / this.gridNaturalWidth;
    const scaleH = availableH / this.gridNaturalHeight;
    const fit = Math.min(scaleW, scaleH) * (this.isMobileLayout ? 0.94 : 0.98);

    this.fitZoom = Math.min(2.5, Math.max(0.5, Math.round(fit * 100) / 100));
    if (updateCurrent) {
      this.zoom = this.fitZoom;
    }
  }

  private getViewportPadding(): number {
    if (this.isMobileLayout) return 8;
    if (window.innerWidth < 1200) return 14;
    return 20;
  }
}
