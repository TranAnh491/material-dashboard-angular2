import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { QCComponent } from './qc.component';

const routes: Routes = [{ path: '', component: QCComponent }];

@NgModule({
  declarations: [QCComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class QcPageModule {}
