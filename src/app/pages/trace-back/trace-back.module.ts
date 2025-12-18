import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { TraceBackComponent } from './trace-back.component';

@NgModule({
  declarations: [
    TraceBackComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      {
        path: '',
        component: TraceBackComponent
      }
    ])
  ]
})
export class TraceBackModule { }

