import { Component, OnInit } from '@angular/core';
import { PermissionService, UserPermission } from '../../services/permission.service';

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

  constructor(private permissionService: PermissionService) { }

  ngOnInit(): void {
    this.loadUserPermissions();
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
} 