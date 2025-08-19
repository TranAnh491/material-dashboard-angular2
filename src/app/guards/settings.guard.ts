import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { RolePermissionService } from '../services/role-permission.service';

@Injectable({
  providedIn: 'root'
})
export class SettingsGuard implements CanActivate {

  constructor(
    private rolePermissionService: RolePermissionService,
    private router: Router
  ) { }

  canActivate(): Observable<boolean> {
    console.log('🔒 SettingsGuard: Kiểm tra quyền truy cập Settings...');
    
    return this.rolePermissionService.canAccessSettings().pipe(
      tap(hasAccess => {
        console.log('🔍 SettingsGuard: Kết quả kiểm tra quyền:', hasAccess);
      }),
      map(hasAccess => {
        if (hasAccess) {
          console.log('✅ SettingsGuard: Cho phép truy cập Settings');
          return true;
        } else {
          console.log('❌ SettingsGuard: Không có quyền, chuyển về dashboard');
          // Nếu không có quyền, chuyển về dashboard
          this.router.navigate(['/dashboard']);
          return false;
        }
      }),
      catchError((error) => {
        console.error('💥 SettingsGuard: Lỗi khi kiểm tra quyền:', error);
        // Nếu có lỗi, chuyển về dashboard
        this.router.navigate(['/dashboard']);
        return of(false);
      })
    );
  }
} 