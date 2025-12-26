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
  // QC và Label đã được cho phép hiển thị trên mobile/tablet
  desktopOnlyTabs: string[] = [
    '/work-order-status',
    '/shipment',
    '/inventory-overview-asm1',
    '/inventory-overview-asm2',
    '/fg-in',
    '/fg-out',
    '/fg-preparing',
    '/fg-inventory',
    '/index',
    '/utilization',
    '/checklist',
    '/equipment',
    '/manage',
    '/settings'
  ];
  
  menuTabs = [
    // Dashboard - First
    { path: '/dashboard', title: 'Dashboard', icon: 'speed', category: 'Main' },
    
    // Main - Additional tools
    { path: '/work-order-status', title: 'Work Order', icon: 'description', category: 'Main' },
    { path: '/shipment', title: 'Shipment', icon: 'local_shipping', category: 'Main' },
    { path: '/find-rm1', title: 'Find RM1', icon: 'search', category: 'Main' },
    { path: '/location', title: 'Location', icon: 'place', category: 'Main' },
    
    // ASM1 RM
    { path: '/inbound-asm1', title: 'RM1 Inbound', icon: 'download', category: 'ASM1 RM' },
    { path: '/outbound-asm1', title: 'RM1 Outbound', icon: 'upload', category: 'ASM1 RM' },
    { path: '/materials-asm1', title: 'RM1 Inventory', icon: 'warehouse', category: 'ASM1 RM' },
    { path: '/inventory-overview-asm1', title: 'RM1 Overview', icon: 'bar_chart', category: 'ASM1 RM' },
    { path: '/qc', title: 'Quality', icon: 'verified', category: 'ASM1 RM' },
    { path: '/label', title: 'Label', icon: 'local_offer', category: 'ASM1 RM' },
    { path: '/rm1-delivery', title: 'RM1 Delivery', icon: 'local_shipping', category: 'ASM1 RM' },
    
    // ASM2 RM
    { path: '/inbound-asm2', title: 'RM2 Inbound', icon: 'download', category: 'ASM2 RM' },
    { path: '/outbound-asm2', title: 'RM2 Outbound', icon: 'upload', category: 'ASM2 RM' },
    { path: '/materials-asm2', title: 'RM2 Inventory', icon: 'warehouse', category: 'ASM2 RM' },
    { path: '/inventory-overview-asm2', title: 'RM2 Overview', icon: 'bar_chart', category: 'ASM2 RM' },
    
    // ASM1 FG
    { path: '/fg-in', title: 'FG In', icon: 'input', category: 'ASM1 FG' },
    { path: '/fg-out', title: 'FG Out', icon: 'output', category: 'ASM1 FG' },
    { path: '/fg-preparing', title: 'FG Check', icon: 'fact_check', category: 'ASM1 FG' },
    { path: '/fg-inventory', title: 'FG Inventory', icon: 'inventory_2', category: 'ASM1 FG' },
    
    // Tools & Operations
    { path: '/warehouse-loading', title: 'Loading', icon: 'storage', category: 'Tools' },
    { path: '/trace-back', title: 'Trace Back', icon: 'timeline', category: 'Tools' },
    { path: '/stock-check', title: 'Stock Check', icon: 'checklist', category: 'Tools' },
    { path: '/wh-security', title: 'WH Security', icon: 'security', category: 'Tools' },
    { path: '/safety', title: 'Safety Stock', icon: 'shield', category: 'Tools' },
    
    // Admin & Reports
    { path: '/index', title: 'Bonded Report', icon: 'summarize', category: 'Admin' },
    { path: '/utilization', title: 'Utilization', icon: 'trending_up', category: 'Admin' },
    { path: '/checklist', title: 'Safety & Quality', icon: 'check_circle', category: 'Admin' },
    { path: '/equipment', title: 'Training', icon: 'school', category: 'Admin' },
    { path: '/manage', title: 'Manage', icon: 'tune', category: 'Admin' },
    { path: '/settings', title: 'Settings', icon: 'settings', category: 'Admin' }
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
