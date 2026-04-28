import { Component, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseAuthService } from '../../services/firebase-auth.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss']
})
export class MenuComponent implements OnInit {
  
  isMobile: boolean = false;
  searchTerm: string = '';
  
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
  
  menuTabs = [
    // Dashboard - First
    { path: '/dashboard', title: 'Dashboard', icon: 'speed', iconImage: 'assets/img/dasboard.png', category: 'Main' },
    { path: '/assistant', title: 'Assistant', icon: 'smart_toy', iconImage: 'assets/img/dasboard.png', category: 'Main' },
    
    // Main - Additional tools
    { path: '/work-order-status', title: 'Work Order', icon: 'description', iconImage: 'assets/img/workorder.png', category: 'Main' },
    { path: '/shipment', title: 'Shipment', icon: 'local_shipping', iconImage: 'assets/img/shipment.png', category: 'Main' },
    { path: '/find-rm1', title: 'Find RM1', icon: 'search', iconImage: 'assets/img/find.png', category: 'Main' },
    { path: '/pxk-preview', title: 'PXK Preview', icon: 'preview', iconImage: 'assets/img/preview.png', category: 'Main' },
    { path: '/location', title: 'Location', icon: 'place', iconImage: 'assets/img/location.png', category: 'Main' },
    { path: '/rm1-delivery', title: 'RM Delivery', icon: 'local_shipping', iconImage: 'assets/img/delivery.png', category: 'Main' },
    
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

  constructor(
    private router: Router,
    private authService: FirebaseAuthService
  ) { }

  ngOnInit(): void {
    this.detectMobileDevice();
  }
  
  @HostListener('window:resize', ['$event'])
  onResize(event: any): void {
    this.detectMobileDevice();
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

  get filteredTabs(): Array<{ path: string; title: string; icon: string; iconImage?: string; category: string }> {
    const q = this.norm(this.searchTerm);
    const base = this.menuTabs.filter(t => !this.isMobile || !this.isDesktopOnly(t.path));
    if (!q) return base;
    return base.filter(t => this.norm(t.title).includes(q) || this.norm(t.path).includes(q) || this.norm(t.category).includes(q));
  }

  tabsByCategory(category: string): Array<{ path: string; title: string; icon: string; iconImage?: string; category: string }> {
    return this.filteredTabs.filter(t => t.category === category);
  }

  /** UI: icon color accents per module (approx match screenshot). */
  getIconAccent(tab: { path: string }): { bg: string; border: string; fg: string } {
    const p = String(tab?.path || '').trim();
    const map: Record<string, { bg: string; border: string; fg: string }> = {
      '/dashboard': { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.18)', fg: '#2563eb' },
      '/assistant': { bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.18)', fg: '#16a34a' },
      '/work-order-status': { bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.18)', fg: '#ea580c' },
      '/shipment': { bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.18)', fg: '#7c3aed' },
      '/find-rm1': { bg: 'rgba(14,165,233,0.10)', border: 'rgba(14,165,233,0.18)', fg: '#0284c7' },
      '/pxk-preview': { bg: 'rgba(34,211,238,0.10)', border: 'rgba(34,211,238,0.18)', fg: '#0891b2' },
      '/location': { bg: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.18)', fg: '#e11d48' },
      '/rm1-delivery': { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.18)', fg: '#2563eb' }
    };
    return map[p] || { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.12)', fg: '#2563eb' };
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
