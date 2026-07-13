import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
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

/**
 * Sơ đồ tĩnh Kho ASM3 — 30m (ngang, mặt A↔D) x 100m (dài, mặt C↔B).
 * 8 dãy kệ A–H nằm NGANG, mỗi kệ dài 30m dọc theo chiều dài (F3-A1..A30, ~1m/ô),
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

  @ViewChild('viewport') viewportRef?: ElementRef<HTMLDivElement>;

  zoom = 1;
  private fitZoom = 1;

  selectedSlot: Asm3RackSlot | null = null;
  hoveredSlot: Asm3RackSlot | null = null;

  readonly rackLetters: string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  readonly slotIndexes: number[] = Array.from({ length: this.SLOTS_PER_RACK }, (_, i) => i + 1);

  showPrintLabelModal = false;
  printLabelRow = 'A';
  printLabelIndex = 1;
  isPrintingLabel = false;

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.rackRows = this.buildRackRows();
    this.aisleZones = this.buildAisleZones();
    setTimeout(() => this.applyFitZoom(), 0);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.applyFitZoom(false);
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
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
            name: `F3-${letter}${i + 1}`,
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

  selectSlot(slot: Asm3RackSlot): void {
    this.selectedSlot = slot;
  }

  onSlotHover(slot: Asm3RackSlot | null): void {
    this.hoveredSlot = slot;
  }

  clearSelection(): void {
    this.selectedSlot = null;
    this.hoveredSlot = null;
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
    return `F3-${this.printLabelRow}${this.printLabelIndex}`;
  }

  /** In tem vị trí 57×32mm — QR bên trái, chữ "F3-Xy" bên phải (giống tem vị trí ở tab Location). */
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
    this.zoom = Math.min(5, Math.max(0.5, Math.round((this.zoom + delta) * 10) / 10));
  }

  resetZoom(): void {
    this.zoom = this.fitZoom;
  }

  private applyFitZoom(updateCurrent = true): void {
    const vp = this.viewportRef?.nativeElement;
    if (!vp) return;

    const padSide = 24;
    const availableW = vp.clientWidth - padSide * 2;
    const availableH = vp.clientHeight - padSide * 2;
    const scaleW = availableW / this.svgWidth;
    const scaleH = availableH / this.svgHeight;
    const fit = Math.min(scaleW, scaleH) * 0.96;

    this.fitZoom = Math.min(5, Math.max(0.5, Math.round(fit * 100) / 100));
    if (updateCurrent) {
      this.zoom = this.fitZoom;
    }
  }
}
