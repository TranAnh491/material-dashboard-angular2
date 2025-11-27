import { Component, OnInit, OnDestroy } from '@angular/core';
import { PermissionService, UserPermission } from '../../services/permission.service';
import { FirebaseAuthService, User } from '../../services/firebase-auth.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { UserPermissionService } from '../../services/user-permission.service';
import { NotificationService } from '../../services/notification.service';
import { EmployeeCleanupService, CleanupResult, EmployeeComparison } from '../../services/employee-cleanup.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit, OnDestroy {
  isAdminLoggedIn = false;
  adminUsername = '';
  adminPassword = '';
  loginError = '';
  isLoggedIn = false;
  newEmployeeId = '';
  newPassword = '';
  hasDeletePermission = false;
  userPermissions: UserPermission[] = [];
  editingUser: UserPermission | null = null;
  showAddUserForm = false;
  isLoading = false;
  // Firebase users
  firebaseUsers: User[] = [];
  isLoadingFirebaseUsers = false;
  // Firebase user permissions
  firebaseUserPermissions: { [key: string]: boolean } = {};
  firebaseUserCompletePermissions: { [key: string]: boolean } = {};
  firebaseUserReadOnlyPermissions: { [key: string]: boolean } = {};
  // Firebase user departments
  firebaseUserDepartments: { [key: string]: string } = {};
  isEditingPermissions = true;
  // Available tabs for permissions - đồng bộ với sidebar routes hiện tại
  availableTabs = [
    // Main tabs
    { key: 'dashboard', name: 'Dashboard' },
    { key: 'work-order-status', name: 'Work Order' },
    { key: 'shipment', name: 'Shipment' },
    
    // ASM1 RM tabs
    { key: 'inbound-asm1', name: 'RM1 Inbound' },
    { key: 'outbound-asm1', name: 'RM1 Outbound' },
    { key: 'materials-asm1', name: 'RM1 Inventory' },
    { key: 'inventory-overview-asm1', name: 'RM1 Overview' },
    
    // ASM2 RM tabs
    { key: 'inbound-asm2', name: 'RM2 Inbound' },
    { key: 'outbound-asm2', name: 'RM2 Outbound' },
    { key: 'materials-asm2', name: 'RM2 Inventory' },
    
    // Other tabs
    { key: 'fg', name: 'Finished Goods' },
    { key: 'label', name: 'Label' },
    { key: 'index', name: 'Bonded Report' },
    { key: 'utilization', name: 'Utilization' },
    { key: 'find', name: 'Find' },
    { key: 'layout', name: 'Layout' },
    { key: 'checklist', name: 'Safety & Quality' },
    { key: 'safety', name: 'Safety Stock' },
    { key: 'equipment', name: 'Training' },
    { key: 'settings', name: 'Settings' }
  ];
  // Firebase user tab permissions
  firebaseUserTabPermissions: { [key: string]: { [key: string]: boolean } } = {};
  // Notifications
  newUserNotifications: any[] = [];
  
  // Table columns for Firebase users
  displayedColumns: string[] = ['email', 'role', 'department', 'factory', 'displayName', 'readOnly', 'lastLoginAt', 'createdAt', 'permission', 'completePermission', 'actions'];
  
  // Thêm biến để kiểm soát refresh
  private refreshTimeout: any = null;
  private isRefreshing = false;

  // Employee cleanup variables
  employeeComparisonResult: CleanupResult | null = null;
  isComparingEmployees = false;
  isCleaningUp = false;
  selectedRedundantEmployees: string[] = [];

  


  constructor(
    private permissionService: PermissionService,
    private firebaseAuthService: FirebaseAuthService,
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private userPermissionService: UserPermissionService,
    private notificationService: NotificationService,
    private employeeCleanupService: EmployeeCleanupService
  ) { }

  ngOnInit(): void {
    console.log('🚀 Settings Component Initializing...');
    
    // Export component ra window để debug
    (window as any).settingsComponent = this;
    
    // Setup auth state listener
    this.setupAuthStateListener();
    
    // Load initial data
    this.loadUserPermissions();
    this.loadFirebaseUsers();
    // Luôn load permissions vì luôn cho phép sửa
    this.loadFirebaseUserPermissions();
    

    
    console.log('✅ Settings Component Initialized');
  }

  ngOnDestroy(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
  }

  // Thiết lập listener cho auth state changes
  private setupAuthStateListener(): void {
    this.afAuth.authState.subscribe(async (user) => {
      if (user) {
        console.log('👤 User authenticated:', user.email);
        // Ensure current user exists in Firestore but don't auto-refresh the list
        await this.ensureCurrentUserInFirestore();
        console.log('ℹ️ Current user ensured in Firestore. Use F5 or manual refresh to see updated user list.');
      } else {
        console.log('👤 User signed out');
        // Clear user data when signed out
        this.firebaseUsers = [];
        this.firebaseUserPermissions = {};
        this.firebaseUserDepartments = {};
        this.firebaseUserTabPermissions = {};
      }
    });
  }



  // Kiểm tra trạng thái Firestore và hiển thị thông tin debug
  async checkFirestoreStatus(): Promise<void> {
    try {
      console.log('🔍 Checking Firestore status...');
      
      // Kiểm tra quyền truy cập collection 'users'
      try {
        const usersSnapshot = await this.firestore.collection('users').get().toPromise();
        console.log(`✅ Users collection accessible: ${usersSnapshot?.size || 0} documents`);
      } catch (error) {
        console.error('❌ Cannot access users collection:', error);
      }
      
      // Kiểm tra quyền truy cập collection 'user-permissions'
      try {
        const permissionsSnapshot = await this.firestore.collection('user-permissions').get().toPromise();
        console.log(`✅ User-permissions collection accessible: ${permissionsSnapshot?.size || 0} documents`);
      } catch (error) {
        console.error('❌ Cannot access user-permissions collection:', error);
      }
      
      // Kiểm tra current user
      const currentUser = await this.afAuth.currentUser;
      if (currentUser) {
        console.log(`✅ Current user: ${currentUser.email} (${currentUser.uid})`);
        
        // Kiểm tra xem current user có trong Firestore không
        try {
          const userDoc = await this.firestore.collection('users').doc(currentUser.uid).get().toPromise();
          console.log(`✅ Current user in Firestore: ${userDoc?.exists ? 'YES' : 'NO'}`);
        } catch (error) {
          console.error('❌ Cannot check current user in Firestore:', error);
        }
      } else {
        console.log('❌ No current user found');
      }
      
      console.log('✅ Firestore status check completed');
      
    } catch (error) {
      console.error('❌ Error checking Firestore status:', error);
    }
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
      console.log('🔍 Loading Firebase users from multiple sources...');
      
      // 1. Đọc từ Firestore collection 'users'
      const usersSnapshot = await this.firestore.collection('users').get().toPromise();
      const firestoreUsers: User[] = [];
      
      if (usersSnapshot && !usersSnapshot.empty) {
        firestoreUsers.push(...usersSnapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            uid: doc.id,
            email: data.email || '',
            displayName: data.displayName || '',
            department: data.department || '',
            factory: data.factory || '',
            role: data.role || 'User',
            photoURL: data.photoURL || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            lastLoginAt: data.lastLoginAt?.toDate() || new Date()
          } as User;
        }));
        
        console.log(`✅ Loaded ${firestoreUsers.length} users from Firestore`);
      }

      // 2. Đọc từ collection 'user-permissions' để tìm thêm users
      try {
        const permissionsSnapshot = await this.firestore.collection('user-permissions').get().toPromise();
        if (permissionsSnapshot && !permissionsSnapshot.empty) {
          permissionsSnapshot.docs.forEach(doc => {
            const data = doc.data() as any;
            if (data.email && !firestoreUsers.some(u => u.uid === doc.id)) {
              firestoreUsers.push({
                uid: doc.id,
                email: data.email || '',
                displayName: data.displayName || '',
                department: data.department || '',
                factory: data.factory || '',
                role: data.role || 'User',
                photoURL: data.photoURL || '',
                createdAt: data.createdAt?.toDate() || new Date(),
                lastLoginAt: data.lastLoginAt?.toDate() || new Date()
              } as User);
              console.log(`✅ Added user from permissions: ${data.email}`);
            }
          });
        }
      } catch (error) {
        console.log('⚠️ Could not load from user-permissions:', error);
      }

      // 3. Đảm bảo current user có trong danh sách
      const currentUser = await this.afAuth.currentUser;
      if (currentUser) {
        const currentUserExists = firestoreUsers.some(u => u.uid === currentUser.uid);
        if (!currentUserExists) {
          firestoreUsers.push({
            uid: currentUser.uid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || '',
            department: '',
            factory: '',
            role: 'User',
            photoURL: currentUser.photoURL || '',
            createdAt: new Date(),
            lastLoginAt: new Date()
          } as User);
          console.log(`✅ Added current user: ${currentUser.email}`);
        }
      }

      // 5. Loại bỏ duplicates và cập nhật danh sách
      const uniqueUsers = firestoreUsers.filter((user, index, self) => 
        index === self.findIndex(u => u.uid === user.uid)
      );
      
      this.firebaseUsers = uniqueUsers;
      console.log(`✅ Final user list: ${this.firebaseUsers.length} unique users`);
      
      // 6. Load permissions, departments và tab permissions cho tất cả users
      await this.loadFirebaseUserPermissions();
      await this.loadFirebaseUserReadOnlyPermissions();
      await this.loadFirebaseUserDepartments();
      await this.loadFirebaseUserTabPermissions();



    } catch (error) {
      console.error('❌ Error loading Firebase users:', error);
      this.firebaseUsers = [];
    }
    this.isLoadingFirebaseUsers = false;
  }

  // Thiết lập real-time listener cho users


  // Đảm bảo user hiện tại được lưu trong Firestore
  async ensureCurrentUserInFirestore(): Promise<void> {
    try {
      const currentUser = await this.afAuth.currentUser;
      if (!currentUser) {
        console.log('⚠️ No current user found');
        return;
      }

      // Kiểm tra xem user đã có trong Firestore chưa
      const userDoc = await this.firestore.collection('users').doc(currentUser.uid).get().toPromise();
      
      if (!userDoc?.exists) {
        console.log(`📝 Creating new user in Firestore: ${currentUser.email}`);
        
        // Tạo user mới trong Firestore
        await this.firestore.collection('users').doc(currentUser.uid).set({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName || '',
          photoURL: currentUser.photoURL || '',
          department: '',
          factory: '',
          role: 'User',
          createdAt: new Date(),
          lastLoginAt: new Date()
        });

        // Tạo permissions mặc định - Tài khoản mới mặc định chỉ được xem
        await this.firestore.collection('user-permissions').doc(currentUser.uid).set({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName || '',
          department: '',
          factory: '',
          role: 'User',
          hasDeletePermission: false,
          hasCompletePermission: false,
          hasReadOnlyPermission: true, // Mặc định chỉ được xem
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Tạo tab permissions mặc định - Chỉ tab Dashboard được truy cập
        const defaultTabPermissions: { [key: string]: boolean } = {};
        this.availableTabs.forEach(tab => {
          // Chỉ tab Dashboard được tick mặc định, các tab khác không tick
          defaultTabPermissions[tab.key] = tab.key === 'dashboard';
        });

        await this.firestore.collection('user-tab-permissions').doc(currentUser.uid).set({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName || '',
          tabPermissions: defaultTabPermissions,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        console.log(`✅ New user created: ${currentUser.email}`);
        
        // Refresh user list
        await this.refreshFirebaseUsers();
      } else {
        console.log(`✅ User already exists in Firestore: ${currentUser.email}`);
        
        // Cập nhật lastLoginAt
        await this.firestore.collection('users').doc(currentUser.uid).update({
          lastLoginAt: new Date()
        });
      }
    } catch (error) {
      console.error('❌ Error ensuring current user in Firestore:', error);
    }
  }



  async refreshFirebaseUsers(): Promise<void> {
    // Kiểm tra nếu đang refresh thì không làm gì
    if (this.isRefreshing) {
      console.log('⚠️ Refresh already in progress, skipping...');
      return;
    }

    // Clear timeout cũ nếu có
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    // Sử dụng debounce để tránh refresh liên tục
    this.refreshTimeout = setTimeout(async () => {
      try {
        this.isRefreshing = true;
        console.log('🔄 Refreshing Firebase users...');
        await this.loadFirebaseUsers();
        console.log('✅ Firebase users refreshed with departments and permissions');
      } catch (error) {
        console.error('❌ Error refreshing Firebase users:', error);
      } finally {
        this.isRefreshing = false;
      }
    }, 500); // Delay 500ms để tránh refresh liên tục
  }

  async deleteFirebaseUser(user: User): Promise<void> {

    if (confirm(`Bạn có chắc chắn muốn xóa user ${user.email}?\n\nHành động này sẽ xóa:\n- Thông tin user\n- Quyền hạn\n- Phân quyền tab\n- Không thể hoàn tác!`)) {
      try {
        console.log(`🗑️ Starting deletion of user: ${user.email} (${user.uid})`);
        
        // Sử dụng service để xóa hoàn toàn
        await this.firebaseAuthService.deleteUser(user.uid);
        
        // Remove from local arrays
        this.firebaseUsers = this.firebaseUsers.filter(u => u.uid !== user.uid);
        delete this.firebaseUserPermissions[user.uid];
        delete this.firebaseUserCompletePermissions[user.uid];
        delete this.firebaseUserReadOnlyPermissions[user.uid];
        delete this.firebaseUserDepartments[user.uid];
        delete this.firebaseUserTabPermissions[user.uid];
        
        // Show success message
        alert(`✅ Đã xóa thành công user ${user.email}!`);
        
        console.log(`📊 Updated user count: ${this.firebaseUsers.length}`);
        
      } catch (error) {
        console.error('❌ Error deleting Firebase user:', error);
        alert(`❌ Có lỗi xảy ra khi xóa user ${user.email}:\n${error}`);
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



  async loadFirebaseUserPermissions(): Promise<void> {
    console.log('🔍 Loading Firebase user permissions...');
    
    // Load current delete and complete permissions for all Firebase users
    for (const user of this.firebaseUsers) {
      try {
        // Đọc từ Firestore collection user-permissions
        const userRef = this.firestore.collection('user-permissions').doc(user.uid);
        const doc = await userRef.get().toPromise();
        
        if (doc?.exists) {
          const data = doc.data() as any;
          this.firebaseUserPermissions[user.uid] = data.hasDeletePermission || false;
          this.firebaseUserCompletePermissions[user.uid] = data.hasCompletePermission || false;
          this.firebaseUserReadOnlyPermissions[user.uid] = data.hasReadOnlyPermission || false;
          console.log(`✅ Loaded permissions for ${user.email}: delete=${data.hasDeletePermission}, complete=${data.hasCompletePermission}, readOnly=${data.hasReadOnlyPermission}`);
                  } else {
            this.firebaseUserPermissions[user.uid] = false; // Default to false
            this.firebaseUserCompletePermissions[user.uid] = false; // Default to false
            this.firebaseUserReadOnlyPermissions[user.uid] = false; // Default to false (không xem gì cả)
            console.log(`✅ Default permissions for ${user.email}: delete=false, complete=false, readOnly=false (không xem gì cả)`);
          }
              } catch (error) {
          console.error('❌ Error loading permissions for user', user.email, ':', error);
          this.firebaseUserPermissions[user.uid] = false; // Default to false on error
          this.firebaseUserCompletePermissions[user.uid] = false; // Default to false on error
          this.firebaseUserReadOnlyPermissions[user.uid] = false; // Default to false (không xem gì cả) on error
        }
    }
    
    console.log('✅ Firebase user permissions loaded');
  }

  async loadFirebaseUserReadOnlyPermissions(): Promise<void> {
    console.log('🔍 Loading Firebase user read-only permissions...');
    console.log('📋 Logic mới: Tài khoản mới mặc định "Chỉ xem" = true, chỉ tab Dashboard được tick');
    
    for (const user of this.firebaseUsers) {
      try {
        const userRef = this.firestore.collection('user-permissions').doc(user.uid);
        const doc = await userRef.get().toPromise();
        
        if (doc?.exists) {
          const data = doc.data() as any;
          this.firebaseUserReadOnlyPermissions[user.uid] = data.hasReadOnlyPermission || false;
          console.log(`✅ Loaded read-only permission for ${user.email}: ${data.hasReadOnlyPermission}`);
                  } else {
            // User mới mặc định KHÔNG xem được gì cả
            this.firebaseUserReadOnlyPermissions[user.uid] = false; // Default to false (không xem gì cả)
            console.log(`✅ Default read-only permission for ${user.email}: false (không xem gì cả)`);
          }
              } catch (error) {
          console.error('❌ Error loading read-only permission for user', user.email, ':', error);
          // User mới mặc định KHÔNG xem được gì cả, ngay cả khi có lỗi
          this.firebaseUserReadOnlyPermissions[user.uid] = false; // Default to false (không xem gì cả) on error
        }
    }
    
    console.log('✅ Firebase user read-only permissions loaded');
  }

  async loadFirebaseUserDepartments(): Promise<void> {
    console.log('🔍 Loading Firebase user departments...');
    
    for (const user of this.firebaseUsers) {
      try {
        const userRef = this.firestore.collection('users').doc(user.uid);
        const doc = await userRef.get().toPromise();
        
        if (doc?.exists) {
          const data = doc.data() as any;
          this.firebaseUserDepartments[user.uid] = data.department || '';
        } else {
          this.firebaseUserDepartments[user.uid] = '';
        }
      } catch (error) {
        console.error('❌ Error loading department for user', user.email, ':', error);
        this.firebaseUserDepartments[user.uid] = '';
      }
    }
    
    console.log('✅ Firebase user departments loaded');
  }

  async loadFirebaseUserTabPermissions(): Promise<void> {
    console.log('🔍 Loading Firebase user tab permissions...');
    console.log('📋 Logic mới: Tài khoản mới mặc định KHÔNG có tab nào được tick - không xem được gì cả');
    
    for (const user of this.firebaseUsers) {
      try {
        const userRef = this.firestore.collection('user-tab-permissions').doc(user.uid);
        const doc = await userRef.get().toPromise();
        
        if (doc?.exists) {
          const data = doc.data() as any;
          this.firebaseUserTabPermissions[user.uid] = data.tabPermissions || {};
          console.log(`✅ Loaded tab permissions for ${user.email}:`, data.tabPermissions);
        } else {
          // Tạo permissions mặc định cho user mới - KHÔNG có tab nào được tick
          const defaultPermissions: { [key: string]: boolean } = {};
          this.availableTabs.forEach(tab => {
            // KHÔNG có tab nào được tick mặc định - user mới không xem được gì cả
            defaultPermissions[tab.key] = false;
          });
          this.firebaseUserTabPermissions[user.uid] = defaultPermissions;
          
          // Lưu vào Firestore
          await this.createDefaultTabPermissionsForUser(user, defaultPermissions);
        }
      } catch (error) {
        console.error('❌ Error loading tab permissions for user', user.email, ':', error);
        // Tạo permissions mặc định nếu có lỗi - KHÔNG có tab nào được tick
        const defaultPermissions: { [key: string]: boolean } = {};
        this.availableTabs.forEach(tab => {
          // KHÔNG có tab nào được tick mặc định - user mới không xem được gì cả
          defaultPermissions[tab.key] = false;
        });
        this.firebaseUserTabPermissions[user.uid] = defaultPermissions;
      }
    }
    
    console.log('✅ Firebase user tab permissions loaded');
  }

  private async createDefaultTabPermissionsForUser(user: User, defaultPermissions: { [key: string]: boolean }): Promise<void> {
    try {
      // Sử dụng permissions mặc định - KHÔNG có tab nào được tick
      const finalPermissions = { ...defaultPermissions };
      
      await this.firestore.collection('user-tab-permissions').doc(user.uid).set({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || '',
        tabPermissions: finalPermissions,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`✅ Created default tab permissions for ${user.email} - KHÔNG có tab nào được tick`);
    } catch (error) {
      console.error(`❌ Error creating default tab permissions for ${user.email}:`, error);
    }
  }

  async refreshTabPermissions(): Promise<void> {
    try {
      console.log('🔄 Refreshing tab permissions for all users...');
      await this.loadFirebaseUserTabPermissions();
      await this.syncMissingTabPermissions();
      console.log('✅ Tab permissions refreshed and synced');
    } catch (error) {
      console.error('❌ Error refreshing tab permissions:', error);
    }
  }

  private async syncMissingTabPermissions(): Promise<void> {
    try {
      console.log('🔄 Syncing missing tab permissions...');
      
      for (const user of this.firebaseUsers) {
        const userTabPermissions = this.firebaseUserTabPermissions[user.uid] || {};
        let hasChanges = false;
        
        // Check if user has permissions for all available tabs
        for (const tab of this.availableTabs) {
          if (userTabPermissions[tab.key] === undefined) {
            // Add missing tab permission - KHÔNG có tab nào được tick mặc định
            userTabPermissions[tab.key] = false;
            hasChanges = true;
            console.log(`➕ Added missing permission for ${user.email}: ${tab.name} = false (không xem gì cả)`);
          }
        }
        
        // Save updated permissions if there were changes
        if (hasChanges) {
          await this.firestore.collection('user-tab-permissions').doc(user.uid).set({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || '',
            tabPermissions: userTabPermissions,
            updatedAt: new Date()
          }, { merge: true });
          
          // Update local data
          this.firebaseUserTabPermissions[user.uid] = userTabPermissions;
        }
      }
      
      console.log('✅ Tab permissions synced for all users');
    } catch (error) {
      console.error('❌ Error syncing tab permissions:', error);
    }
  }

  // Other methods...
  async updateUserPermission(userId: string, hasPermission: boolean): Promise<void> {
    try {
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (!user) return;

      await this.firestore.collection('user-permissions').doc(userId).set({
        uid: userId,
        email: user.email,
        displayName: user.displayName || '',
        hasDeletePermission: hasPermission,
        hasCompletePermission: this.firebaseUserCompletePermissions[userId] || false,
        hasReadOnlyPermission: this.firebaseUserReadOnlyPermissions[userId] || false,
        updatedAt: new Date()
      }, { merge: true });

      this.firebaseUserPermissions[userId] = hasPermission;
      console.log(`✅ Updated delete permission for ${user.email}: ${hasPermission}`);
    } catch (error) {
      console.error('❌ Error updating user permission:', error);
    }
  }

  async updateUserCompletePermission(userId: string, hasPermission: boolean): Promise<void> {
    try {
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (!user) return;

      await this.firestore.collection('user-permissions').doc(userId).set({
        uid: userId,
        email: user.email,
        displayName: user.displayName || '',
        hasDeletePermission: this.firebaseUserPermissions[userId] || false,
        hasCompletePermission: hasPermission,
        hasReadOnlyPermission: this.firebaseUserReadOnlyPermissions[userId] || false,
        updatedAt: new Date()
      }, { merge: true });

      this.firebaseUserCompletePermissions[userId] = hasPermission;
      console.log(`✅ Updated complete permission for ${user.email}: ${hasPermission}`);
    } catch (error) {
      console.error('❌ Error updating user complete permission:', error);
    }
  }

  async updateUserReadOnlyPermission(userId: string, hasPermission: boolean): Promise<void> {
    try {
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (!user) return;

      await this.firestore.collection('user-permissions').doc(userId).set({
        uid: userId,
        email: user.email,
        displayName: user.displayName || '',
        hasDeletePermission: this.firebaseUserPermissions[userId] || false,
        hasCompletePermission: this.firebaseUserCompletePermissions[userId] || false,
        hasReadOnlyPermission: hasPermission,
        updatedAt: new Date()
      }, { merge: true });

      this.firebaseUserReadOnlyPermissions[userId] = hasPermission;
      console.log(`✅ Updated read-only permission for ${user.email}: ${hasPermission}`);
    } catch (error) {
      console.error('❌ Error updating user read-only permission:', error);
    }
  }

  async updateUserDepartment(userId: string, department: string): Promise<void> {
    try {
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (!user) return;

      await this.firestore.collection('users').doc(userId).update({
        department: department,
        updatedAt: new Date()
      });

      // Cập nhật permissions nếu có
      if (this.firebaseUserPermissions[userId] !== undefined || 
          this.firebaseUserCompletePermissions[userId] !== undefined ||
          this.firebaseUserReadOnlyPermissions[userId] !== undefined) {
        await this.firestore.collection('user-permissions').doc(userId).set({
          uid: userId,
          email: user.email,
          displayName: user.displayName || '',
          hasDeletePermission: this.firebaseUserPermissions[userId] || false,
          hasCompletePermission: this.firebaseUserCompletePermissions[userId] || false,
          hasReadOnlyPermission: this.firebaseUserReadOnlyPermissions[userId] || false,
          updatedAt: new Date()
        }, { merge: true });
      }

      this.firebaseUserDepartments[userId] = department;
      console.log(`✅ Updated department for ${user.email}: ${department}`);
    } catch (error) {
      console.error('❌ Error updating user department:', error);
    }
  }

  async updateUserFactory(userId: string, factory: string): Promise<void> {
    try {
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (!user) return;

      await this.firestore.collection('users').doc(userId).update({
        factory: factory,
        updatedAt: new Date()
      });

      // Cập nhật permissions nếu có
      if (this.firebaseUserPermissions[userId] !== undefined || 
          this.firebaseUserCompletePermissions[userId] !== undefined ||
          this.firebaseUserReadOnlyPermissions[userId] !== undefined) {
        await this.firestore.collection('user-permissions').doc(userId).set({
          uid: userId,
          email: user.email,
          displayName: user.displayName || '',
          hasDeletePermission: this.firebaseUserPermissions[userId] || false,
          hasCompletePermission: this.firebaseUserCompletePermissions[userId] || false,
          hasReadOnlyPermission: this.firebaseUserReadOnlyPermissions[userId] || false,
          updatedAt: new Date()
        }, { merge: true });
      }

      user.factory = factory;
      console.log(`✅ Updated factory for ${user.email}: ${factory}`);
    } catch (error) {
      console.error('❌ Error updating user factory:', error);
    }
  }

  async updateUserRole(userId: string, role: string): Promise<void> {
    try {
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (!user) return;

      await this.firestore.collection('users').doc(userId).update({
        role: role,
        updatedAt: new Date()
      });

      // Cập nhật permissions nếu có
      if (this.firebaseUserPermissions[userId] !== undefined || 
          this.firebaseUserCompletePermissions[userId] !== undefined ||
          this.firebaseUserReadOnlyPermissions[userId] !== undefined) {
        await this.firestore.collection('user-permissions').doc(userId).set({
          uid: userId,
          email: user.email,
          displayName: user.displayName || '',
          hasDeletePermission: this.firebaseUserPermissions[userId] || false,
          hasCompletePermission: this.firebaseUserCompletePermissions[userId] || false,
          hasReadOnlyPermission: this.firebaseUserReadOnlyPermissions[userId] || false,
          updatedAt: new Date()
        }, { merge: true });
      }

      user.role = role;
      console.log(`✅ Updated role for ${user.email}: ${role}`);
    } catch (error) {
      console.error('❌ Error updating user role:', error);
    }
  }

  async updateUserTabPermission(userId: string, tabKey: string, hasAccess: boolean): Promise<void> {
    try {
      const user = this.firebaseUsers.find(u => u.uid === userId);
      if (!user) return;

      // Ensure user has tab permissions object
      if (!this.firebaseUserTabPermissions[userId]) {
        this.firebaseUserTabPermissions[userId] = {};
      }

      // Update local data
      this.firebaseUserTabPermissions[userId][tabKey] = hasAccess;

      // Update in Firestore
      await this.firestore.collection('user-tab-permissions').doc(userId).set({
        uid: userId,
        email: user.email,
        displayName: user.displayName || '',
        tabPermissions: this.firebaseUserTabPermissions[userId],
        updatedAt: new Date()
      }, { merge: true });

      console.log(`✅ Updated tab permission for ${user.email}: ${tabKey} = ${hasAccess}`);
    } catch (error) {
      console.error('❌ Error updating user tab permission:', error);
    }
  }

  async saveAllPermissions(): Promise<void> {
    try {
      console.log('💾 Saving all permissions...');

      // Save delete, complete and read-only permissions
      const permissions = Object.keys(this.firebaseUserPermissions).map(uid => ({
        uid: uid,
        hasDeletePermission: this.firebaseUserPermissions[uid],
        hasCompletePermission: this.firebaseUserCompletePermissions[uid] || false,
        hasReadOnlyPermission: this.firebaseUserReadOnlyPermissions[uid] || false
      }));

      for (const permission of permissions) {
        const user = this.firebaseUsers.find(u => u.uid === permission.uid);
        if (user) {
          await this.firestore.collection('user-permissions').doc(permission.uid).set({
            uid: permission.uid,
            email: user.email,
            displayName: user.displayName || '',
            hasDeletePermission: permission.hasDeletePermission,
            hasCompletePermission: permission.hasCompletePermission,
            hasReadOnlyPermission: permission.hasReadOnlyPermission,
            updatedAt: new Date()
          }, { merge: true });
        }
      }

      // Save tab permissions
      for (const [userId, tabPermissions] of Object.entries(this.firebaseUserTabPermissions)) {
        const user = this.firebaseUsers.find(u => u.uid === userId);
        if (user) {
          await this.firestore.collection('user-tab-permissions').doc(userId).set({
            uid: userId,
            email: user.email,
            displayName: user.displayName || '',
            tabPermissions: tabPermissions,
            updatedAt: new Date()
          }, { merge: true });
        }
      }

      console.log('✅ All permissions saved successfully');
      alert('✅ Đã lưu tất cả quyền hạn thành công!');
    } catch (error) {
      console.error('❌ Error saving permissions:', error);
      alert('❌ Có lỗi xảy ra khi lưu quyền hạn!');
    }
  }

  cancelPermissionEdit(): void {
    this.isEditingPermissions = false;
    // Reload permissions to reset any unsaved changes
    this.loadFirebaseUserPermissions();
    this.loadFirebaseUserReadOnlyPermissions();
    this.loadFirebaseUserTabPermissions();
  }

  getTableColumns(): string[] {
    return ['email', 'role', 'department', 'factory', 'displayName', 'readOnly', 'lastLoginAt', 'createdAt', 'permission', 'completePermission', 'actions', ...this.availableTabs.map(tab => 'tab-' + tab.key)];
  }

  getAccountDisplay(user: any): string {
    // admin@asp.com chỉ hiển thị là Admin
    if (user.email === 'admin@asp.com') {
      return 'Admin';
    }
    
    // Nếu có employeeId, hiển thị mã nhân viên ASP
    if (user.employeeId) {
      const displayName = user.displayName ? ` - ${user.displayName}` : '';
      return `${user.employeeId}${displayName}`;
    }
    
    // Xử lý email bắt đầu bằng "asp" - chỉ hiển thị 4 số sau
    if (user.email && user.email.toLowerCase().startsWith('asp')) {
      const email = user.email.toLowerCase();
      const match = email.match(/^asp(\d{4})@/);
      if (match) {
        const numbers = match[1];
        const displayName = user.displayName ? ` - ${user.displayName}` : '';
        return `ASP${numbers}${displayName}`;
      }
    }
    
    // Email @gmail hiển thị nguyên email
    if (user.email && user.email.includes('@gmail')) {
      return user.email;
    }
    
    // Nếu không có employeeId và không phải email asp, hiển thị email
    return user.email;
  }

  // Chỉ hiển thị mã nhân viên, không hiển thị tên
  getEmployeeIdOnly(user: any): string {
    // admin@asp.com chỉ hiển thị là Admin
    if (user.email === 'admin@asp.com') {
      return 'Admin';
    }
    
    // Nếu có employeeId, chỉ hiển thị mã nhân viên
    if (user.employeeId) {
      return user.employeeId;
    }
    
    // Xử lý email bắt đầu bằng "asp" - chỉ hiển thị 4 số sau
    if (user.email && user.email.toLowerCase().startsWith('asp')) {
      const email = user.email.toLowerCase();
      const match = email.match(/^asp(\d{4})@/);
      if (match) {
        const numbers = match[1];
        return `ASP${numbers}`;
      }
    }
    
    // Email @gmail hiển thị nguyên email
    if (user.email && user.email.includes('@gmail')) {
      return user.email;
    }
    
    // Nếu không có employeeId và không phải email asp, hiển thị email
    return user.email;
  }

  getAccountTypeLabel(user: any): string {
    
    if (user.employeeId) {
      return 'Mã nhân viên ASP';
    }
    
    // Xử lý email bắt đầu bằng "asp"
    if (user.email && user.email.toLowerCase().startsWith('asp')) {
      const email = user.email.toLowerCase();
      const match = email.match(/^asp(\d{4})@/);
      if (match) {
        return 'Mã nhân viên ASP';
      }
    }
    
    return 'Email';
  }

  getAccountTypeIcon(user: any): string {
    
    if (user.employeeId) {
      return '👤';
    }
    
    // Xử lý email bắt đầu bằng "asp"
    if (user.email && user.email.toLowerCase().startsWith('asp')) {
      const email = user.email.toLowerCase();
      const match = email.match(/^asp(\d{4})@/);
      if (match) {
        return '👤';
      }
    }
    
    return '📧';
  }

  // Get factory display class for styling
  getFactoryClass(factory: string): string {
    switch (factory?.toUpperCase()) {
      case 'ASM1': return 'factory-asm1';
      case 'ASM2': return 'factory-asm2';
      case 'ALL': return 'factory-all';
      default: return 'factory-default';
    }
  }

  // Get role display class for styling
  getRoleClass(role: string): string {
    switch (role?.toLowerCase()) {
      case 'admin': return 'role-admin';
      case 'quản lý': return 'role-manager';
      case 'user': return 'role-user';
      default: return 'role-default';
    }
  }

  getSortedFirebaseUsers(): User[] {
    // Sort users: by role (Admin > Quản lý > User), then by factory (ASM1 > ASM2 > ALL), then by email
    return this.firebaseUsers.sort((a, b) => {
      
      // Sort by role priority: Admin > Quản lý > User
      const getRolePriority = (role: string): number => {
        switch (role?.toLowerCase()) {
          case 'admin': return 1;
          case 'quản lý': return 2;
          case 'user': return 3;
          default: return 4;
        }
      };
      
      const roleComparison = getRolePriority(a.role || 'user') - getRolePriority(b.role || 'user');
      if (roleComparison !== 0) return roleComparison;
      
      // Sort by factory priority: ASM1 > ASM2 > ALL > others
      const getFactoryPriority = (factory: string): number => {
        switch (factory?.toUpperCase()) {
          case 'ASM1': return 1;
          case 'ASM2': return 2;
          case 'ALL': return 3;
          default: return 4;
        }
      };
      
      const factoryComparison = getFactoryPriority(a.factory || '') - getFactoryPriority(b.factory || '');
      if (factoryComparison !== 0) return factoryComparison;
      
      // Finally sort by email
      return (a.email || '').localeCompare(b.email || '');
    });
  }


  // Get count of admin users
  getAdminUsersCount(): number {
    return this.firebaseUsers.filter(user => 
      user.role === 'admin' || 
      user.role === 'Admin' || 
      user.role === 'Quản lý'
    ).length;
  }

  // ==================== EMPLOYEE CLEANUP METHODS ====================

  /**
   * So sánh mã nhân viên giữa Settings và Firebase
   */
  async compareEmployees(): Promise<void> {
    this.isComparingEmployees = true;
    try {
      console.log('🔍 Bắt đầu so sánh mã nhân viên...');
      
      // Debug: Hiển thị danh sách users
      this.debugSettingsUsers();
      
      // Sử dụng danh sách users thực tế từ Settings
      if (this.firebaseUsers && this.firebaseUsers.length > 0) {
        console.log(`📋 Sử dụng ${this.firebaseUsers.length} users từ Settings`);
        this.employeeComparisonResult = await this.employeeCleanupService.compareEmployeesWithSettingsUsers(this.firebaseUsers);
      } else {
        console.log('⚠️ Chưa có danh sách users, sử dụng method cũ');
        this.employeeComparisonResult = await this.employeeCleanupService.compareEmployees();
      }
      
      console.log('✅ Hoàn thành so sánh:', this.employeeComparisonResult.summary);
    } catch (error) {
      console.error('❌ Lỗi khi so sánh mã nhân viên:', error);
      alert('❌ Có lỗi xảy ra khi so sánh mã nhân viên!');
    } finally {
      this.isComparingEmployees = false;
    }
  }

  /**
   * Debug: Hiển thị chi tiết danh sách users trong Settings
   */
  private debugSettingsUsers(): void {
    console.log('🔍 DEBUG: Danh sách users trong Settings:');
    console.log(`📊 Tổng số users: ${this.firebaseUsers.length}`);
    
    this.firebaseUsers.forEach((user, index) => {
      const empId = this.getEmployeeIdOnly(user);
      console.log(`  ${index + 1}. ${empId} (${user.email}) - UID: ${user.uid}`);
      console.log(`     - employeeId: ${user.employeeId || 'N/A'}`);
      console.log(`     - displayName: ${user.displayName || 'N/A'}`);
      console.log(`     - email: ${user.email || 'N/A'}`);
    });
  }

  /**
   * Xóa mã nhân viên dư thừa đã chọn
   */
  async cleanupSelectedEmployees(): Promise<void> {
    if (this.selectedRedundantEmployees.length === 0) {
      alert('⚠️ Vui lòng chọn ít nhất một mã nhân viên để xóa!');
      return;
    }

    const confirmMessage = `Bạn có chắc chắn muốn xóa ${this.selectedRedundantEmployees.length} mã nhân viên dư thừa?\n\n` +
      `Danh sách sẽ xóa:\n${this.selectedRedundantEmployees.join(', ')}\n\n` +
      `⚠️ LƯU Ý: Hành động này sẽ thay thế mã nhân viên bằng "DELETED_EMPLOYEE" và không thể hoàn tác!`;

    if (!confirm(confirmMessage)) {
      return;
    }

    this.isCleaningUp = true;
    try {
      console.log('🗑️ Bắt đầu xóa mã nhân viên dư thừa...');
      const result = await this.employeeCleanupService.cleanupRedundantEmployees(this.selectedRedundantEmployees);
      
      console.log('✅ Hoàn thành xóa:', result);
      alert(`✅ Đã xóa thành công ${result.success} mã nhân viên!\n` +
            `❌ Lỗi: ${result.errors}\n\n` +
            `Chi tiết:\n${result.details.join('\n')}`);
      
      // Refresh comparison result
      await this.compareEmployees();
      this.selectedRedundantEmployees = [];
      
    } catch (error) {
      console.error('❌ Lỗi khi xóa mã nhân viên:', error);
      alert('❌ Có lỗi xảy ra khi xóa mã nhân viên!');
    } finally {
      this.isCleaningUp = false;
    }
  }

  /**
   * Xóa tất cả mã nhân viên dư thừa
   */
  async cleanupAllRedundantEmployees(): Promise<void> {
    if (!this.employeeComparisonResult || this.employeeComparisonResult.redundantEmployees.length === 0) {
      alert('⚠️ Không có mã nhân viên dư thừa để xóa!');
      return;
    }

    const allRedundantIds = this.employeeComparisonResult.redundantEmployees.map(emp => emp.employeeId);
    this.selectedRedundantEmployees = allRedundantIds;
    await this.cleanupSelectedEmployees();
  }

  /**
   * Chọn/bỏ chọn mã nhân viên dư thừa
   */
  toggleRedundantEmployeeSelection(employeeId: string): void {
    const index = this.selectedRedundantEmployees.indexOf(employeeId);
    if (index > -1) {
      this.selectedRedundantEmployees.splice(index, 1);
    } else {
      this.selectedRedundantEmployees.push(employeeId);
    }
  }

  /**
   * Kiểm tra xem mã nhân viên có được chọn không
   */
  isRedundantEmployeeSelected(employeeId: string): boolean {
    return this.selectedRedundantEmployees.includes(employeeId);
  }

  /**
   * Chọn tất cả mã nhân viên dư thừa
   */
  selectAllRedundantEmployees(): void {
    if (this.employeeComparisonResult) {
      this.selectedRedundantEmployees = this.employeeComparisonResult.redundantEmployees.map(emp => emp.employeeId);
    }
  }

  /**
   * Bỏ chọn tất cả mã nhân viên dư thừa
   */
  deselectAllRedundantEmployees(): void {
    this.selectedRedundantEmployees = [];
  }

  /**
   * Xuất báo cáo so sánh
   */
  exportComparisonReport(): void {
    if (this.employeeComparisonResult) {
      this.employeeCleanupService.exportComparisonReport(this.employeeComparisonResult);
    }
  }

  /**
   * Format ngày tháng cho hiển thị
   */
  formatDate(date: Date | undefined): string {
    if (!date) return 'N/A';
    return date.toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Đánh dấu tất cả thông báo đã đọc
   */
  async markAllNotificationsAsReadPublic(): Promise<void> {
    try {
      const currentUser = await this.afAuth.currentUser;
      const readBy = currentUser?.email || 'admin';
      
      // Đánh dấu tất cả trong Firebase
      await this.notificationService.markAllNotificationsAsRead(readBy);
      
      // Xóa tất cả notifications khỏi danh sách
      this.newUserNotifications = [];
      console.log('✅ Đã đánh dấu tất cả thông báo đã đọc');
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  }

  /**
   * Đánh dấu một thông báo đã đọc
   */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      const currentUser = await this.afAuth.currentUser;
      const readBy = currentUser?.email || 'admin';
      
      // Đánh dấu trong Firebase
      await this.notificationService.markNotificationAsRead(notificationId, readBy);
      
      // Xóa notification khỏi danh sách
      this.newUserNotifications = this.newUserNotifications.filter(n => n.id !== notificationId);
      console.log(`✅ Đã đánh dấu thông báo ${notificationId} đã đọc`);
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }
}