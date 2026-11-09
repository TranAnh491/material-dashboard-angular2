import { Injectable } from '@angular/core';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { ROUTES, RouteInfo } from '../routes/sidebar-routes';
import { TabPermissionService } from './tab-permission.service';
import { RolePermissionService } from './role-permission.service';
import { getAppTab, isAdminOnlyTabKey } from '../routes/app-tabs';

@Injectable({
  providedIn: 'root'
})
export class FilteredRoutesService {
  
  constructor(
    private tabPermissionService: TabPermissionService,
    private rolePermissionService: RolePermissionService
  ) { }

  // Lấy routes đã được lọc theo quyền truy cập
  getFilteredRoutes(): Observable<RouteInfo[]> {
    return combineLatest([
      this.tabPermissionService.getCurrentUserTabPermissions(),
      this.rolePermissionService.getCurrentUserRole()
    ]).pipe(
      map(([permissions, userRole]) => {
        return this.filterRoutesByPermissions(ROUTES, permissions, userRole);
      })
    );
  }

  /** Hàm kiểm tra 1 đường dẫn tab có được mở không (cùng quy tắc với sidebar) — cho trang Menu ẩn thẻ không có quyền. */
  getPathAccessChecker(): Observable<(path: string) => boolean> {
    return combineLatest([
      this.tabPermissionService.getCurrentUserTabPermissions(),
      this.rolePermissionService.getCurrentUserRole()
    ]).pipe(
      map(([permissions, userRole]) => (path: string) =>
        this.hasAccessToRoute({ path } as RouteInfo, permissions || {}, userRole))
    );
  }

  // Lọc routes dựa trên permissions và vai trò
  private filterRoutesByPermissions(routes: RouteInfo[], permissions: { [key: string]: boolean }, userRole: string | null): RouteInfo[] {
    return routes.filter(route => {
      // Nếu route có children và path rỗng (parent route như ASM1 RM, ASM2 RM)
      // Không check permission cho parent, chỉ check children
      if (route.children && route.children.length > 0 && (!route.path || route.path === '')) {
        const filteredChildren = this.filterRoutesByPermissions(route.children, permissions, userRole);
        if (filteredChildren.length > 0) {
          // Tạo route mới với children đã được lọc
          return {
            ...route,
            children: filteredChildren
          };
        } else {
          // Nếu không có children nào có quyền, ẩn route này
          return false;
        }
      }
      
      // Nếu route có children nhưng cũng có path cụ thể, check cả parent và children
      if (route.children && route.children.length > 0) {
        const hasAccess = this.hasAccessToRoute(route, permissions, userRole);
        if (hasAccess) {
          const filteredChildren = this.filterRoutesByPermissions(route.children, permissions, userRole);
          if (filteredChildren.length > 0) {
            return {
              ...route,
              children: filteredChildren
            };
          } else {
            return false;
          }
        } else {
          return false;
        }
      }
      
      // Route không có children, check permission bình thường
      return this.hasAccessToRoute(route, permissions, userRole);
    });
  }

  // Kiểm tra quyền truy cập cho một route
  private hasAccessToRoute(route: RouteInfo, permissions: { [key: string]: boolean }, userRole: string | null): boolean {
    const tab = getAppTab(route.path);

    if (!tab) {
      // Nếu không xác định được tab, KHÔNG cho phép truy cập (để bảo mật)
      return false;
    }

    // Tab không cần quyền (vd Xe Tải): ai đăng nhập cũng truy cập được
    if (tab.key === null) return true;

    // Đặc biệt cho Settings / Zalo - chỉ Admin và Quản lý mới có quyền
    if (isAdminOnlyTabKey(tab.key)) {
      return userRole === 'Admin' || userRole === 'Quản lý';
    }

    // Kiểm tra permission - CHỈ cho phép nếu có permission rõ ràng là true
    // Nếu false hoặc undefined → KHÔNG cho phép (user mới đăng ký phải chờ duyệt)
    return permissions[tab.key] === true;
  }
} 