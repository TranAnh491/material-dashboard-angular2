import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { WeekFormat, fmtDmy, parseWeekCode, weekCodeText } from '../week-code';

export interface WeekInputResult {
  format: WeekFormat;
  value: string;
}

/**
 * Popup nhập Week trên tem (dùng chung Outbound / Quản lý NVL):
 * chọn YYWW (năm + tuần) hoặc MMYY (tháng + năm) → nhập 2 ô → Lưu.
 */
@Component({
  selector: 'app-week-input-popup',
  templateUrl: './week-input-popup.component.html',
  styleUrls: ['./week-input-popup.component.scss']
})
export class WeekInputPopupComponent implements OnInit {
  @Input() title = 'Week trên tem';
  @Input() subtitle = '';
  /** Dòng nhắc thêm (VD: "Lô này chưa có Week — nhập theo tem để xuất"). */
  @Input() note = '';
  @Input() format: WeekFormat = 'YYWW';
  @Input() value = '';
  @Input() saveLabel = 'Lưu';
  @Input() busy = false;
  @Output() saved = new EventEmitter<WeekInputResult>();
  @Output() cancelled = new EventEmitter<void>();

  a = '';
  b = '';

  ngOnInit(): void {
    const v = String(this.value || '');
    this.a = v.slice(0, 2);
    this.b = v.slice(2, 4);
    this.focusA();
  }

  private focusA(): void {
    setTimeout(() => (document.getElementById('weekInPopA') as HTMLInputElement | null)?.focus(), 60);
  }

  setFormat(f: WeekFormat): void {
    this.format = f;
    this.a = '';
    this.b = '';
    this.focusA();
  }

  onA(v: string): void {
    this.a = String(v || '').replace(/\D/g, '').slice(0, 2);
    if (this.a.length === 2) (document.getElementById('weekInPopB') as HTMLInputElement | null)?.focus();
  }

  onB(v: string): void {
    this.b = String(v || '').replace(/\D/g, '').slice(0, 2);
  }

  get code(): string {
    return this.a && this.b ? this.a.padStart(2, '0') + this.b.padStart(2, '0') : '';
  }

  get valid(): boolean {
    return !!parseWeekCode(this.format, this.code);
  }

  get preview(): string {
    if (!this.code) return '';
    const w = parseWeekCode(this.format, this.code);
    if (!w) return this.format === 'YYWW' ? '⚠️ Tuần không hợp lệ (1–52/53)' : '⚠️ Tháng không hợp lệ (1–12)';
    return `${weekCodeText(this.format, this.code)} · ${fmtDmy(w.start)} – ${fmtDmy(w.end)}`;
  }

  save(): void {
    if (!this.valid || this.busy) return;
    this.saved.emit({ format: this.format, value: this.code });
  }

  cancel(): void {
    if (this.busy) return;
    this.cancelled.emit();
  }
}
