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
    const tabKey = this.getTabKeyFromRoute(route.path);
    
    if (!tabKey) {
      // Nếu không xác định được tab key, KHÔNG cho phép truy cập (để bảo mật)
      return false;
    }

    // Đặc biệt cho Settings - chỉ Admin và Quản lý mới có quyền
    if (tabKey === 'settings') {
      return userRole === 'Admin' || userRole === 'Quản lý';
    }

    // Đặc biệt cho Manage - chỉ Admin mới có quyền
    if (tabKey === 'manage') {
      return userRole === 'Admin';
    }

    // Kiểm tra permission - CHỈ cho phép nếu có permission rõ ràng là true
    // Nếu false hoặc undefined → KHÔNG cho phép (user mới đăng ký phải chờ duyệt)
    return permissions[tabKey] === true;
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
      '/inventory-overview-asm1': 'inventory-overview-asm1',
      
      // ASM2 routes
      '/inbound-asm2': 'inbound-asm2',
      '/outbound-asm2': 'outbound-asm2',
      '/materials-asm2': 'materials-asm2',
      '/inventory-overview-asm2': 'inventory-overview-asm2',
      
      // ASM1 FG routes
      '/fg-in': 'fg-in',
      '/fg-out': 'fg-out',
      '/fg-preparing': 'fg-preparing',
      '/fg-inventory': 'fg-inventory',
      
      // Other routes
      '/location': 'location',
      '/warehouse-loading': 'warehouse-loading',
      '/trace-back': 'trace-back',
      '/manage': 'manage',
      '/stock-check': 'stock-check',
      '/label': 'label',
      '/index': 'index',
      '/utilization': 'utilization',
      '/find-rm1': 'find-rm1',
      '/checklist': 'checklist',
      '/safety': 'safety',
      '/equipment': 'equipment',
      '/qc': 'qc',
      '/settings': 'settings',
      
      // Legacy routes (for backward compatibility)
      '#materials': 'materials',
      '/inbound-materials': 'materials',
      '/outbound-materials': 'materials'
    };

    return tabKeyMap[path] || null;
  }
} 