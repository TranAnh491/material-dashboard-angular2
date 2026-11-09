import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, OnDestroy, AfterViewInit, ElementRef, HostListener } from '@angular/core';
import { Subscription } from 'rxjs';
import { DomTranslator } from '../../shared/dom-translator';
import { LanguageService, AppLang } from '../../services/language.service';
import { MENU_VI_EN } from './menu-i18n';
import { Router } from '@angular/router';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { MobileDetectionService } from '../../services/mobile-detection.service';
import { APP_TABS } from '../../routes/app-tabs';
import { FilteredRoutesService } from '../../services/filtered-routes.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent implements OnInit, OnDestroy, AfterViewInit {
  lang: AppLang = 'vi';
  private translator: DomTranslator | null = null;
  private langSub?: Subscription;
  private accessSub?: Subscription;
  /** Quyền tab của tài khoản (Settings → quyền tab); null = đang đọc → chưa hiện thẻ nào. */
  private canOpen: ((path: string) => boolean) | null = null;
  private accessRev = 0;
  
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

  /** Icon riêng cho từng tab (Material Icons) — trước đây đa số dùng chung 1 icon khối hộp. */
  private static readonly ICON_BY_PATH: Record<string, string> = {
    '/dashboard': 'space_dashboard', '/work-order-status': 'assignment', '/shipment': 'local_shipping',
    '/location': 'place', '/danh-muc-nvl-tp': 'menu_book', '/j-warehouse': 'warehouse', '/report': 'analytics',
    '/shorted-materials': 'report_problem', '/pd-control': 'precision_manufacturing', '/jit': 'schedule_send',
    '/inbound': 'move_to_inbox', '/outbound': 'outbox', '/materials': 'inventory_2', '/quan-ly-nguyen-lieu': 'fact_check',
    '/inventory-overview': 'pie_chart', '/aging-report-nvl': 'hourglass_bottom', '/bag-history': 'history',
    '/label': 'label', '/qc': 'verified', '/nhiet-do': 'thermostat', '/equipment-checklist': 'build_circle',
    '/qc-traceability': 'timeline', '/fg-in': 'input', '/fg-out': 'output', '/fg-check': 'task_alt',
    '/fg-inventory': 'inventory', '/fg-inventory/tp-list': 'list_alt', '/aging-report': 'hourglass_top',
    '/fg-location': 'swap_horiz', '/pallet-id': 'qr_code_2', '/lich-lam-viec': 'calendar_month',
    '/materials-dashboard': 'insights', '/rm1-delivery': 'delivery_dining', '/xe-tai': 'airport_shuttle',
    '/bieu-mau': 'description', '/index': 'account_balance', '/sxxk': 'factory', '/scrap': 'delete_sweep',
    '/checklist': 'health_and_safety', '/equipment': 'school', '/tai-khoan': 'manage_accounts',
    '/settings': 'settings', '/zalo': 'chat', '/chuc-nang': 'help_center'
  };

  /** Màu nhẹ theo nhóm (thay vì mỗi thẻ một màu). */
  private static readonly TONE_BY_CATEGORY: Record<string, string> = {
    Main: 'blue', Production: 'violet', 'Stock Check': 'teal', RM: 'teal', Quality: 'green',
    'ASM FG': 'amber', Report: 'slate', Tools: 'slate', Admin: 'rose'
  };

  /** Thứ tự + tên nhóm (tiếng Việt; bấm EN thì DomTranslator dịch). */
  readonly categories: Array<{ key: string; label: string }> = [
    { key: 'Main', label: 'Chính' },
    { key: 'Production', label: 'Sản xuất' },
    { key: 'Stock Check', label: 'Kiểm kê' },
    { key: 'RM', label: 'Nguyên liệu (RM)' },
    { key: 'Quality', label: 'Chất lượng' },
    { key: 'ASM FG', label: 'Thành phẩm (FG)' },
    { key: 'Report', label: 'Báo cáo' },
    { key: 'Tools', label: 'Công cụ' },
    { key: 'Admin', label: 'Quản trị' }
  ];

  /** Tab mở gần đây từ Menu (lưu trong máy) */
  recentTabs: MenuTabView[] = [];
  private static readonly RECENT_KEY = 'menu-recent-v1';

  private readonly tabViews: MenuTabView[] = [];

  constructor(
    private router: Router,
    private authService: FirebaseAuthService,
    private cdr: ChangeDetectorRef,
    private mobileDetection: MobileDetectionService,
    private languageService: LanguageService,
    private host: ElementRef<HTMLElement>,
    private filteredRoutes: FilteredRoutesService
  ) { }

  ngOnInit(): void {
    this.detectMobileDevice();
    this.buildTabViews();
    this.updateFiltered();
    this.accessSub = this.filteredRoutes.getPathAccessChecker().subscribe((check) => {
      this.canOpen = check;
      this.accessRev += 1;
      this.updateFiltered();
    });
  }

  ngAfterViewInit(): void {
    this.translator = new DomTranslator(this.host.nativeElement, MENU_VI_EN);
    this.langSub = this.languageService.lang$.subscribe(l => {
      this.lang = l;
      this.translator?.setLang(l);
      this.cdr.markForCheck();
    });
  }

  toggleLang(): void {
    this.languageService.set(this.lang === 'vi' ? 'en' : 'vi');
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.accessSub?.unsubscribe();
    this.translator?.destroy();
  }
  
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

  /** Enter trong ô tìm → mở Tìm kiếm toàn app (tra tồn theo mã NVL, mở tab). */
  openGlobalSearch(): void {
    (window as any).openGlobalSearch?.(this.searchTerm.trim());
  }

  onSearchTermChange(value: string): void {
    this.searchTerm = value;
    this.updateFiltered();
  }

  private buildTabViews(): void {
    for (const tab of this.menuTabs) {
      const path = String(tab.path || '').trim();
      this.tabViews.push({
        ...tab,
        icon: MenuComponent.ICON_BY_PATH[path] || tab.icon || 'apps',
        tone: MenuComponent.TONE_BY_CATEGORY[tab.category] || 'slate'
      });
    }
  }

  private readRecent(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(MenuComponent.RECENT_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private rememberRecent(path: string): void {
    try {
      const next = [path, ...this.readRecent().filter((p) => p !== path)].slice(0, 6);
      localStorage.setItem(MenuComponent.RECENT_KEY, JSON.stringify(next));
    } catch { /* bỏ qua */ }
  }


  private updateFiltered(): void {
    const q = this.norm(this.searchTerm);
    const key = `${this.isMobile ? 'm' : 'd'}|${q}|${this.accessRev}`;
    if (key === this.lastFilterKey) return;
    this.lastFilterKey = key;

    // Trên điện thoại tab Quality đã dẫn thẳng tới màn quét Traceability → ẩn thẻ Traceability để khỏi trùng.
    // Điện thoại: ẩn một số tab; Nhiệt độ + Quản lý thiết bị chuyển sang nhóm Admin.
    const mobileHidden = ['/bag-history', '/scrap', '/xe-tai', '/tai-khoan', '/lich-lam-viec', '/qc-traceability'];
    const mobileToAdmin = ['/nhiet-do', '/equipment-checklist'];
    const base = this.tabViews
      // Chỉ hiện thẻ tài khoản được cấp quyền (cùng quy tắc với sidebar / TabPermissionGuard)
      .filter(t => !!this.canOpen && this.canOpen(t.path))
      .filter(t => !this.isMobile || (!this.isDesktopOnly(t.path) && !mobileHidden.includes(t.path)))
      .map(t => (this.isMobile && mobileToAdmin.includes(t.path) ? { ...t, category: 'Admin' } : t));
    const filtered = !q
      ? base
      : base.filter(t => this.norm(t.title).includes(q) || this.norm(t.path).includes(q) || this.norm(t.category).includes(q));

    const next: Record<string, MenuTabView[]> = {
      Main: [],
      Production: [],
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
    // Dùng gần đây: chỉ tab còn quyền mở, ẩn khi đang tìm
    const allowed = new Map(base.map((t) => [t.path, t]));
    this.recentTabs = q ? [] : this.readRecent().map((p) => allowed.get(p)).filter((t): t is MenuTabView => !!t).slice(0, 6);
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
    this.rememberRecent(path);
    this.router.navigate([path]);
  }

  hasAnyResult(): boolean {
    return this.categories.some((c) => (this.filteredByCategory[c.key] || []).length > 0);
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
  /** blue | violet | teal | green | amber | slate | rose */
  tone: string;
};
