import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { SafetyComponent } from './safety.component';

@NgModule({
  declarations: [
    SafetyComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: SafetyComponent }
    ])
  ],
  exports: [
    SafetyComponent
  ]
})
export class SafetyModule { }
