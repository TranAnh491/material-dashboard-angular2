import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { OutboundComponent } from './outbound.component';
import { SharedModule } from '../../shared/shared.module';
import { ComponentsModule } from '../../components/components.module';

const routes: Routes = [
  { path: '', component: OutboundComponent }
];

@NgModule({
  declarations: [
    OutboundComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
    SharedModule,
    ComponentsModule
  ]
})
export class OutboundModule { }
