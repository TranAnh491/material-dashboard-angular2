import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { LayoutWarehouseComponent } from './layout-warehouse.component';
import { LayoutWarehouseRack3dComponent } from './layout-warehouse-rack-3d.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  declarations: [LayoutWarehouseComponent, LayoutWarehouseRack3dComponent],
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    AngularFirestoreModule,
    AngularFireAuthModule,
    RouterModule.forChild([
      { path: '', component: LayoutWarehouseComponent }
    ]),
    SharedModule
  ]
})
export class LayoutWarehouseModule {}
