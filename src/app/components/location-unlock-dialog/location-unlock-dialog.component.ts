import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { LocationUnlockService } from '../../services/location-unlock.service';

@Component({
  selector: 'app-location-unlock-dialog',
  template: `
    <div class="unlock-dialog">
      <div class="dialog-header">
        <i class="material-icons">lock_open</i>
        <h2>Mở khóa cột Vị trí</h2>
      </div>
      <div class="dialog-content">
        <p class="hint">
          Nhập mã nhân viên được phép. Zalo bot sẽ gửi mã 4 số. Phiên mở khóa có hiệu lực
          <strong>10 phút</strong> hoặc hết khi tải lại trang (F5).
        </p>
        <label class="field-label">Mã nhân viên</label>
        <input
          class="field-input"
          [(ngModel)]="employeeId"
          [disabled]="step === 2 || isSending || isVerifying"
          placeholder="VD: ASP0106"
          (keyup.enter)="onSendOtp()" />
        <ng-container *ngIf="step === 2">
          <label class="field-label">Mã từ Zalo (4 số)</label>
          <input
            class="field-input otp-input"
            [(ngModel)]="otpCode"
            [disabled]="isVerifying"
            maxlength="4"
            inputmode="numeric"
            placeholder="0000"
            (keyup.enter)="onVerify()" />
        </ng-container>
        <p class="error" *ngIf="errorMsg">{{ errorMsg }}</p>
        <p class="success" *ngIf="infoMsg">{{ infoMsg }}</p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn-secondary" (click)="onCancel()" [disabled]="isSending || isVerifying">
          Hủy
        </button>
        <button
          type="button"
          class="btn-secondary"
          *ngIf="step === 2"
          (click)="step = 1; otpCode = ''; errorMsg = ''"
          [disabled]="isSending || isVerifying">
          Đổi ID
        </button>
        <button
          type="button"
          class="btn-primary"
          *ngIf="step === 1"
          (click)="onSendOtp()"
          [disabled]="isSending || !employeeId.trim()">
          {{ isSending ? 'Đang gửi…' : 'Gửi mã Zalo' }}
        </button>
        <button
          type="button"
          class="btn-primary"
          *ngIf="step === 2"
          (click)="onVerify()"
          [disabled]="isVerifying || otpCode.trim().length !== 4">
          {{ isVerifying ? 'Đang xác nhận…' : 'Xác nhận' }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .unlock-dialog {
        width: 380px;
        max-width: 95vw;
      }
      .dialog-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 20px 20px 8px;
      }
      .dialog-header .material-icons {
        font-size: 28px;
        color: #1976d2;
      }
      .dialog-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
      }
      .dialog-content {
        padding: 8px 20px 12px;
      }
      .hint {
        margin: 0 0 12px;
        font-size: 13px;
        color: #475569;
        line-height: 1.45;
      }
      .field-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #334155;
        margin: 8px 0 4px;
      }
      .field-input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-size: 14px;
      }
      .otp-input {
        letter-spacing: 4px;
        text-align: center;
        font-weight: 700;
      }
      .error {
        color: #b91c1c;
        font-size: 13px;
        margin: 10px 0 0;
      }
      .success {
        color: #15803d;
        font-size: 13px;
        margin: 10px 0 0;
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px 20px;
      }
      .btn-primary,
      .btn-secondary {
        border: none;
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 13px;
        cursor: pointer;
      }
      .btn-primary {
        background: #1976d2;
        color: #fff;
      }
      .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .btn-secondary {
        background: #e2e8f0;
        color: #0f172a;
      }
    `
  ]
})
export class LocationUnlockDialogComponent {
  employeeId = '';
  otpCode = '';
  step = 1;
  isSending = false;
  isVerifying = false;
  errorMsg = '';
  infoMsg = '';

  constructor(
    private dialogRef: MatDialogRef<LocationUnlockDialogComponent, boolean>,
    private locationUnlock: LocationUnlockService
  ) {}

  onCancel(): void {
    this.dialogRef.close(false);
  }

  async onSendOtp(): Promise<void> {
    this.errorMsg = '';
    this.infoMsg = '';
    const id = this.employeeId.trim().toUpperCase();
    if (!id) {
      this.errorMsg = 'Vui lòng nhập mã nhân viên.';
      return;
    }
    if (!LocationUnlockService.ALLOWED_IDS.includes(id as (typeof LocationUnlockService.ALLOWED_IDS)[number])) {
      this.errorMsg = 'Mã nhân viên không được phép. Chỉ: ASP0106, ASP0119, ASP0538, ASP1761.';
      return;
    }
    this.isSending = true;
    try {
      await this.locationUnlock.requestOtp(id);
      this.employeeId = id;
      this.step = 2;
      this.infoMsg = `Đã gửi mã 4 số qua Zalo tới ${id}. Kiểm tra tin nhắn bot.`;
    } catch (e: unknown) {
      this.errorMsg = this.extractError(e);
    } finally {
      this.isSending = false;
    }
  }

  async onVerify(): Promise<void> {
    this.errorMsg = '';
    this.isVerifying = true;
    try {
      const ok = await this.locationUnlock.verifyOtp(this.employeeId, this.otpCode);
      if (ok) {
        this.dialogRef.close(true);
      } else {
        this.errorMsg = 'Mã OTP không đúng.';
      }
    } catch (e: unknown) {
      this.errorMsg = this.extractError(e);
    } finally {
      this.isVerifying = false;
    }
  }

  private extractError(e: unknown): string {
    const err = e as { message?: string; details?: string };
    return String(err?.message || err?.details || e || 'Có lỗi xảy ra.').replace(/^FirebaseError:\s*/i, '');
  }
}
