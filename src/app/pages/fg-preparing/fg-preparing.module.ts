import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FGPreparingComponent } from './fg-preparing.component';

const routes: Routes = [
  { path: '', component: FGPreparingComponent }
];

@NgModule({
  declarations: [
    FGPreparingComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ],
  exports: [
    FGPreparingComponent
  ]
})
export class FGPreparingModule { }
