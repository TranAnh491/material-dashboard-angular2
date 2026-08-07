import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap, take } from 'rxjs/operators';
import { TabPermissionService } from '../services/tab-permission.service';
import { RolePermissionService } from '../services/role-permission.service';
import { MobileDetectionService } from '../services/mobile-detection.service';

@Injectable({
  providedIn: 'root'
})
export class TabPermissionGuard implements CanActivate {

  constructor(
    private tabPermissionService: TabPermissionService,
    private rolePermissionService: RolePermissionService,
    private mobileDetection: MobileDetectionService,
    private router: Router
  ) { }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    // Tab chưa có giao diện mobile/tablet — mở trên điện thoại/tablet thì tự chuyển về Menu,
    // chỉ kiểm tra lúc điều hướng vào route (không theo dõi resize liên tục để tránh mất dữ liệu
    // đang nhập nếu người dùng đang ở trong trang rồi xoay màn hình/thu nhỏ cửa sổ).
    const path = state.url.split('?')[0].split('#')[0];
    if (path !== '/menu' && this.mobileDetection.isDesktopOnlyPath(path) && this.mobileDetection.isMobileOrTablet()) {
      console.log(`📱 ${path} chưa có giao diện mobile/tablet — chuyển về Menu`);
      this.router.navigate(['/menu']);
      return of(false);
    }

    // Lấy tab key từ route
    const tabKey = this.getTabKeyFromRoute(state.url);
    
    if (!tabKey) {
      // Nếu không xác định được tab key, KHÔNG cho phép truy cập (để đảm bảo an toàn)
      console.log(`⚠️ Unknown route: ${state.url}, access denied`);
      this.router.navigate(['/dashboard']);
      return of(false);
    }

    // Đặc biệt: menu route có thể truy cập (redirect to dashboard)
    if (tabKey === 'dashboard' && state.url.includes('/menu')) {
      return of(true);
    }

    // Đặc biệt cho Settings - chỉ Admin và Quản lý mới có quyền
    if (tabKey === 'settings' || tabKey === 'zalo') {
      return this.rolePermissionService.canAccessSettings().pipe(
        switchMap(hasRoleAccess => {
          if (!hasRoleAccess) {
            console.log(`❌ Access denied to ${tabKey} - User không có quyền Admin hoặc Quản lý`);
            this.router.navigate(['/dashboard']);
            return of(false);
          }
          // Kiểm tra tab permission sau khi đã có role access
          return this.tabPermissionService.canAccessTab(tabKey).pipe(
            map(hasAccess => {
              if (!hasAccess) {
                console.log(`❌ Access denied to ${tabKey} - User không có tab permission`);
                this.router.navigate(['/dashboard']);
                return false;
              }
              return true;
            })
          );
        }),
        catchError(error => {
          console.error(`❌ Error checking ${tabKey} permission:`, error);
          this.router.navigate(['/dashboard']);
          return of(false);
        })
      );
    }

    // Kiểm tra quyền truy cập tab cho các tab khác
    return this.tabPermissionService.canAccessTab(tabKey).pipe(
      map(hasAccess => {
        if (hasAccess) {
          return true;
        } else {
          // Nếu không có quyền, chuyển về dashboard
          console.log(`❌ Access denied to tab: ${tabKey} - User không có quyền truy cập tab này`);
          this.router.navigate(['/dashboard']);
          return false;
        }
      }),
      catchError(error => {
        console.error('❌ Error checking tab permission:', error);
        // Nếu có lỗi, không cho phép truy cập để đảm bảo an toàn
        this.router.navigate(['/dashboard']);
        return of(false);
      })
    );
  }

  private getTabKeyFromRoute(url: string): string | null {
    // Map URL paths to tab keys - đồng bộ với FilteredRoutesService và availableTabs
    const tabKeyMap: { [key: string]: string } = {
      '/dashboard': 'dashboard',
      '/pd-control': 'pd-control',
      '/materials-dashboard': 'materials-dashboard',
      '/fgs-dashboard': 'fgs-dashboard',
      '/work-order-status': 'work-order-status',
      '/shipment': 'shipment',
      
      // RM Inbound — trang gộp dùng chung cho ASM1 + ASM2 (nút chuyển nhà máy trong trang)
      '/inbound': 'inbound',
      // RM Inventory Overview — trang gộp dùng chung cho ASM1 + ASM2 (nút chuyển nhà máy trong trang)
      '/inventory-overview': 'inventory-overview',

      // RM Outbound — trang gộp dùng chung cho ASM1 + ASM2 (nút chuyển nhà máy trong trang)
      '/outbound': 'outbound',
      // RM Inventory (Materials) — trang gộp dùng chung cho ASM1 + ASM2 (nút chuyển nhà máy trong trang)
      '/materials': 'materials',

      '/danh-muc-nvl-tp': 'danh-muc-nvl-tp',
      '/bag-history': 'bag-history',
      
      // ASM FG routes
      '/fg-in': 'fg-in',
      '/fg-out': 'fg-out',
      '/fg-check': 'fg-check',
      '/fg-inventory': 'fg-inventory',
      '/fg-inventory/tp-list': 'fg-inventory',
      '/fg-overview': 'fg-overview',
      '/fg-location': 'fg-location',
      '/pallet-id': 'pallet-id',
      
      // Other routes
      '/location': 'location',
      '/layout-warehouse': 'layout-warehouse',
      '/layout-warehouse-asm3': 'layout-warehouse-asm3',
      '/stock-check': 'stock-check',
      '/bieu-mau': 'bieu-mau',
      '/label': 'label',
      '/index': 'index',
      '/sxxk': 'sxxk',
      '/scrap': 'scrap',
      '/checklist': 'checklist',
      '/equipment': 'equipment',
      '/qc': 'qc',
      '/qc-traceability': 'qc',
      '/nhiet-do': 'nhiet-do',
      '/rm1-delivery': 'rm1-delivery',
      // Xe Tải không dùng tab permission guard
      // '/xe-tai': 'xe-tai',
      '/report': 'report',
      '/shorted-materials': 'shorted-materials',
      '/settings': 'settings',
      '/zalo': 'zalo',

      // Menu route - cho phép truy cập (không cần permission)
      '/menu': 'dashboard'
    };

    // Lấy path từ URL (bỏ query params và hash)
    const path = url.split('?')[0].split('#')[0];
    return tabKeyMap[path] || null;
  }
} 