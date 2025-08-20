import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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
    return this.rolePermissionService.canAccessSettings().pipe(
      map(hasAccess => {
        if (hasAccess) {
          return true;
        } else {
          // Nếu không có quyền, chuyển về dashboard
          this.router.navigate(['/dashboard']);
          return false;
        }
      }),
      catchError(() => {
        // Nếu có lỗi, chuyển về dashboard
        this.router.navigate(['/dashboard']);
        return of(false);
      })
    );
  }
} 