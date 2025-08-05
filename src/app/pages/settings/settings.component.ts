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
  
  // Tab access permissions
  availableTabs = [
    { key: 'dashboard', name: 'Dashboard', icon: 'dashboard' },
    { key: 'work-order', name: 'Work Order', icon: 'assignment' },
    { key: 'shipment', name: 'Shipment', icon: 'local_shipping' },
    { key: 'materials', name: 'Materials', icon: 'inventory_2' },
    { key: 'fg', name: 'Finished Goods', icon: 'check_circle_outline' },
    { key: 'label', name: 'Label', icon: 'label' },
    { key: 'bm', name: 'Bonded Materials', icon: 'lock' },
    { key: 'utilization', name: 'Utilization', icon: 'assessment' },
    { key: 'find', name: 'Find', icon: 'search' },
    { key: 'layout', name: 'Layout', icon: 'grid_view' },
    { key: 'checklist', name: 'Safety & Quality', icon: 'checklist' },
    { key: 'equipment', name: 'Training', icon: 'integration_instructions' },
    { key: 'task', name: 'Flow Work', icon: 'view_kanban' }
  ];
  
  // Tab permissions for each user: { userId: { tabKey: boolean } }
  firebaseUserTabPermissions: { [key: string]: { [key: string]: boolean } } = {};

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
            department: data.department || '', // Load department từ users collection
            photoURL: data.photoURL || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            lastLoginAt: data.lastLoginAt?.toDate() || new Date()
          } as User;
        });
        
        console.log(`✅ Loaded ${this.firebaseUsers.length} users from Firestore`);
        
        // Load permissions, departments và tab permissions cho tất cả users
        await this.loadFirebaseUserPermissions();
        await this.loadFirebaseUserDepartments();
        await this.loadFirebaseUserTabPermissions();
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
    console.log('✅ Firebase users refreshed with departments and permissions');
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

  async loadFirebaseUserDepartments(): Promise<void> {
    console.log('🔍 Loading Firebase user departments...');
    
    // Load current departments for all Firebase users
    for (const user of this.firebaseUsers) {
      try {
        // Đọc từ Firestore collection user-permissions
        const userRef = this.firestore.collection('user-permissions').doc(user.uid);
        const doc = await userRef.get().toPromise();
        
        if (doc?.exists) {
          const data = doc.data() as any;
          user.department = data.department || '';
          console.log(`✅ Loaded department for ${user.email}: ${data.department}`);
        } else {
          // Kiểm tra trong users collection
          const userDoc = await this.firestore.collection('users').doc(user.uid).get().toPromise();
          if (userDoc?.exists) {
            const userData = userDoc.data() as any;
            user.department = userData.department || '';
            console.log(`✅ Loaded department from users collection for ${user.email}: ${userData.department}`);
          } else {
            user.department = ''; // Default to empty
            console.log(`✅ Default department for ${user.email}: empty`);
          }
        }
      } catch (error) {
        console.error(`❌ Error loading department for user ${user.uid}:`, error);
        user.department = ''; // Default to empty on error
      }
    }
  }

  async loadFirebaseUserTabPermissions(): Promise<void> {
    console.log('🔍 Loading Firebase user tab permissions...');
    
    // Load current tab permissions for all Firebase users
    for (const user of this.firebaseUsers) {
      try {
        // Đọc từ Firestore collection user-tab-permissions
        const userRef = this.firestore.collection('user-tab-permissions').doc(user.uid);
        const doc = await userRef.get().toPromise();
        
        if (doc?.exists) {
          const data = doc.data() as any;
          this.firebaseUserTabPermissions[user.uid] = data.tabPermissions || {};
          console.log(`✅ Loaded tab permissions for ${user.email}:`, data.tabPermissions);
        } else {
          // Default all tabs to true (accessible)
          const defaultPermissions: { [key: string]: boolean } = {};
          this.availableTabs.forEach(tab => {
            defaultPermissions[tab.key] = true;
          });
          this.firebaseUserTabPermissions[user.uid] = defaultPermissions;
          console.log(`✅ Default tab permissions for ${user.email}: all enabled`);
        }
      } catch (error) {
        console.error(`❌ Error loading tab permissions for user ${user.uid}:`, error);
        // Default all tabs to true on error
        const defaultPermissions: { [key: string]: boolean } = {};
        this.availableTabs.forEach(tab => {
          defaultPermissions[tab.key] = true;
        });
        this.firebaseUserTabPermissions[user.uid] = defaultPermissions;
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
        
        // Cũng lưu vào users collection để đảm bảo consistency
        const usersRef = this.firestore.collection('users').doc(userId);
        await usersRef.update({
          department: department,
          updatedAt: new Date()
        });
        
        console.log(`✅ Department saved to both collections for user ${userId}: ${department}`);
        
        // Hiển thị thông báo thành công
        console.log(`✅ Department updated successfully for ${user.email}: ${department}`);
      }
    } catch (error) {
      console.error('❌ Error updating department:', error);
      alert('Có lỗi xảy ra khi cập nhật bộ phận!');
    }
  }

  async updateUserTabPermission(userId: string, tabKey: string, hasAccess: boolean): Promise<void> {
    try {
      console.log(`🔄 Updating tab permission for user ${userId}, tab ${tabKey}: ${hasAccess}`);
      
      // Cập nhật trong memory
      if (!this.firebaseUserTabPermissions[userId]) {
        this.firebaseUserTabPermissions[userId] = {};
      }
      this.firebaseUserTabPermissions[userId][tabKey] = hasAccess;
      
      // Tìm user để lấy thông tin
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (user) {
        // Lưu vào Firestore collection user-tab-permissions
        const userRef = this.firestore.collection('user-tab-permissions').doc(userId);
        await userRef.set({
          uid: userId,
          email: user.email,
          displayName: user.displayName || '',
          tabPermissions: this.firebaseUserTabPermissions[userId],
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        
        console.log(`✅ Tab permission saved to Firestore for user ${userId}, tab ${tabKey}`);
      }
    } catch (error) {
      console.error('❌ Error updating tab permission:', error);
      // Revert change nếu có lỗi
      if (this.firebaseUserTabPermissions[userId]) {
        this.firebaseUserTabPermissions[userId][tabKey] = !hasAccess;
      }
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

  // Tạo danh sách columns cho table
  getTableColumns(): string[] {
    const baseColumns = ['email', 'department', 'displayName', 'createdAt', 'permission', 'lastLoginAt', 'actions'];
    const tabColumns = this.availableTabs.map(tab => 'tab-' + tab.key);
    return [...baseColumns, ...tabColumns];
  }

  // Hiển thị tài khoản (email hoặc mã số nhân viên)
  getAccountDisplay(user: any): string {
    if (user.email.includes('@asp.com')) {
      // Nếu là email nội bộ (ASP format), hiển thị mã số nhân viên viết hoa
      return user.email.replace('@asp.com', '').toUpperCase();
    } else {
      // Nếu là email thật, hiển thị email
      return user.email;
    }
  }

  // Sắp xếp users theo bộ phận với WH đứng đầu
  getSortedFirebaseUsers(): User[] {
    const departmentOrder = ['WH', 'QA', 'ENG', 'PLAN', 'PD', 'CS', 'ACC'];
    
    return this.firebaseUsers.sort((a, b) => {
      const deptA = a.department || '';
      const deptB = b.department || '';
      
      const indexA = departmentOrder.indexOf(deptA);
      const indexB = departmentOrder.indexOf(deptB);
      
      // Nếu cả hai đều có trong danh sách, sắp xếp theo thứ tự
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      
      // Nếu chỉ một có trong danh sách, đưa lên đầu
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      
      // Nếu cả hai không có trong danh sách, sắp xếp theo alphabet
      return deptA.localeCompare(deptB);
    });
  }
} 