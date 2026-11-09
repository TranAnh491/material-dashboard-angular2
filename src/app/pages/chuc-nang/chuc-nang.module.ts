import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { ChucNangComponent } from './chuc-nang.component';

const routes: Routes = [{ path: '', component: ChucNangComponent }];

@NgModule({
  declarations: [ChucNangComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class ChucNangModule {}
