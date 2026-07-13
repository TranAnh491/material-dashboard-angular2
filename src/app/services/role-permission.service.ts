import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { FirebaseAuthService, User } from './firebase-auth.service';

@Injectable({
  providedIn: 'root'
})
export class RolePermissionService {

  constructor(private authService: FirebaseAuthService) { }

  // Kiểm tra xem user có quyền truy cập Settings không
  canAccessSettings(): Observable<boolean> {
    return this.authService.currentUser.pipe(
      map(user => {
        if (!user) return false;

        // Chỉ cho phép Admin và Quản lý truy cập Settings
        return user.role === 'Admin' || user.role === 'Quản lý';
      })
    );
  }

  /**
   * Trang quản trị (Settings — Quản lý người dùng): chỉ tài khoản ASP0106.
   * Tách riêng khỏi canAccessSettings() vì canAccessSettings() còn được TabPermissionGuard
   * dùng chung cho tab "zalo" (Admin/Quản lý) — không thu hẹp theo ASP0106.
   */
  canAccessUserManagement(): Observable<boolean> {
    return this.authService.currentUser.pipe(
      map(user => {
        if (!user) return false;
        const employeeId = (user.employeeId || '').trim().toUpperCase();
        return employeeId === 'ASP0106';
      })
    );
  }

  // Kiểm tra xem user có vai trò Admin không
  isAdmin(): Observable<boolean> {
    return this.authService.currentUser.pipe(
      map(user => {
        if (!user) return false;
        return user.role === 'Admin';
      })
    );
  }

  // Kiểm tra xem user có vai trò Quản lý không
  isManager(): Observable<boolean> {
    return this.authService.currentUser.pipe(
      map(user => {
        if (!user) return false;
        return user.role === 'Quản lý';
      })
    );
  }

  // Kiểm tra xem user có vai trò Admin hoặc Quản lý không
  isAdminOrManager(): Observable<boolean> {
    return this.authService.currentUser.pipe(
      map(user => {
        if (!user) return false;
        return user.role === 'Admin' || user.role === 'Quản lý';
      })
    );
  }

  // Lấy vai trò hiện tại của user
  getCurrentUserRole(): Observable<string | null> {
    return this.authService.currentUser.pipe(
      map(user => user?.role || null)
    );
  }
} 