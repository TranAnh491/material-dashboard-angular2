import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';

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

  @ViewChild('viewport') viewportRef?: ElementRef<HTMLDivElement>;

  zoom = 1;
  private fitZoom = 1;

  selectedSlot: Asm3RackSlot | null = null;

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.rackRows = this.buildRackRows();
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

  selectSlot(slot: Asm3RackSlot): void {
    this.selectedSlot = slot;
  }

  clearSelection(): void {
    this.selectedSlot = null;
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
