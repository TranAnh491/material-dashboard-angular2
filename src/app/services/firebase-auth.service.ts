import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { NotificationService } from './notification.service';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  employeeId?: string; // Mã nhân viên ASP
  department?: string;
  factory?: string;
  role?: string;
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
    private firestore: AngularFirestore,
    private notificationService: NotificationService
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
  async signUp(email: string, password: string, displayName?: string, department?: string, factory?: string, role?: string): Promise<any> {
    try {
      const credential = await this.afAuth.createUserWithEmailAndPassword(email, password);
      
      // Tạo user profile trong Firestore
      await this.createUserProfile(credential.user, displayName, department, factory, role);
      
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

  // Xóa tài khoản hoàn toàn (cần quyền admin)
  async deleteUser(userId: string): Promise<void> {
    try {
      console.log(`🗑️ Starting complete deletion of user: ${userId}`);
      
      // 1. Xóa từ Firestore collections
      const batch = this.firestore.firestore.batch();
      
      // Xóa từ users collection
      const userRef = this.firestore.collection('users').doc(userId).ref;
      batch.delete(userRef);
      
      // Xóa từ user-permissions collection
      const permissionsRef = this.firestore.collection('user-permissions').doc(userId).ref;
      batch.delete(permissionsRef);
      
      // Xóa từ user-tab-permissions collection
      const tabPermissionsRef = this.firestore.collection('user-tab-permissions').doc(userId).ref;
      batch.delete(tabPermissionsRef);
      
      // Commit Firestore deletions
      await batch.commit();
      console.log(`✅ Firestore data deleted for user: ${userId}`);
      
      // 2. Xóa từ Firebase Auth (cần admin SDK hoặc user tự xóa)
      // Note: Để xóa user khỏi Firebase Auth, cần sử dụng Admin SDK
      // Hoặc user phải tự xóa tài khoản của mình
      console.log(`⚠️ Note: To completely delete from Firebase Auth, use Admin SDK or user must delete their own account`);
      
      console.log(`✅ User deletion completed: ${userId}`);
    } catch (error) {
      console.error('❌ Error deleting user:', error);
      throw error;
    }
  }

  // Đăng nhập tài khoản đặc biệt
  async signInSpecialUser(displayName: string, email: string, uid?: string): Promise<void> {
    try {
      console.log('🔐 Đăng nhập tài khoản đặc biệt:', displayName);
      
      // Xác định UID dựa trên displayName
      let specialUID = uid || 'special-steve-uid';
      if (displayName === 'ASP0001') {
        specialUID = 'special-asp0001-uid';
      }
      
      // Tạo user data cho tài khoản đặc biệt
      const specialUserData: User = {
        uid: specialUID,
        email: email,
        displayName: displayName,
        department: 'ADMIN',
        factory: 'ALL',
        role: 'Quản lý',
        createdAt: new Date(),
        lastLoginAt: new Date()
      };

      // Lưu vào Firestore
      const userRef = this.firestore.doc(`users/${specialUserData.uid}`);
      await userRef.set(specialUserData);

      // Lưu permissions đặc biệt
      const permissionRef = this.firestore.collection('user-permissions').doc(specialUserData.uid);
      await permissionRef.set({
        uid: specialUserData.uid,
        email: email,
        displayName: displayName,
        department: 'ADMIN',
        factory: 'ALL',
        role: 'Quản lý',
        hasEditPermission: true,
        isSpecialUser: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Lưu tab permissions cho tất cả tabs
      const tabPermissionRef = this.firestore.collection('user-tab-permissions').doc(specialUserData.uid);
      const allTabPermissions = {
        dashboard: true,
        'work-order': true,
        shipment: true,
        materials: true,
        fg: true,
        label: true,
        bm: true,
        utilization: true,
        find: true,
        layout: true,
        checklist: true,
        equipment: true,
        task: true
      };
      
      await tabPermissionRef.set({
        uid: specialUserData.uid,
        email: email,
        displayName: displayName,
        tabPermissions: allTabPermissions,
        isSpecialUser: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      console.log('✅ Tài khoản đặc biệt đã được tạo và đăng nhập thành công');
    } catch (error) {
      console.error('❌ Lỗi đăng nhập tài khoản đặc biệt:', error);
      throw error;
    }
  }



  // Tạo user profile trong Firestore
  private async createUserProfile(user: any, displayName?: string, department?: string, factory?: string, role?: string): Promise<void> {
    const userRef = this.firestore.doc(`users/${user.uid}`);
    
    const userData: User = {
      uid: user.uid,
      email: user.email,
      displayName: displayName || user.displayName,
      photoURL: user.photoURL,
      department: department,
      factory: factory,
      role: role || 'User',
      createdAt: new Date(),
      lastLoginAt: new Date()
    };

    await userRef.set(userData);

    // Tạo tab permissions với TẤT CẢ false cho user mới (chờ duyệt)
    await this.createDefaultTabPermissionsForNewUser(userData);

    // Tạo thông báo cho tài khoản mới (trừ tài khoản đặc biệt)
    if (user.uid !== 'special-steve-uid') {
      await this.notificationService.createNewUserNotification(userData);
    }
  }

  // Tạo tab permissions mặc định cho user mới - TẤT CẢ đều false (chờ duyệt)
  private async createDefaultTabPermissionsForNewUser(userData: User): Promise<void> {
    try {
      // Danh sách tất cả các tabs
      const allTabs = [
        'dashboard', 'work-order-status', 'shipment',
        'inbound-asm1', 'inbound-asm2', 'outbound-asm1', 'outbound-asm2',
        'materials-asm1', 'materials-asm2', 'inventory-overview-asm1',
        'location', 'warehouse-loading', 'manage', 'stock-check', 'label', 'index', 'utilization',
        'find-rm1', 'checklist', 'safety', 'equipment', 'qc', 'settings'
      ];

      // Tạo permissions object với TẤT CẢ false
      const tabPermissions: { [key: string]: boolean } = {};
      allTabs.forEach(tab => {
        tabPermissions[tab] = false;
      });

      // Lưu vào Firestore
      await this.firestore.collection('user-tab-permissions').doc(userData.uid).set({
        uid: userData.uid,
        email: userData.email,
        displayName: userData.displayName || '',
        tabPermissions: tabPermissions,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      console.log(`✅ Created default tab permissions for new user ${userData.email} - TẤT CẢ tabs = false (chờ duyệt)`);
    } catch (error) {
      console.error(`❌ Error creating default tab permissions for ${userData.email}:`, error);
    }
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