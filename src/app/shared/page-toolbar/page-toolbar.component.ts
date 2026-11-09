import { Component, Input } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

/**
 * Thanh nút đầu trang chuẩn (quy tắc giao diện trong CLAUDE.md):
 * [← Back] [⌂ Menu] | Tiêu đề | ……… nút của trang (ng-content) ………
 *
 * Dùng:
 *   <app-page-toolbar title="Aging Report">
 *     <button class="app-btn"><i class="material-icons">download</i>Xuất Excel</button>
 *   </app-page-toolbar>
 *
 * Nút đặt bên trong nên dùng class `app-btn` để cùng cao 36px, bo góc, cùng tone.
 * Nhớ đặt cờ `hideNavbar: true` cho tab trong routes/app-tabs.ts để không bị thanh hệ thống đè.
 */
@Component({
  selector: 'app-page-toolbar',
  template: `
    <div class="ptb">
      <div class="ptb__nav">
        <button *ngIf="showBack" type="button" class="app-btn" (click)="back()" title="Quay lại">
          <i class="material-icons">arrow_back</i>Back
        </button>
        <button *ngIf="showMenu" type="button" class="app-btn" (click)="menu()" title="Về Menu">
          <i class="material-icons">home</i>Menu
        </button>
      </div>
      <div class="ptb__title" *ngIf="title">{{ title }}</div>
      <div class="ptb__actions"><ng-content></ng-content></div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ptb { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0; min-height: 52px; box-sizing: border-box; }
    .ptb__nav, .ptb__actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .ptb__nav { padding-right: 8px; border-right: 1px solid var(--app-border, #d0d0d0); }
    .ptb__title { font: 700 16px var(--app-font, Arial, sans-serif); color: var(--app-text, #111); white-space: nowrap; }
    .ptb__actions { margin-left: auto; }
    @media (max-width: 600px) { .ptb__title { width: 100%; order: -1; } .ptb__actions { margin-left: 0; } }
  `]
})
export class PageToolbarComponent {
  @Input() title = '';
  @Input() showBack = true;
  @Input() showMenu = true;

  constructor(private location: Location, private router: Router) {}

  back(): void {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/menu']);
  }

  menu(): void {
    void this.router.navigate(['/menu']);
  }
}
