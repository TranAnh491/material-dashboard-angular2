import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent implements OnInit {
  
  isMobile: boolean = false;
  searchTerm: string = '';

  private lastFilterKey = '';

  filteredByCategory: Record<string, MenuTabView[]> = {
    Main: [],
    Production: [],
    'ASM1 RM': [],
    Quality: [],
    'ASM2 RM': [],
    'ASM FG': [],
    Tools: [],
    Admin: []
  };
  
  // Danh sách các tab không hỗ trợ mobile (chỉ chạy trên desktop)
  // FG Check, FG Location, FG In được cho phép hiển thị trên mobile
  desktopOnlyTabs: string[] = [
    // Hide on mobile per request (keep on desktop)
    '/assistant',
    '/pxk-preview',
    '/find-rm1',
    '/bag-history',
    '/fg-overview',
    '/warehouse-loading',
    '/trace-back',
    '/qc',
    '/qc-traceability',
    '/safety',
    // PrintLabelComponent is routed as /label (admin-layout.routing.ts)
    '/label',
    '/work-order-status',
    '/shipment',
    '/inventory-overview-asm1',
    '/inventory-overview-asm2',
    '/fg-out',
    '/fg-inventory',
    '/pallet-id',
    '/utilization',
    '/checklist',
    '/equipment',
    '/manage',
    '/sxxk',
    '/settings',
    '/zalo'
  ];
  
  menuTabs: MenuTab[] = [
    // Dashboard - First
    { path: '/dashboard', title: 'Dashboard', icon: 'speed', iconImage: 'assets/img/dasboard.png', category: 'Main' },
    { path: '/assistant', title: 'Assistant', icon: 'smart_toy', iconImage: 'assets/img/dasboard.png', category: 'Main' },
    
    // Main - Additional tools
    { path: '/materials-dashboard', title: 'Materials Dashboard', icon: 'grid_view', iconImage: 'assets/img/dasboard.png', category: 'Main' },
    { path: '/work-order-status', title: 'Work Order', icon: 'description', iconImage: 'assets/img/workorder.png', category: 'Main' },
    { path: '/shipment', title: 'Shipment', icon: 'local_shipping', iconImage: 'assets/img/shipment.png', category: 'Main' },
    { path: '/find-rm1', title: 'Find RM1', icon: 'search', iconImage: 'assets/img/find.png', category: 'Main' },
    { path: '/pxk-preview', title: 'PXK Preview', icon: 'preview', iconImage: 'assets/img/preview.png', category: 'Main' },
    { path: '/location', title: 'Location', icon: 'place', iconImage: 'assets/img/location.png', category: 'Main' },
    { path: '/rm1-delivery', title: 'RM Delivery', icon: 'local_shipping', iconImage: 'assets/img/delivery.png', category: 'Main' },
    { path: '/shorted-materials', title: 'Shorted materials', icon: 'difference', iconImage: 'assets/img/dasboard.png', category: 'Main' },

    // Production
    { path: '/pd-control', title: 'PD Control', icon: 'precision_manufacturing', iconImage: 'assets/img/analytics.png', category: 'Production' },
    
    // ASM1 RM
    { path: '/inbound-asm1', title: 'RM1 Inbound', icon: 'download', iconImage: 'assets/img/rmin.png', category: 'ASM1 RM' },
    { path: '/outbound-asm1', title: 'RM1 Outbound', icon: 'upload', iconImage: 'assets/img/rmout.png', category: 'ASM1 RM' },
    { path: '/materials-asm1', title: 'RM1 Inventory', icon: 'warehouse', iconImage: 'assets/img/rminventory.png', category: 'ASM1 RM' },
    { path: '/inventory-overview-asm1', title: 'RM1 Overview', icon: 'bar_chart', iconImage: 'assets/img/stocktaking.png', category: 'ASM1 RM' },
    { path: '/bag-history', title: 'Control Batch', icon: 'history', iconImage: 'assets/img/traceback.png', category: 'ASM1 RM' },
    { path: '/label', title: 'Label', icon: 'local_offer', iconImage: 'assets/img/label.png', category: 'ASM1 RM' },

    // Quality
    { path: '/qc', title: 'Quality', icon: 'verified', iconImage: 'assets/img/qc.png', category: 'Quality' },
    { path: '/qc-traceability', title: 'Traceability', icon: 'timeline', iconImage: 'assets/img/traceback.png', category: 'Quality' },
    // ASM2 RM
    { path: '/inbound-asm2', title: 'RM2 Inbound', icon: 'download', iconImage: 'assets/img/rmin.png', category: 'ASM2 RM' },
    { path: '/outbound-asm2', title: 'RM2 Outbound', icon: 'upload', iconImage: 'assets/img/rmout.png', category: 'ASM2 RM' },
    { path: '/materials-asm2', title: 'RM2 Inventory', icon: 'warehouse', iconImage: 'assets/img/rminventory.png', category: 'ASM2 RM' },
    { path: '/inventory-overview-asm2', title: 'RM2 Overview', icon: 'bar_chart', iconImage: 'assets/img/stocktaking.png', category: 'ASM2 RM' },
    
    // ASM FG
    { path: '/fg-in', title: 'FG In', icon: 'input', iconImage: 'assets/img/fgin.png', category: 'ASM FG' },
    { path: '/fg-out', title: 'FG Out', icon: 'output', iconImage: 'assets/img/fgout.png', category: 'ASM FG' },
    { path: '/fg-check', title: 'FG Check', icon: 'fact_check', iconImage: 'assets/img/shipcheck.png', category: 'ASM FG' },
    { path: '/fg-inventory', title: 'FG Inventory', icon: 'inventory_2', iconImage: 'assets/img/fginventory.png', category: 'ASM FG' },
    { path: '/fg-overview', title: 'FG Overview', icon: 'table_chart', iconImage: 'assets/img/stocktaking.png', category: 'ASM FG' },
    { path: '/fg-location', title: 'FG Location', icon: 'edit_location', iconImage: 'assets/img/fglocation.png', category: 'ASM FG' },
    { path: '/pallet-id', title: 'Pallet ID', icon: 'view_in_ar', iconImage: 'assets/img/palletid.png', category: 'ASM FG' },
    
    // Tools & Operations
    { path: '/warehouse-loading', title: 'Loading', icon: 'storage', iconImage: 'assets/img/loading.png', category: 'Tools' },
    { path: '/trace-back', title: 'Trace Back', icon: 'timeline', iconImage: 'assets/img/traceback.png', category: 'Tools' },
    { path: '/stock-check', title: 'Stock Check', icon: 'checklist', iconImage: 'assets/img/shipcheck.png', category: 'Tools' },
    { path: '/wh-security', title: 'WH Security', icon: 'security', iconImage: 'assets/img/security.png', category: 'Tools' },
    { path: '/safety', title: 'Safety Stock', icon: 'shield', iconImage: 'assets/img/safetystock.png', category: 'Tools' },
    
    // Admin & Reports
    { path: '/utilization', title: 'Utilization', icon: 'trending_up', iconImage: 'assets/img/utilization.png', category: 'Admin' },
    { path: '/sxxk', title: 'SXXK', icon: 'inventory_2', iconImage: 'assets/img/sxxk.png', category: 'Admin' },
    { path: '/scrap', title: 'Scrap', icon: 'delete_sweep', iconImage: 'assets/img/scrap.png', category: 'Admin' },
    { path: '/checklist', title: 'Safety & Quality', icon: 'check_circle', iconImage: 'assets/img/safety.png', category: 'Admin' },
    { path: '/equipment', title: 'Training', icon: 'school', iconImage: 'assets/img/training.png', category: 'Admin' },
    { path: '/manage', title: 'Manage', icon: 'tune', iconImage: 'assets/img/manage.png', category: 'Admin' },
    { path: '/settings', title: 'Settings', icon: 'settings', iconImage: 'assets/img/setting.png', category: 'Admin' },
    { path: '/zalo', title: 'Zalo', icon: 'chat', iconImage: 'assets/img/setting.png', category: 'Admin' }
  ];

  private readonly iconAccentByPath: Record<string, { bg: string; border: string; fg: string }> = {
    '/dashboard': { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.18)', fg: '#2563eb' },
    '/assistant': { bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.18)', fg: '#16a34a' },
    '/work-order-status': { bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.18)', fg: '#ea580c' },
    '/shipment': { bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.18)', fg: '#7c3aed' },
    '/find-rm1': { bg: 'rgba(14,165,233,0.10)', border: 'rgba(14,165,233,0.18)', fg: '#0284c7' },
    '/pxk-preview': { bg: 'rgba(34,211,238,0.10)', border: 'rgba(34,211,238,0.18)', fg: '#0891b2' },
    '/location': { bg: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.18)', fg: '#e11d48' },
    '/rm1-delivery': { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.18)', fg: '#2563eb' }
  };

  private readonly lineIconHtmlByPath: Record<string, SafeHtml> = {};
  private readonly tabViews: MenuTabView[] = [];

  constructor(
    private router: Router,
    private authService: FirebaseAuthService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.detectMobileDevice();
    this.buildTabViews();
    this.updateFiltered();
  }
  
  @HostListener('window:resize', ['$event'])
  onResize(event: any): void {
    this.detectMobileDevice();
    this.updateFiltered();
  }
  
  private detectMobileDevice(): void {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isMobileUserAgent = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isMobileScreen = window.innerWidth <= 768;
    const isPDA = /pda|handheld|mobile|android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isSmallScreen = window.innerWidth <= 1024;
    
    this.isMobile = isMobileUserAgent || isMobileScreen || isPDA || isSmallScreen;
  }
  
  isDesktopOnly(path: string): boolean {
    return this.desktopOnlyTabs.includes(path);
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
      '/assistant': svg('<path d="M12 8v4"/><path d="M9 12h6"/><rect x="7" y="4.5" width="10" height="12" rx="3"/><path d="M9 19l3-2 3 2"/>'),
      '/work-order-status': svg('<path d="M9 6h10"/><path d="M9 10h10"/><path d="M9 14h6"/><path d="M5 6h.01"/><path d="M5 10h.01"/><path d="M5 14h.01"/><path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>'),
      '/shipment': svg('<path d="M3 7h12v10H3z"/><path d="M15 10h4l2 2v5h-6z"/><circle cx="7" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>'),
      '/find-rm1': svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/>'),
      '/pxk-preview': svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
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
      'ASM1 RM': [],
      Quality: [],
      'ASM2 RM': [],
      'ASM FG': [],
      Tools: [],
      Admin: []
    };
    for (const t of filtered) {
      (next[t.category] ||= []).push(t);
    }
    this.filteredByCategory = next;
    this.cdr.markForCheck();
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

type MenuTab = { path: string; title: string; icon: string; iconImage?: string; category: string };
type MenuTabView = MenuTab & {
  accent: { bg: string; border: string; fg: string };
  lineIcon: SafeHtml;
};
