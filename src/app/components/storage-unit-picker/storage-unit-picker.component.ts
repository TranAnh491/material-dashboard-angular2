import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import {
  STORAGE_UNIT_SIZE_OPTIONS,
  StorageUnitSize,
  StorageUnitSizeOption
} from '../../models/storage-unit.model';

type Point = { x: number; y: number };

/** Khối pallet 1m³ — tọa độ isometric cố định */
const CUBE = {
  top: {
    nw: { x: 34, y: 54 },
    ne: { x: 82, y: 28 },
    se: { x: 126, y: 54 },
    sw: { x: 82, y: 78 }
  },
  bottom: {
    nw: { x: 34, y: 104 },
    ne: { x: 82, y: 78 },
    se: { x: 126, y: 104 },
    sw: { x: 82, y: 130 }
  }
} as const;

@Component({
  selector: 'app-storage-unit-picker',
  templateUrl: './storage-unit-picker.component.html',
  styleUrls: ['./storage-unit-picker.component.scss']
})
export class StorageUnitPickerComponent implements OnChanges {
  @Input() visible = false;
  @Input() batchNumber = '';
  @Input() factory = '';
  @Input() saving = false;

  @Output() closed = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<StorageUnitSize>();

  readonly options = STORAGE_UNIT_SIZE_OPTIONS;
  readonly cubeTop = CUBE.top;
  readonly cubeBottom = CUBE.bottom;

  selected: StorageUnitSize | null = null;
  preview: StorageUnitSizeOption = this.options[0];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true) {
      this.selected = null;
      this.preview = this.options[0];
    }
  }

  pointsToAttr(points: Point[]): string {
    return points.map(p => `${p.x},${p.y}`).join(' ');
  }

  /** Điểm trên cạnh dọc từ đáy → đỉnh theo fraction */
  private edgePoint(bottom: Point, top: Point, fraction: number): Point {
    const f = Math.max(0, Math.min(1, fraction));
    return {
      x: bottom.x + (top.x - bottom.x) * f,
      y: bottom.y + (top.y - bottom.y) * f
    };
  }

  private fillLevel(fraction: number): number {
    return Math.max(0, Math.min(1, fraction));
  }

  /** Mặt trái — phần hàng (từ đáy lên) */
  getLeftFillPoints(fraction: number): string {
    const f = this.fillLevel(fraction);
    if (f <= 0) return '';
    const bl = CUBE.bottom.nw;
    const br = CUBE.bottom.sw;
    const tl = this.edgePoint(bl, CUBE.top.nw, f);
    const tr = this.edgePoint(br, CUBE.top.sw, f);
    return this.pointsToAttr([bl, br, tr, tl]);
  }

  /** Mặt phải — phần hàng */
  getRightFillPoints(fraction: number): string {
    const f = this.fillLevel(fraction);
    if (f <= 0) return '';
    const bl = CUBE.bottom.sw;
    const br = CUBE.bottom.se;
    const tl = this.edgePoint(bl, CUBE.top.sw, f);
    const tr = this.edgePoint(br, CUBE.top.se, f);
    return this.pointsToAttr([bl, br, tr, tl]);
  }

  /** Mặt trên của lớp hàng (mặt phẳng ngang ở độ cao fraction) */
  getFillCapPoints(fraction: number): string {
    const f = this.fillLevel(fraction);
    if (f <= 0) return '';
    const nw = this.edgePoint(CUBE.bottom.nw, CUBE.top.nw, f);
    const sw = this.edgePoint(CUBE.bottom.sw, CUBE.top.sw, f);
    const se = this.edgePoint(CUBE.bottom.se, CUBE.top.se, f);
    const ne = this.edgePoint(CUBE.bottom.ne, CUBE.top.ne, f);
    return this.pointsToAttr([nw, sw, se, ne]);
  }

  showFillCap(fraction: number): boolean {
    return this.fillLevel(fraction) > 0.02;
  }

  onSelect(option: StorageUnitSizeOption): void {
    this.selected = option.size;
    this.preview = option;
  }

  onHover(option: StorageUnitSizeOption): void {
    if (this.selected) return;
    this.preview = option;
  }

  confirm(): void {
    if (!this.selected || this.saving) return;
    this.confirmed.emit(this.selected);
  }

  close(): void {
    if (this.saving) return;
    this.closed.emit();
  }
}
