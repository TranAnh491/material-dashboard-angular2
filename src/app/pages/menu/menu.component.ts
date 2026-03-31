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
  
  // Danh sách các tab không hỗ trợ mobile (chỉ chạy trên desktop)
  // FG Check, FG Location, FG In được cho phép hiển thị trên mobile
  desktopOnlyTabs: string[] = [
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
    '/settings'
  ];
  
  menuTabs = [
    // Dashboard - First
    { path: '/dashboard', title: 'Dashboard', icon: 'speed', iconImage: 'assets/img/dasboard.png', category: 'Main' },
    
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
    { path: '/bag-history', title: 'RM1 History', icon: 'history', iconImage: 'assets/img/traceback.png', category: 'ASM1 RM' },
    { path: '/label', title: 'Label', icon: 'local_offer', iconImage: 'assets/img/label.png', category: 'ASM1 RM' },

    // Quality
    { path: '/qc', title: 'Quality', icon: 'verified', iconImage: 'assets/img/qc.png', category: 'Quality' },
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
    { path: '/scrap', title: 'SCRAP', icon: 'delete_sweep', iconImage: 'assets/img/scrap.png', category: 'Admin' },
    { path: '/checklist', title: 'Safety & Quality', icon: 'check_circle', iconImage: 'assets/img/safety.png', category: 'Admin' },
    { path: '/equipment', title: 'Training', icon: 'school', iconImage: 'assets/img/training.png', category: 'Admin' },
    { path: '/manage', title: 'Manage', icon: 'tune', iconImage: 'assets/img/manage.png', category: 'Admin' },
    { path: '/settings', title: 'Settings', icon: 'settings', iconImage: 'assets/img/setting.png', category: 'Admin' }
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
