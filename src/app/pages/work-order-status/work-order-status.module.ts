import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { WorkOrderStatusComponent } from './work-order-status.component';

const routes: Routes = [{ path: '', component: WorkOrderStatusComponent }];

@NgModule({
  declarations: [WorkOrderStatusComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class WorkOrderStatusModule {}
