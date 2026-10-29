import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { AgingReportComponent } from './aging-report.component';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [{ path: '', component: AgingReportComponent }];

@NgModule({
  declarations: [AgingReportComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes), SharedModule]
})
export class AgingReportModule {}
