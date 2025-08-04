import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  department?: string;
  createdAt?: Date;
  lastLoginAt?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseAuthService {
  user$: Observable<User | null>;

  constructor(
    private afAuth: AngularFireAuth,
    private firestore: AngularFirestore
  ) {
    // Lắng nghe trạng thái đăng nhập
    this.user$ = this.afAuth.authState.pipe(
      switchMap(user => {
        if (user) {
          // User đã đăng nhập
          return this.firestore.doc<User>(`users/${user.uid}`).valueChanges();
        } else {
          // User chưa đăng nhập
          return of(null);
        }
      })
    );
  }

  // Đăng ký user mới
  async signUp(email: string, password: string, displayName?: string): Promise<any> {
    try {
      const credential = await this.afAuth.createUserWithEmailAndPassword(email, password);
      
      // Tạo user profile trong Firestore
      await this.createUserProfile(credential.user, displayName);
      
      console.log('✅ Đăng ký thành công:', credential.user.uid);
      return credential;
    } catch (error) {
      console.error('❌ Đăng ký thất bại:', error);
      throw error;
    }
  }

  // Đăng nhập
  async signIn(email: string, password: string): Promise<any> {
    try {
      const credential = await this.afAuth.signInWithEmailAndPassword(email, password);
      
      // Cập nhật thông tin user trong Firestore
      await this.updateUserLoginInfo(credential.user);
      
      // Lưu login history
      await this.saveLoginHistory(credential.user);
      
      console.log('✅ Đăng nhập thành công:', credential.user.uid);
      return credential;
    } catch (error) {
      console.error('❌ Đăng nhập thất bại:', error);
      throw error;
    }
  }

  // Đăng xuất
  async signOut(): Promise<void> {
    try {
      await this.afAuth.signOut();
      console.log('✅ Đăng xuất thành công');
    } catch (error) {
      console.error('❌ Đăng xuất thất bại:', error);
      throw error;
    }
  }

  // Tạo user profile trong Firestore
  private async createUserProfile(user: any, displayName?: string): Promise<void> {
    const userRef = this.firestore.doc(`users/${user.uid}`);
    
    const userData: User = {
      uid: user.uid,
      email: user.email,
      displayName: displayName || user.displayName,
      photoURL: user.photoURL,
      createdAt: new Date(),
      lastLoginAt: new Date()
    };

    await userRef.set(userData);
  }

  // Cập nhật thông tin đăng nhập của user
  private async updateUserLoginInfo(user: any): Promise<void> {
    const userRef = this.firestore.doc(`users/${user.uid}`);
    
    // Kiểm tra xem user đã tồn tại trong Firestore chưa
    const doc = await userRef.get().toPromise();
    
    if (doc?.exists) {
      // User đã tồn tại, chỉ cập nhật lastLoginAt
      await userRef.update({
        lastLoginAt: new Date()
      });
    } else {
      // User chưa tồn tại, tạo mới
      const userData: User = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: new Date(),
        lastLoginAt: new Date()
      };
      await userRef.set(userData);
    }
  }

  // Kiểm tra trạng thái đăng nhập
  get isAuthenticated(): Observable<boolean> {
    return this.user$.pipe(
      map(user => !!user)
    );
  }

  // Lấy thông tin user hiện tại
  get currentUser(): Observable<User | null> {
    return this.user$;
  }

  // Lấy UID của user hiện tại
  get currentUserId(): Observable<string | null> {
    return this.user$.pipe(
      map(user => user?.uid || null)
    );
  }

  // Lưu login history
  private async saveLoginHistory(user: any): Promise<void> {
    try {
      const loginHistoryRef = this.firestore.collection('login-history');
      
      await loginHistoryRef.add({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        loginTime: new Date(),
        createdAt: new Date()
      });
      
      console.log('✅ Login history saved');
    } catch (error) {
      console.error('❌ Error saving login history:', error);
    }
  }
} 