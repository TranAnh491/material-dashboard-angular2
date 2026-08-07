import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { MaterialsComponent } from './materials.component';
import { SharedModule } from '../../shared/shared.module';
import { ComponentsModule } from '../../components/components.module';

const routes: Routes = [
  { path: '', component: MaterialsComponent }
];

@NgModule({
  declarations: [
    MaterialsComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
    SharedModule,
    ComponentsModule
  ]
})
export class MaterialsModule { }
