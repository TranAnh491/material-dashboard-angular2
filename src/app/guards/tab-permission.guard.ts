import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap, take } from 'rxjs/operators';
import { TabPermissionService } from '../services/tab-permission.service';
import { RolePermissionService } from '../services/role-permission.service';
import { MobileDetectionService } from '../services/mobile-detection.service';
import { getTabKeyForUrl, isAdminOnlyTabKey } from '../routes/app-tabs';

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
    const tabKey = getTabKeyForUrl(state.url);
    
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
    if (isAdminOnlyTabKey(tabKey)) {
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

} 