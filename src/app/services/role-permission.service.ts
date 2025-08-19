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
    console.log('🔍 RolePermissionService: Kiểm tra quyền Settings...');
    
    return this.authService.currentUser.pipe(
      map(user => {
        console.log('👤 RolePermissionService: User data:', user);
        
        if (!user) {
          console.log('❌ RolePermissionService: Không có user');
          return false;
        }
        
        console.log('🔑 RolePermissionService: User role:', user.role);
        
        // Chỉ cho phép Admin và Quản lý truy cập Settings
        const hasAccess = user.role === 'Admin' || user.role === 'Quản lý';
        console.log('✅ RolePermissionService: Kết quả kiểm tra quyền:', hasAccess);
        
        return hasAccess;
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