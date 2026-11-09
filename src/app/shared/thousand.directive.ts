import { Directive, ElementRef, HostListener, Input, OnChanges } from '@angular/core';

/** "12,500.5" → 12500.5; trống / không phải số → null. */
export function parseThousand(v: unknown): number | null {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 12500.5 → "12,500.5" (tối đa 4 số lẻ); chuỗi không phải số giữ nguyên. */
export function formatThousand(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : parseThousand(v);
  if (n === null) return String(v);
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/**
 * Ô số kiểu Excel: hiện dấu phẩy hàng ngàn khi không sửa (12,500), bấm vào hiện số trơn để sửa (12500).
 * Dùng 1 chiều: <input type="text" [appThousand]="row.qty" (change)="save(parseThousand($event.target.value))">.
 */
@Directive({ selector: 'input[appThousand]' })
export class ThousandDirective implements OnChanges {
  @Input() appThousand: number | string | null | undefined;

  private focused = false;

  constructor(private el: ElementRef<HTMLInputElement>) {
    el.nativeElement.setAttribute('inputmode', 'decimal');
    el.nativeElement.setAttribute('autocomplete', 'off');
  }

  ngOnChanges(): void {
    if (!this.focused) this.el.nativeElement.value = formatThousand(this.appThousand);
  }

  @HostListener('focus')
  onFocus(): void {
    this.focused = true;
    const input = this.el.nativeElement;
    const raw = parseThousand(input.value);
    input.value = raw === null ? '' : String(raw);
    try { input.select(); } catch { /* bỏ qua */ }
  }

  @HostListener('blur')
  onBlur(): void {
    this.focused = false;
    const input = this.el.nativeElement;
    input.value = formatThousand(input.value);
  }
}
