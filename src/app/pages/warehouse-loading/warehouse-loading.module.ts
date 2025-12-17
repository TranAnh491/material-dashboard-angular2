import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { WarehouseLoadingComponent } from './warehouse-loading.component';

@NgModule({
  declarations: [
    WarehouseLoadingComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      {
        path: '',
        component: WarehouseLoadingComponent
      }
    ])
  ]
})
export class WarehouseLoadingModule { }

