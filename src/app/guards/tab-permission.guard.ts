import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { TabPermissionService } from '../services/tab-permission.service';

@Injectable({
  providedIn: 'root'
})
export class TabPermissionGuard implements CanActivate {
  
  constructor(
    private tabPermissionService: TabPermissionService,
    private router: Router
  ) { }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    // Lấy tab key từ route
    const tabKey = this.getTabKeyFromRoute(state.url);
    
    if (!tabKey) {
      // Nếu không xác định được tab key, cho phép truy cập
      return of(true);
    }

    // Kiểm tra quyền truy cập tab
    return this.tabPermissionService.canAccessTab(tabKey).pipe(
      map(hasAccess => {
        if (hasAccess) {
          return true;
        } else {
          // Nếu không có quyền, chuyển về dashboard
          console.log(`❌ Access denied to tab: ${tabKey}`);
          this.router.navigate(['/dashboard']);
          return false;
        }
      }),
      catchError(error => {
        console.error('❌ Error checking tab permission:', error);
        // Nếu có lỗi, cho phép truy cập
        return of(true);
      })
    );
  }

  private getTabKeyFromRoute(url: string): string | null {
    // Map URL paths to tab keys
    const tabKeyMap: { [key: string]: string } = {
      '/dashboard': 'dashboard',
      '/work-order-status': 'work-order',
      '/shipment': 'shipment',
      '/inbound-materials': 'materials',
      '/outbound-materials': 'materials',
      '/materials-inventory': 'materials',
      '/fg': 'fg',
      '/label': 'label',
      '/bm': 'bm',
      '/utilization': 'utilization',
      '/find': 'find',
      '/layout': 'layout',
      '/checklist': 'checklist',
      '/equipment': 'equipment',
      '/task': 'task'
    };

    return tabKeyMap[url] || null;
  }
} 