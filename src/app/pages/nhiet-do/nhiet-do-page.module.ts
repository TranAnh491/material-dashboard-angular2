import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { NhietDoComponent } from './nhiet-do.component';

const routes: Routes = [{ path: '', component: NhietDoComponent }];

@NgModule({
  declarations: [NhietDoComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class NhietDoPageModule {}
