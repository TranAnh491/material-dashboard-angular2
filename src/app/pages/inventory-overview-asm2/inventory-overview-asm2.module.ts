import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';

import { InventoryOverviewASM2Component } from './inventory-overview-asm2.component';

@NgModule({
  declarations: [
    InventoryOverviewASM2Component
  ],
  imports: [
    CommonModule,
    FormsModule,
    AngularFireModule,
    AngularFirestoreModule
  ],
  exports: [
    InventoryOverviewASM2Component
  ]
})
export class InventoryOverviewASM2Module { }
