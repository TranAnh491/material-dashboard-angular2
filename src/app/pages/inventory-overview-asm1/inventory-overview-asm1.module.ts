import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';

import { InventoryOverviewASM1Component } from './inventory-overview-asm1.component';

@NgModule({
  declarations: [
    InventoryOverviewASM1Component
  ],
  imports: [
    CommonModule,
    FormsModule,
    AngularFireModule,
    AngularFirestoreModule
  ],
  exports: [
    InventoryOverviewASM1Component
  ]
})
export class InventoryOverviewASM1Module { }
