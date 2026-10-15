import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { ShipmentComponent } from './shipment.component';

const routes: Routes = [{ path: '', component: ShipmentComponent }];

@NgModule({
  declarations: [ShipmentComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class ShipmentModule {}
