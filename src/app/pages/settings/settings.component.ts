import { Component, OnInit } from '@angular/core';
import { PermissionService, UserPermission } from '../../services/permission.service';
import { FirebaseAuthService, User } from '../../services/firebase-auth.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { UserPermissionService, UserPermission as FirebaseUserPermission } from '../../services/user-permission.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  isAdminLoggedIn = false;
  adminUsername = '';
  adminPassword = '';
  loginError = '';

  // User management
  newEmployeeId = '';
  newPassword = '';
  hasDeletePermission = false;
  userPermissions: UserPermission[] = [];
  editingUser: UserPermission | null = null;

  // UI states
  showAddUserForm = false;
  isLoading = false;

  // Firebase users
  firebaseUsers: User[] = [];
  isLoadingFirebaseUsers = false;
  
  // Permission management
  firebaseUserPermissions: { [key: string]: boolean } = {};
  isEditingPermissions = false;

  constructor(
    private permissionService: PermissionService,
    private firebaseAuthService: FirebaseAuthService,
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private userPermissionService: UserPermissionService
  ) { }

  ngOnInit(): void {
    this.loadUserPermissions();
    this.loadFirebaseUsers();
  }

  async adminLogin(): Promise<void> {
    if (this.adminUsername === 'Admin' && this.adminPassword === 'Admin') {
      this.isAdminLoggedIn = true;
      this.loginError = '';
      this.adminPassword = ''; // Clear password
    } else {
      this.loginError = 'Tên đăng nhập hoặc mật khẩu không đúng!';
      this.adminPassword = '';
    }
  }

  logout(): void {
    this.isAdminLoggedIn = false;
    this.adminUsername = '';
    this.adminPassword = '';
    this.loginError = '';
  }

  async loadUserPermissions(): Promise<void> {
    this.isLoading = true;
    try {
      this.userPermissions = await this.permissionService.getAllUserPermissions();
    } catch (error) {
      console.error('Error loading user permissions:', error);
    }
    this.isLoading = false;
  }

  async addUser(): Promise<void> {
    if (!this.newEmployeeId || !this.newPassword) {
      alert('Vui lòng nhập đầy đủ thông tin!');
      return;
    }

    if (this.userPermissions.find(u => u.employeeId === this.newEmployeeId)) {
      alert('Mã nhân viên đã tồn tại!');
      return;
    }

    this.isLoading = true;
    try {
      const newUser: UserPermission = {
        employeeId: this.newEmployeeId,
        password: this.newPassword,
        hasDeletePermission: this.hasDeletePermission,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.permissionService.saveUserPermission(newUser);
      await this.loadUserPermissions();
      
      // Reset form
      this.newEmployeeId = '';
      this.newPassword = '';
      this.hasDeletePermission = false;
      this.showAddUserForm = false;

      alert('Thêm nhân viên thành công!');
    } catch (error) {
      console.error('Error adding user:', error);
      alert('Có lỗi xảy ra khi thêm nhân viên!');
    }
    this.isLoading = false;
  }

  editUser(user: UserPermission): void {
    this.editingUser = { ...user };
  }

  async updateUser(): Promise<void> {
    if (!this.editingUser) return;

    this.isLoading = true;
    try {
      this.editingUser.updatedAt = new Date();
      await this.permissionService.updateUserPermission(this.editingUser);
      await this.loadUserPermissions();
      this.editingUser = null;
      alert('Cập nhật thành công!');
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Có lỗi xảy ra khi cập nhật!');
    }
    this.isLoading = false;
  }

  cancelEdit(): void {
    this.editingUser = null;
  }

  async deleteUser(user: UserPermission): Promise<void> {
    if (confirm(`Bạn có chắc chắn muốn xóa nhân viên ${user.employeeId}?`)) {
      this.isLoading = true;
      try {
        await this.permissionService.deleteUserPermission(user.employeeId);
        await this.loadUserPermissions();
        alert('Xóa nhân viên thành công!');
      } catch (error) {
        console.error('Error deleting user:', error);
        alert('Có lỗi xảy ra khi xóa nhân viên!');
      }
      this.isLoading = false;
    }
  }

  toggleAddUserForm(): void {
    this.showAddUserForm = !this.showAddUserForm;
    if (!this.showAddUserForm) {
      // Reset form when hiding
      this.newEmployeeId = '';
      this.newPassword = '';
      this.hasDeletePermission = false;
    }
  }

  // Firebase Users Management
  async loadFirebaseUsers(): Promise<void> {
    this.isLoadingFirebaseUsers = true;
    try {
      console.log('🔍 Loading Firebase users from Firestore...');
      
      // Đọc từ Firestore collection 'users'
      const usersSnapshot = await this.firestore.collection('users').get().toPromise();
      
      if (usersSnapshot && !usersSnapshot.empty) {
        this.firebaseUsers = usersSnapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            uid: doc.id,
            email: data.email || '',
            displayName: data.displayName || '',
            photoURL: data.photoURL || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            lastLoginAt: data.lastLoginAt?.toDate() || new Date()
          } as User;
        });
        
        console.log(`✅ Loaded ${this.firebaseUsers.length} users from Firestore`);
        
        // Load permissions cho tất cả users
        await this.loadFirebaseUserPermissions();
      } else {
        console.log('❌ No users found in Firestore');
        this.firebaseUsers = [];
      }
    } catch (error) {
      console.error('❌ Error loading Firebase users from Firestore:', error);
      this.firebaseUsers = [];
    }
    this.isLoadingFirebaseUsers = false;
  }

  // Đảm bảo user hiện tại được lưu trong Firestore
  private async ensureCurrentUserInFirestore(): Promise<void> {
    try {
      const currentUser = await this.firebaseAuthService.currentUser.toPromise();
      if (currentUser) {
        console.log('🔧 Ensuring current user in Firestore:', currentUser.email);
        
        const userRef = this.firestore.collection('users').doc(currentUser.uid);
        const doc = await userRef.get().toPromise();
        
        if (!doc?.exists) {
          console.log('📝 Creating user in Firestore...');
          await userRef.set({
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName || '',
            photoURL: currentUser.photoURL || '',
            createdAt: new Date(),
            lastLoginAt: new Date()
          });
          console.log('✅ User created in Firestore');
        } else {
          console.log('✅ User already exists in Firestore');
          // Cập nhật lastLoginAt
          await userRef.update({
            lastLoginAt: new Date()
          });
        }
      }
    } catch (error) {
      console.error('❌ Error ensuring current user in Firestore:', error);
    }
  }

  async refreshFirebaseUsers(): Promise<void> {
    console.log('🔄 Refreshing Firebase users...');
    await this.loadFirebaseUsers();
  }

  async deleteFirebaseUser(user: User): Promise<void> {
    if (confirm(`Bạn có chắc chắn muốn xóa user ${user.email}?`)) {
      try {
        // Delete from Firestore
        await this.firestore.collection('users').doc(user.uid).delete();
        
        // Note: Deleting from Firebase Auth requires admin SDK
        console.log(`✅ Deleted user ${user.email} from Firestore`);
        
        // Refresh the list
        await this.loadFirebaseUsers();
        alert('Xóa user thành công!');
      } catch (error) {
        console.error('❌ Error deleting Firebase user:', error);
        alert('Có lỗi xảy ra khi xóa user!');
      }
    }
  }

  getCurrentUser(): User | null {
    let currentUser: User | null = null;
    this.firebaseAuthService.currentUser.subscribe(user => {
      currentUser = user;
    });
    return currentUser;
  }

  // Permission management methods
  togglePermissionMode(): void {
    this.isEditingPermissions = !this.isEditingPermissions;
    if (this.isEditingPermissions) {
      this.loadFirebaseUserPermissions();
    }
  }

  async loadFirebaseUserPermissions(): Promise<void> {
    console.log('🔍 Loading Firebase user permissions...');
    
    // Load current permissions for all Firebase users
    for (const user of this.firebaseUsers) {
      try {
        // Đọc từ Firestore collection user-permissions
        const userRef = this.firestore.collection('user-permissions').doc(user.uid);
        const doc = await userRef.get().toPromise();
        
        if (doc?.exists) {
          const data = doc.data() as any;
          this.firebaseUserPermissions[user.uid] = data.hasEditPermission || false;
          console.log(`✅ Loaded permission for ${user.email}: ${data.hasEditPermission}`);
        } else {
          this.firebaseUserPermissions[user.uid] = false; // Default to false
          console.log(`✅ Default permission for ${user.email}: false`);
        }
      } catch (error) {
        console.error(`❌ Error loading permission for user ${user.uid}:`, error);
        this.firebaseUserPermissions[user.uid] = false; // Default to false on error
      }
    }
  }

  async updateUserPermission(userId: string, hasPermission: boolean): Promise<void> {
    try {
      console.log(`🔄 Updating permission for user ${userId}: ${hasPermission}`);
      
      // Cập nhật trong memory
      this.firebaseUserPermissions[userId] = hasPermission;
      
      // Tìm user để lấy email và displayName
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (user) {
        // Lưu vào Firestore collection user-permissions
        const userRef = this.firestore.collection('user-permissions').doc(userId);
        await userRef.set({
          uid: userId,
          email: user.email,
          displayName: user.displayName || '',
          hasEditPermission: hasPermission,
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        
        console.log(`✅ Permission saved to Firestore for user ${userId}`);
      }
    } catch (error) {
      console.error('❌ Error updating permission:', error);
      // Revert change nếu có lỗi
      this.firebaseUserPermissions[userId] = !hasPermission;
    }
  }

  async updateUserDepartment(userId: string, department: string): Promise<void> {
    try {
      console.log(`🔄 Updating department for user ${userId}: ${department}`);
      
      // Tìm user để lấy thông tin
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (user) {
        // Cập nhật department trong memory
        user.department = department;
        
        // Lưu vào Firestore collection user-permissions
        const userRef = this.firestore.collection('user-permissions').doc(userId);
        await userRef.set({
          uid: userId,
          email: user.email,
          displayName: user.displayName || '',
          department: department,
          hasEditPermission: this.firebaseUserPermissions[userId] || false,
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        
        console.log(`✅ Department saved to Firestore for user ${userId}: ${department}`);
      }
    } catch (error) {
      console.error('❌ Error updating department:', error);
      alert('Có lỗi xảy ra khi cập nhật bộ phận!');
    }
  }

  async saveAllPermissions(): Promise<void> {
    try {
      // Prepare permissions for batch update
      const permissions = Object.keys(this.firebaseUserPermissions).map(uid => ({
        uid,
        hasEditPermission: this.firebaseUserPermissions[uid]
      }));

      await this.userPermissionService.batchUpdatePermissions(permissions);
      
      this.isEditingPermissions = false;
      alert('Đã lưu tất cả quyền!');
    } catch (error) {
      console.error('Error saving permissions:', error);
      alert('Có lỗi xảy ra khi lưu quyền!');
    }
  }

  cancelPermissionEdit(): void {
    this.isEditingPermissions = false;
    this.firebaseUserPermissions = {};
  }
} 