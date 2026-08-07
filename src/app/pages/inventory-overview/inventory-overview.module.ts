import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';

import { InventoryOverviewComponent } from './inventory-overview.component';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [
  { path: '', component: InventoryOverviewComponent }
];

@NgModule({
  declarations: [
    InventoryOverviewComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
    AngularFireModule,
    AngularFirestoreModule,
    SharedModule
  ],
  exports: [
    InventoryOverviewComponent
  ]
})
export class InventoryOverviewModule { }
