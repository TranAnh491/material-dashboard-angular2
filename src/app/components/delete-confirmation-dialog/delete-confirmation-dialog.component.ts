import { Component, Inject, OnInit } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { UserPermissionService } from '../../services/user-permission.service';
import { firstValueFrom } from 'rxjs';

export interface DeleteDialogData {
  title: string;
  message: string;
  itemName?: string;
}

@Component({
  selector: 'app-delete-confirmation-dialog',
  template: `
    <div class="delete-dialog">
      <div class="dialog-header">
        <mat-icon class="warning-icon">warning</mat-icon>
        <h2 mat-dialog-title>{{ data.title }}</h2>
      </div>

      <div mat-dialog-content class="dialog-content">
        <p class="dialog-message">{{ data.message }}</p>
        
        <div *ngIf="data.itemName" class="item-info">
          <strong>{{ data.itemName }}</strong>
        </div>

        <div *ngIf="isLoading" class="loading-section">
          <div class="loading-message">
            <mat-spinner diameter="20"></mat-spinner>
            <span>Đang kiểm tra quyền xóa...</span>
          </div>
        </div>

        <div *ngIf="!isLoading && !hasDeletePermission" class="no-permission-section">
          <div class="no-permission-message">
            <mat-icon>block</mat-icon>
            <span>Bạn không có quyền xóa. Vui lòng liên hệ quản trị viên để được cấp quyền.</span>
          </div>
        </div>

        <div *ngIf="!isLoading && hasDeletePermission" class="permission-section">
          <div class="permission-message">
            <mat-icon>check_circle</mat-icon>
            <span>Bạn có quyền xóa với tài khoản: <strong>{{ currentUserEmail }}</strong></span>
          </div>
        </div>
      </div>

      <div mat-dialog-actions class="dialog-actions">
        <button mat-stroked-button 
                (click)="onCancel()" 
                [disabled]="isLoading">
          <mat-icon>cancel</mat-icon>
          Hủy
        </button>
        
        <button mat-raised-button 
                color="warn" 
                (click)="onConfirm()"
                [disabled]="isLoading || !hasDeletePermission">
          <mat-icon>delete</mat-icon>
          Xóa
        </button>
      </div>
    </div>
  `,
  styles: [`
    .delete-dialog {
      width: 450px;
      max-width: 90vw;
    }
    
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 20px 10px 20px;
    }
    
    .warning-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: #ff9800;
    }
    
    .dialog-content {
      padding: 10px 20px 20px 20px;
    }
    
    .dialog-message {
      margin: 0 0 15px 0;
      color: #666;
      font-size: 16px;
      line-height: 1.5;
    }
    
    .item-info {
      padding: 12px;
      background-color: #fff3e0;
      border: 1px solid #ffcc02;
      border-radius: 8px;
      margin-bottom: 20px;
      text-align: center;
    }
    
    .loading-section {
      border-top: 1px solid #e0e0e0;
      padding-top: 20px;
      margin-top: 20px;
    }
    
    .loading-message {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #3f51b5;
      font-size: 14px;
      padding: 12px;
      background-color: #e8eaf6;
      border-radius: 8px;
      border: 1px solid #c5cae9;
    }
    
    .no-permission-section {
      border-top: 1px solid #e0e0e0;
      padding-top: 20px;
      margin-top: 20px;
    }
    
    .no-permission-message {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #f44336;
      font-size: 14px;
      padding: 12px;
      background-color: #ffebee;
      border-radius: 8px;
      border: 1px solid #ffcdd2;
    }
    
    .permission-section {
      border-top: 1px solid #e0e0e0;
      padding-top: 20px;
      margin-top: 20px;
    }
    
    .permission-message {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #4caf50;
      font-size: 14px;
      padding: 12px;
      background-color: #e8f5e8;
      border-radius: 8px;
      border: 1px solid #c8e6c9;
    }
    
    .dialog-actions {
      padding: 10px 20px 20px 20px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }
    
    button {
      min-width: 100px;
      height: 42px;
    }
    
    mat-icon {
      margin-right: 6px;
      font-size: 18px;
    }
  `]
})
export class DeleteConfirmationDialogComponent implements OnInit {
  hasDeletePermission = false;
  currentUserEmail = '';
  isLoading = true;

  constructor(
    public dialogRef: MatDialogRef<DeleteConfirmationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DeleteDialogData,
    private firebaseAuthService: FirebaseAuthService,
    private userPermissionService: UserPermissionService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.checkDeletePermission();
  }

  async checkDeletePermission(): Promise<void> {
    try {
      // 1. Lấy user hiện tại từ Firebase Auth
      const currentUser = await firstValueFrom(this.firebaseAuthService.currentUser);
      
      if (!currentUser) {
        console.log('❌ Không có user đăng nhập');
        this.hasDeletePermission = false;
        this.currentUserEmail = '';
        this.isLoading = false;
        return;
      }

      this.currentUserEmail = currentUser.email || '';
      console.log(`👤 User đăng nhập: ${currentUser.email}`);
      
      // 2. Kiểm tra quyền xóa từ Settings (user-permissions collection)
      this.hasDeletePermission = await this.userPermissionService.hasDeletePermission(currentUser.uid);
      
      console.log(`🔍 Kiểm tra quyền xóa cho ${currentUser.email}: ${this.hasDeletePermission ? 'Có quyền' : 'Không có quyền'}`);
      
      if (this.hasDeletePermission) {
        console.log(`✅ User ${currentUser.email} có quyền xóa - OK cho xóa`);
      } else {
        console.log(`❌ User ${currentUser.email} không có quyền xóa - Cần bật trong Settings`);
      }
      
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra quyền xóa:', error);
      this.hasDeletePermission = false;
      this.currentUserEmail = '';
    }
    
    this.isLoading = false;
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    if (this.hasDeletePermission) {
      this.dialogRef.close(true);
    } else {
      this.dialogRef.close(false);
    }
  }
} 