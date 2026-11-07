import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { KkViTriComponent } from './kk-vi-tri.component';

const routes: Routes = [{ path: '', component: KkViTriComponent }];

@NgModule({
  declarations: [KkViTriComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class KkViTriModule {}
