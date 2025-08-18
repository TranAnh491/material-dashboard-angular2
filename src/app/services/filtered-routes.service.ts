import { Injectable } from '@angular/core';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { ROUTES, RouteInfo } from '../routes/sidebar-routes';
import { TabPermissionService } from './tab-permission.service';
import { RolePermissionService } from './role-permission.service';

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

  // Lọc routes dựa trên permissions và vai trò
  private filterRoutesByPermissions(routes: RouteInfo[], permissions: { [key: string]: boolean }, userRole: string | null): RouteInfo[] {
    return routes.filter(route => {
      // Kiểm tra quyền truy cập cho route chính
      const hasAccess = this.hasAccessToRoute(route, permissions, userRole);
      
      if (hasAccess && route.children) {
        // Nếu có quyền truy cập và có children, lọc children
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
      
      return hasAccess;
    });
  }

  // Kiểm tra quyền truy cập cho một route
  private hasAccessToRoute(route: RouteInfo, permissions: { [key: string]: boolean }, userRole: string | null): boolean {
    const tabKey = this.getTabKeyFromRoute(route.path);
    
    if (!tabKey) {
      // Nếu không xác định được tab key, cho phép truy cập
      return true;
    }

    // Đặc biệt cho Settings - chỉ Admin và Quản lý mới có quyền
    if (tabKey === 'settings') {
      return userRole === 'Admin' || userRole === 'Quản lý';
    }

    // Kiểm tra permission - cho phép nếu có permission rõ ràng là true
    // hoặc nếu không có permission được cấu hình (mặc định cho phép)
    return permissions[tabKey] === true || permissions[tabKey] === undefined;
  }

  // Map route path sang tab key
  private getTabKeyFromRoute(path: string): string | null {
    const tabKeyMap: { [key: string]: string } = {
      '/dashboard': 'dashboard',
      '/work-order-status': 'work-order-status',
      '/shipment': 'shipment',
      
      // ASM1 routes
      '/inbound-asm1': 'inbound-asm1',
      '/outbound-asm1': 'outbound-asm1',
      '/materials-asm1': 'materials-asm1',
      
      // ASM2 routes
      '/inbound-asm2': 'inbound-asm2',
      '/outbound-asm2': 'outbound-asm2',
      '/materials-asm2': 'materials-asm2',
      
      // Legacy routes
      '#materials': 'materials',
      '/inbound-materials': 'materials',
      '/outbound-materials': 'materials',

      // Other routes
      '/fg': 'fg',
      '/label': 'label',
      '/bm': 'bm',
      '/index': 'index',
      '/utilization': 'utilization',
      '/find': 'find',
      '/layout': 'layout',
      '/checklist': 'checklist',
      '/equipment': 'equipment',
      '/task': 'task',
      '/settings': 'settings'
    };

    return tabKeyMap[path] || null;
  }
} 