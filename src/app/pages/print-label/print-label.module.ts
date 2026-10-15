import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { PrintLabelComponent } from './print-label.component';

const routes: Routes = [{ path: '', component: PrintLabelComponent }];

@NgModule({
  declarations: [PrintLabelComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class PrintLabelModule {}
