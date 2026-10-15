import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { QcTraceabilityComponent } from './qc-traceability.component';

const routes: Routes = [{ path: '', component: QcTraceabilityComponent }];

@NgModule({
  declarations: [QcTraceabilityComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class QcTraceabilityModule {}
