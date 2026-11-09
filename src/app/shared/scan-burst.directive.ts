import { Directive, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';

/**
 * Ô quét mã: máy quét gõ từng ký tự rất nhanh → ô hiện chữ chạy dần.
 * Directive giữ ký tự trong `appScanBurst` ms (mặc định 40) rồi điền cả cụm một lần,
 * nên mã quét hiện ra ngay một lúc. Gõ tay vẫn bình thường (trễ ~40ms).
 * Enter: điền ngay phần đang giữ trước khi (keyup.enter) xử lý.
 */
@Directive({ selector: 'input[appScanBurst]' })
export class ScanBurstDirective implements OnDestroy {
  @Input() appScanBurst: number | string = 40;

  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private el: ElementRef<HTMLInputElement>) {}

  private get delay(): number {
    const n = Number(this.appScanBurst);
    return Number.isFinite(n) && n > 0 ? n : 40;
  }

  @HostListener('keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === 'Tab') {
      this.flush();
      return;
    }
    if (e.key.length !== 1) {
      // Phím điều khiển (Backspace, mũi tên…): điền phần đang giữ trước để không đảo thứ tự
      this.flush();
      return;
    }
    e.preventDefault();
    this.buffer += e.key;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  @HostListener('blur')
  onBlur(): void {
    this.flush();
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer) return;
    const input = this.el.nativeElement;
    const text = this.buffer;
    this.buffer = '';
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const caret = start + text.length;
    try { input.setSelectionRange(caret, caret); } catch { /* type không hỗ trợ selection */ }
    // Cập nhật ngModel / (input) handler
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
