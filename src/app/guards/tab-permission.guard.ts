import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { TabPermissionService } from '../services/tab-permission.service';
import { RolePermissionService } from '../services/role-permission.service';

@Injectable({
  providedIn: 'root'
})
export class TabPermissionGuard implements CanActivate {
  
  constructor(
    private tabPermissionService: TabPermissionService,
    private rolePermissionService: RolePermissionService,
    private router: Router
  ) { }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
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
    if (tabKey === 'settings') {
      return this.rolePermissionService.canAccessSettings().pipe(
        switchMap(hasRoleAccess => {
          if (!hasRoleAccess) {
            console.log(`❌ Access denied to Settings - User không có quyền Admin hoặc Quản lý`);
            this.router.navigate(['/dashboard']);
            return of(false);
          }
          // Kiểm tra tab permission sau khi đã có role access
          return this.tabPermissionService.canAccessTab(tabKey).pipe(
            map(hasAccess => {
              if (!hasAccess) {
                console.log(`❌ Access denied to Settings - User không có tab permission`);
                this.router.navigate(['/dashboard']);
                return false;
              }
              return true;
            })
          );
        }),
        catchError(error => {
          console.error('❌ Error checking Settings permission:', error);
          this.router.navigate(['/dashboard']);
          return of(false);
        })
      );
    }

    // Đặc biệt cho Manage - chỉ Admin mới có quyền
    if (tabKey === 'manage') {
      return this.rolePermissionService.isAdmin().pipe(
        switchMap(isAdmin => {
          if (!isAdmin) {
            console.log(`❌ Access denied to Manage - User không có quyền Admin`);
            this.router.navigate(['/dashboard']);
            return of(false);
          }
          // Kiểm tra tab permission sau khi đã có role access
          return this.tabPermissionService.canAccessTab(tabKey).pipe(
            map(hasAccess => {
              if (!hasAccess) {
                console.log(`❌ Access denied to Manage - User không có tab permission`);
                this.router.navigate(['/dashboard']);
                return false;
              }
              return true;
            })
          );
        }),
        catchError(error => {
          console.error('❌ Error checking Manage permission:', error);
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
      '/fg-check': 'fg-check',
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
      '/wh-security': 'wh-security',
      '/rm1-delivery': 'rm1-delivery',
      '/settings': 'settings',
      
      // Menu route - cho phép truy cập (không cần permission)
      '/menu': 'dashboard'
    };

    // Lấy path từ URL (bỏ query params và hash)
    const path = url.split('?')[0].split('#')[0];
    return tabKeyMap[path] || null;
  }
} 