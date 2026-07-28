import { Injectable } from '@angular/core';

/**
 * Nguồn dùng chung: phát hiện mobile/tablet + danh sách tab CHƯA có giao diện mobile/tablet.
 * Trước đây logic này chỉ nằm riêng trong MenuComponent (chỉ dùng để ẩn khỏi danh sách Menu) —
 * tách ra đây để TabPermissionGuard cũng dùng được, chặn thẳng ở tầng route (không chỉ ẩn khỏi Menu).
 */
@Injectable({
  providedIn: 'root'
})
export class MobileDetectionService {
  /** Ngưỡng ~1024px: gồm điện thoại (tới cỡ iPhone Pro Max) và tablet (iPad dọc/ngang). */
  private readonly SMALL_SCREEN_MAX_WIDTH = 1024;

  /** Các tab CHƯA có giao diện mobile/tablet thật sự (chỉ có bảng desktop, không đổi layout khi thu nhỏ). */
  readonly desktopOnlyTabPaths: string[] = [
    '/dashboard',
    '/bag-history',
    '/fg-overview',
    '/qc',
    '/qc-traceability',
    // PrintLabelComponent được route là /label (admin-layout.routing.ts)
    '/label',
    '/work-order-status',
    '/shipment',
    '/inventory-overview-asm1',
    '/inventory-overview-asm2',
    '/fg-out',
    '/fg-inventory',
    '/fg-inventory/tp-list',
    '/pallet-id',
    '/checklist',
    '/equipment',
    '/sxxk',
    '/settings',
    '/zalo',
    '/shorted-materials',
    '/layout-warehouse',
    '/layout-warehouse-asm3',
    '/danh-muc-nvl-tp',
    '/nhiet-do',
    '/report',
    '/materials-dashboard',
    '/fgs-dashboard',
    // Bổ sung sau audit — chỉ có bảng desktop, không có layout mobile/tablet thật sự
    '/index',
    '/inbound-fgs',
    '/outbound-fgs',
    '/kpi-reports'
  ];

  isMobileOrTablet(): boolean {
    const userAgent = String(navigator.userAgent || navigator.vendor || (window as { opera?: string }).opera || '').toLowerCase();
    const isMobileUserAgent = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isSmallScreen = window.innerWidth <= this.SMALL_SCREEN_MAX_WIDTH;
    return isMobileUserAgent || isSmallScreen;
  }

  isDesktopOnlyPath(path: string): boolean {
    return this.desktopOnlyTabPaths.includes(path);
  }
}
