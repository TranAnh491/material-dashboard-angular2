import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LayoutWarehouseAsm3Component } from './layout-warehouse-asm3.component';

@NgModule({
  declarations: [LayoutWarehouseAsm3Component],
  imports: [
    CommonModule,
    RouterModule.forChild([
      { path: '', component: LayoutWarehouseAsm3Component }
    ])
  ]
})
export class LayoutWarehouseAsm3Module {}
