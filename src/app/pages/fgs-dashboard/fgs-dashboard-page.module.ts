import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { FgsDashboardComponent } from './fgs-dashboard.component';

const routes: Routes = [{ path: '', component: FgsDashboardComponent }];

@NgModule({
  declarations: [FgsDashboardComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class FgsDashboardPageModule {}
