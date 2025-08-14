import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { FooterComponent } from './footer/footer.component';
import { NavbarComponent } from './navbar/navbar.component';
import { SidebarComponent } from './sidebar/sidebar.component';
import { DeleteConfirmationDialogComponent } from './delete-confirmation-dialog/delete-confirmation-dialog.component';
import { NotificationDropdownComponent } from './notification-dropdown/notification-dropdown.component';
import { ImportProgressDialogComponent } from './import-progress-dialog/import-progress-dialog.component';
import { QRScannerModalComponent } from './qr-scanner-modal/qr-scanner-modal.component';

@NgModule({
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatProgressBarModule
  ],
  declarations: [
    FooterComponent,
    NavbarComponent,
    SidebarComponent,
    DeleteConfirmationDialogComponent,
    NotificationDropdownComponent,
    ImportProgressDialogComponent,
    QRScannerModalComponent
  ],
  exports: [
    FooterComponent,
    NavbarComponent,
    SidebarComponent,
    DeleteConfirmationDialogComponent,
    NotificationDropdownComponent,
    ImportProgressDialogComponent,
    QRScannerModalComponent
  ]
})
export class ComponentsModule { }
