import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, map, take } from 'rxjs';
import { FirebaseAuthService } from '../services/firebase-auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  
  constructor(
    private authService: FirebaseAuthService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean> {
    return this.authService.isAuthenticated.pipe(
      take(1),
      map(isAuth => {
        if (isAuth) {
          return true;
        } else {
          // Chưa đăng nhập, chuyển về trang login
          this.router.navigate(['/login']);
          return false;
        }
      })
    );
  }
} 