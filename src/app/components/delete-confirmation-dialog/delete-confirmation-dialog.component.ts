import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PermissionService } from '../../services/permission.service';

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

        <div class="auth-section">
          <h3>Xác thực quyền xóa</h3>
          <p class="auth-description">Nhập mã nhân viên và mật khẩu để xác nhận quyền xóa:</p>
          
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Mã nhân viên</mat-label>
            <input matInput 
                   type="text" 
                   [(ngModel)]="employeeId"
                   placeholder="VD: ASP001"
                   [disabled]="isValidating">
            <mat-icon matSuffix>badge</mat-icon>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Mật khẩu</mat-label>
            <input matInput 
                   type="password" 
                   [(ngModel)]="password"
                   placeholder="Nhập mật khẩu"
                   [disabled]="isValidating">
            <mat-icon matSuffix>key</mat-icon>
          </mat-form-field>

          <div *ngIf="errorMessage" class="error-message">
            <mat-icon>error</mat-icon>
            {{ errorMessage }}
          </div>

          <div *ngIf="isValidating" class="validating-message">
            <mat-spinner diameter="20"></mat-spinner>
            <span>Đang xác thực...</span>
          </div>
        </div>
      </div>

      <div mat-dialog-actions class="dialog-actions">
        <button mat-stroked-button 
                (click)="onCancel()" 
                [disabled]="isValidating">
          <mat-icon>cancel</mat-icon>
          Hủy
        </button>
        
        <button mat-raised-button 
                color="warn" 
                (click)="onConfirm()"
                [disabled]="!employeeId || !password || isValidating">
          <mat-icon>delete</mat-icon>
          {{ isValidating ? 'Đang xác thực...' : 'Xóa' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .delete-dialog {
      width: 450px;
      max-width: 90vw;
      
      .dialog-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 20px 20px 10px 20px;
        
        .warning-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: #ff9800;
        }
        
        h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          color: #333;
        }
      }
      
      .dialog-content {
        padding: 10px 20px 20px 20px;
        
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
          
          strong {
            color: #e65100;
            font-size: 16px;
          }
        }
        
        .auth-section {
          border-top: 1px solid #e0e0e0;
          padding-top: 20px;
          margin-top: 20px;
          
          h3 {
            margin: 0 0 8px 0;
            font-size: 16px;
            font-weight: 600;
            color: #333;
            display: flex;
            align-items: center;
            gap: 8px;
            
            &::before {
              content: '';
              display: block;
              width: 4px;
              height: 20px;
              background: #f44336;
              border-radius: 2px;
            }
          }
          
          .auth-description {
            margin: 0 0 20px 0;
            color: #666;
            font-size: 14px;
          }
          
          .full-width {
            width: 100%;
            margin-bottom: 16px;
          }
          
          .error-message {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #f44336;
            font-size: 14px;
            margin-bottom: 16px;
            padding: 12px;
            background-color: #ffebee;
            border-radius: 8px;
            border: 1px solid #ffcdd2;
            
            mat-icon {
              font-size: 18px;
              width: 18px;
              height: 18px;
            }
          }
          
          .validating-message {
            display: flex;
            align-items: center;
            gap: 12px;
            color: #3f51b5;
            font-size: 14px;
            margin-bottom: 16px;
            padding: 12px;
            background-color: #e8eaf6;
            border-radius: 8px;
            border: 1px solid #c5cae9;
            
            mat-spinner {
              margin: 0;
            }
            
            span {
              font-weight: 500;
            }
          }
        }
      }
      
      .dialog-actions {
        padding: 10px 20px 20px 20px;
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        
        button {
          min-width: 100px;
          height: 42px;
          
          mat-icon {
            margin-right: 6px;
            font-size: 18px;
          }
        }
      }
    }
  `]
})
export class DeleteConfirmationDialogComponent {
  employeeId = '';
  password = '';
  isValidating = false;
  errorMessage = '';

  constructor(
    public dialogRef: MatDialogRef<DeleteConfirmationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DeleteDialogData,
    private permissionService: PermissionService
  ) {}

  onCancel(): void {
    this.dialogRef.close(false);
  }

  async onConfirm(): Promise<void> {
    if (!this.employeeId || !this.password) {
      this.errorMessage = 'Vui lòng nhập đầy đủ thông tin!';
      return;
    }

    this.isValidating = true;
    this.errorMessage = '';

    try {
      const isValid = await this.permissionService.validateUserCredentials(this.employeeId, this.password);
      
      if (isValid) {
        this.dialogRef.close(true);
      } else {
        this.errorMessage = 'Mã nhân viên hoặc mật khẩu không đúng, hoặc bạn không có quyền xóa!';
      }
    } catch (error) {
      console.error('Error validating credentials:', error);
      this.errorMessage = 'Có lỗi xảy ra khi xác thực thông tin!';
    }

    this.isValidating = false;
  }
} 