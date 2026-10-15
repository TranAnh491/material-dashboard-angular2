import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../layouts/admin-layout/admin-page-common.module';
import { DashboardComponent } from './dashboard.component';

const routes: Routes = [{ path: '', component: DashboardComponent }];

@NgModule({
  declarations: [DashboardComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class DashboardPageModule {}
