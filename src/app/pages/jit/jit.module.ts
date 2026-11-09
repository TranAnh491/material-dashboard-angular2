import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { QrScannerModule } from '../../components/qr-scanner-modal/qr-scanner.module';
import { RouterModule, Routes } from '@angular/router';
import { JitComponent } from './jit.component';

const routes: Routes = [{ path: '', component: JitComponent }];

@NgModule({
  declarations: [JitComponent],
  imports: [CommonModule, FormsModule, MatDialogModule, QrScannerModule, RouterModule.forChild(routes)]
})
export class JitModule {}
