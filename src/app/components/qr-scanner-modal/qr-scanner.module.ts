import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QRScannerModalComponent } from './qr-scanner-modal.component';

/**
 * Module riêng cho QRScannerModalComponent — tách khỏi ComponentsModule (Navbar/Sidebar...) để
 * dùng được ở cả app chính lẫn app Xe Tải độc lập (bundle nhỏ, không cần layout admin).
 */
@NgModule({
  declarations: [QRScannerModalComponent],
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatProgressSpinnerModule],
  exports: [QRScannerModalComponent]
})
export class QrScannerModule {}
