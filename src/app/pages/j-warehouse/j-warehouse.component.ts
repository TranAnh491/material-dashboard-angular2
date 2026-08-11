import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

/**
 * J Warehouse — sơ đồ khung 1 kho.
 * A ↔ D = 105m (dài), B ↔ C = 30m (rộng).
 * Nội thất / kệ sẽ bổ sung theo hướng dẫn tiếp.
 */
@Component({
  selector: 'app-j-warehouse',
  templateUrl: './j-warehouse.component.html',
  styleUrls: ['./j-warehouse.component.scss']
})
export class JWarehouseComponent {
  /** Chiều dài kho: cạnh A ↔ D */
  readonly LENGTH_M = 105;
  /** Chiều rộng kho: cạnh B ↔ C */
  readonly WIDTH_M = 30;

  /** px / mét trong viewBox SVG */
  private readonly SCALE = 10;

  readonly svgWidth = this.LENGTH_M * this.SCALE;
  readonly svgHeight = this.WIDTH_M * this.SCALE;

  /** Padding quanh mặt sàn (chừa chỗ nhãn cạnh + kích thước) */
  readonly padL = 40;
  readonly padR = 72;
  readonly padT = 40;
  readonly padB = 72;

  /** Vạch lưới mỗi 5m */
  readonly gridX = Array.from({ length: Math.floor(this.LENGTH_M / 5) - 1 }, (_, i) => (i + 1) * 5);
  readonly gridY = Array.from({ length: Math.floor(this.WIDTH_M / 5) - 1 }, (_, i) => (i + 1) * 5);

  get viewBoxW(): number {
    return this.svgWidth + this.padL + this.padR;
  }

  get viewBoxH(): number {
    return this.svgHeight + this.padT + this.padB;
  }

  get viewBox(): string {
    return `0 0 ${this.viewBoxW} ${this.viewBoxH}`;
  }

  get floor() {
    return {
      x: this.padL,
      y: this.padT,
      w: this.svgWidth,
      h: this.svgHeight
    };
  }

  meterX(m: number): number {
    return this.floor.x + (m / this.LENGTH_M) * this.floor.w;
  }

  meterY(m: number): number {
    return this.floor.y + (m / this.WIDTH_M) * this.floor.h;
  }

  constructor(private router: Router, private location: Location) {}

  goBack(): void {
    this.location.back();
  }

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }
}
