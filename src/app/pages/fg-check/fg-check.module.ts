import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FGCheckComponent } from './fg-check.component';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [
  { path: '', component: FGCheckComponent }
];

@NgModule({
  declarations: [
    FGCheckComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SharedModule
  ],
  exports: [
    FGCheckComponent
  ]
})
export class FGCheckModule { }

