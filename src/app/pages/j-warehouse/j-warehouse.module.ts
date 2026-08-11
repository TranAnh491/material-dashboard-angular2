import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { JWarehouseComponent } from './j-warehouse.component';

@NgModule({
  declarations: [JWarehouseComponent],
  imports: [
    CommonModule,
    RouterModule.forChild([{ path: '', component: JWarehouseComponent }])
  ]
})
export class JWarehouseModule {}
