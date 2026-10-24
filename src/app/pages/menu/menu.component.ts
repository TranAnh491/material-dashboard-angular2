import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { MobileDetectionService } from '../../services/mobile-detection.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { APP_TABS } from '../../routes/app-tabs';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent implements OnInit, OnDestroy {
  
  isMobile: boolean = false;
  searchTerm: string = '';

  private lastFilterKey = '';

  filteredByCategory: Record<string, MenuTabView[]> = {
    Main: [],
    Production: [],
    'Stock Check': [],
    'RM': [],
    Quality: [],
    'ASM FG': [],
    Tools: [],
    Admin: []
  };
  
  // Danh sách các tab không hỗ trợ mobile (chỉ chạy trên desktop) — nguồn dùng chung ở
  // MobileDetectionService, để TabPermissionGuard cũng chặn đúng những tab này khi vào thẳng URL.
  get desktopOnlyTabs(): string[] {
    return this.mobileDetection.desktopOnlyTabPaths;
  }

  // Danh sách thẻ — nguồn chung ở routes/app-tabs.ts (tab có khai báo `menu`)
  menuTabs: MenuTab[] = APP_TABS.filter(t => t.menu).map(t => ({
    path: t.path,
    title: t.title,
    icon: t.menu!.icon,
    iconImage: t.menu!.iconImage,
    category: t.menu!.category,
    subtitle: t.subtitle,
  }));

  private readonly iconAccentByPath: Record<string, { bg: string; border: string; fg: string }> = {
    '/dashboard': { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.18)', fg: '#2563eb' },
    '/work-order-status': { bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.18)', fg: '#ea580c' },
    '/shipment': { bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.18)', fg: '#7c3aed' },
    '/location': { bg: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.18)', fg: '#e11d48' },
    '/rm1-delivery': { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.18)', fg: '#2563eb' }
  };

  private readonly lineIconHtmlByPath: Record<string, SafeHtml> = {};
  private readonly tabViews: MenuTabView[] = [];

  constructor(
    private router: Router,
    private authService: FirebaseAuthService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private mobileDetection: MobileDetectionService
  ) { }

  ngOnInit(): void {
    this.detectMobileDevice();
    this.buildTabViews();
    this.updateFiltered();
  }

  ngOnDestroy(): void { }
  
  @HostListener('window:resize', ['$event'])
  onResize(event: any): void {
    this.detectMobileDevice();
    this.updateFiltered();
  }
  
  private detectMobileDevice(): void {
    this.isMobile = this.mobileDetection.isMobileOrTablet();
  }

  isDesktopOnly(path: string): boolean {
    return this.mobileDetection.isDesktopOnlyPath(path);
  }

  private norm(s: unknown): string {
    return String(s ?? '').trim().toLowerCase();
  }

  onSearchTermChange(value: string): void {
    this.searchTerm = value;
    this.updateFiltered();
  }

  private buildTabViews(): void {
    // Build once so template doesn't keep calling methods per change detection
    const svg = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

    const rawIconsByPath: Record<string, string> = {
      '/dashboard': svg('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l3-4 3 2 4-6"/>'),
      '/work-order-status': svg('<path d="M9 6h10"/><path d="M9 10h10"/><path d="M9 14h6"/><path d="M5 6h.01"/><path d="M5 10h.01"/><path d="M5 14h.01"/><path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>'),
      '/shipment': svg('<path d="M3 7h12v10H3z"/><path d="M15 10h4l2 2v5h-6z"/><circle cx="7" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>'),
      '/location': svg('<path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>'),
      '/rm1-delivery': svg('<path d="M4 7h10v10H4z"/><path d="M14 10h4l2 2v5h-6z"/><path d="M7 19h.01"/><path d="M17 19h.01"/><path d="M6.5 19a.5.5 0 0 1 1 0"/><path d="M16.5 19a.5.5 0 0 1 1 0"/>')
    };

    const defaultSvg = svg('<path d="M12 3l9 4.5v9L12 21 3 16.5v-9L12 3z"/><path d="M12 12l9-4.5"/><path d="M12 12L3 7.5"/><path d="M12 12v9"/>');
    for (const tab of this.menuTabs) {
      const path = String(tab.path || '').trim();
      if (!this.lineIconHtmlByPath[path]) {
        const html = rawIconsByPath[path] || defaultSvg;
        this.lineIconHtmlByPath[path] = this.sanitizer.bypassSecurityTrustHtml(html);
      }
      const accent = this.iconAccentByPath[path] || { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.12)', fg: '#2563eb' };
      this.tabViews.push({
        ...tab,
        accent,
        lineIcon: this.lineIconHtmlByPath[path]
      });
    }
  }

  private updateFiltered(): void {
    const q = this.norm(this.searchTerm);
    const key = `${this.isMobile ? 'm' : 'd'}|${q}`;
    if (key === this.lastFilterKey) return;
    this.lastFilterKey = key;

    const base = this.tabViews.filter(t => !this.isMobile || !this.isDesktopOnly(t.path));
    const filtered = !q
      ? base
      : base.filter(t => this.norm(t.title).includes(q) || this.norm(t.path).includes(q) || this.norm(t.category).includes(q));

    const next: Record<string, MenuTabView[]> = {
      Main: [],
      'Stock Check': [],
      'RM': [],
      Quality: [],
      'ASM FG': [],
      Tools: [],
      Report: [],
      Admin: []
    };
    for (const t of filtered) {
      (next[t.category] ||= []).push(t);
    }
    this.filteredByCategory = next;
    this.cdr.markForCheck();
  }

  getMenuCardSubtitle(tab: MenuTabView): string {
    if (tab.subtitle) {
      return tab.subtitle;
    }
    const byCategory: Record<string, string> = {
      Main: 'Quản lý vận hành và giao hàng',
      Production: 'Giám sát sản xuất',
      'RM': 'Nhập — xuất — tồn nguyên liệu (ASM1 & ASM2)',
      Quality: 'Kiểm soát chất lượng',
      'ASM FG': 'Quản lý thành phẩm',
      Report: 'Báo cáo và phân tích',
      Tools: 'Công cụ hỗ trợ vận hành',
      Admin: 'Quản trị hệ thống',
    };
    return byCategory[tab.category] || '';
  }

  trackByPath(_: number, tab: MenuTabView): string {
    return tab.path;
  }
  
  navigateToTab(path: string): void {
    this.router.navigate([path]);
  }

  async logout(): Promise<void> {
    try {
      await this.authService.signOut();
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Đăng xuất thất bại:', error);
    }
  }
}

type MenuTab = {
  path: string;
  title: string;
  icon: string;
  iconImage?: string;
  category: string;
  subtitle?: string;
};
type MenuTabView = MenuTab & {
  accent: { bg: string; border: string; fg: string };
  lineIcon: SafeHtml;
};
