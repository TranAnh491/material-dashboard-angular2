import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of, from } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { FirebaseAuthService } from '../services/firebase-auth.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  
  constructor(
    private authService: FirebaseAuthService,
    private router: Router,
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth
  ) {}

  canActivate(): Observable<boolean> {
    return this.afAuth.authState.pipe(
      take(1),
      switchMap(user => {
        if (!user) {
          // Chưa đăng nhập, chuyển về trang login
          this.router.navigate(['/login']);
          return of(false);
        }

        // Kiểm tra user có tồn tại trong collection 'users' (chỉ users trong settings mới được phép)
        return this.firestore.collection('users').doc(user.uid).get().pipe(
          switchMap(userDoc => {
            if (userDoc.exists) {
              // User có trong settings, cho phép truy cập
              return of(true);
            } else {
              // User không có trong settings, đăng xuất và từ chối truy cập
              console.log(`❌ User ${user.email} không có trong settings, tự động đăng xuất...`);
              // Đăng xuất user khỏi Firebase Auth - chuyển Promise thành Observable
              return from(this.afAuth.signOut()).pipe(
                map(() => {
                  console.log(`✅ Đã đăng xuất user ${user.email} do không có trong settings`);
                  this.router.navigate(['/login']);
                  return false;
                }),
                catchError(error => {
                  console.error('❌ Lỗi khi đăng xuất:', error);
                  this.router.navigate(['/login']);
                  return of(false);
                })
              );
            }
          }),
          catchError(error => {
            console.error('❌ Error checking user in settings:', error);
            // Nếu có lỗi, đăng xuất và không cho phép truy cập để đảm bảo an toàn
            return from(this.afAuth.signOut()).pipe(
              map(() => {
                this.router.navigate(['/login']);
                return false;
              }),
              catchError(() => {
                this.router.navigate(['/login']);
                return of(false);
              })
            );
          })
        );
      }),
      catchError(error => {
        console.error('❌ Error in AuthGuard:', error);
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }
} 