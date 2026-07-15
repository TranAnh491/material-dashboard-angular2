import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { FgLocationComponent } from './fg-location.component';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [
  { path: '', component: FgLocationComponent }
];

@NgModule({
  declarations: [
    FgLocationComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
    SharedModule
  ],
  exports: [
    FgLocationComponent
  ]
})
export class FgLocationModule { }
