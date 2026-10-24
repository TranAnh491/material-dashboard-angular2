import { Injectable } from '@angular/core';
import { DESKTOP_ONLY_TAB_PATHS } from '../routes/app-tabs';

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

  /** Các tab CHƯA có giao diện mobile/tablet thật sự — khai báo bằng cờ `desktopOnly` trong routes/app-tabs.ts. */
  readonly desktopOnlyTabPaths: string[] = DESKTOP_ONLY_TAB_PATHS;

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
