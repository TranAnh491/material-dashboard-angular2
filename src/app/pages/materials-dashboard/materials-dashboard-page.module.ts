import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { MaterialsDashboardComponent } from './materials-dashboard.component';

const routes: Routes = [{ path: '', component: MaterialsDashboardComponent }];

@NgModule({
  declarations: [MaterialsDashboardComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class MaterialsDashboardPageModule {}
