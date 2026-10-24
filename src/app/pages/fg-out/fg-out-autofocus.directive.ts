import { AfterViewInit, Directive, ElementRef } from '@angular/core';

/** Focus ô nhập ngay khi nó được dựng (ô chỉ dựng khi người dùng bấm vào để sửa). */
@Directive({ selector: '[foAutofocus]' })
export class FgOutAutofocusDirective implements AfterViewInit {
  constructor(private el: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.el.nativeElement.focus();
  }
}
