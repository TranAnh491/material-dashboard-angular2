import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { JWarehouseComponent } from './j-warehouse.component';
import { JWarehouseRack3dComponent } from './j-warehouse-rack-3d.component';

@NgModule({
  declarations: [JWarehouseComponent, JWarehouseRack3dComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: JWarehouseComponent }])
  ]
})
export class JWarehouseModule {}
