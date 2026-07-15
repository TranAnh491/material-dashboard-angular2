import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';

import { InventoryOverviewASM2Component } from './inventory-overview-asm2.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  declarations: [
    InventoryOverviewASM2Component
  ],
  imports: [
    CommonModule,
    FormsModule,
    AngularFireModule,
    AngularFirestoreModule,
    SharedModule
  ],
  exports: [
    InventoryOverviewASM2Component
  ]
})
export class InventoryOverviewASM2Module { }
