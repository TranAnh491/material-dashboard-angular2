import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { LayoutWarehouseComponent } from './layout-warehouse.component';

@NgModule({
  declarations: [LayoutWarehouseComponent],
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    AngularFirestoreModule,
    AngularFireAuthModule,
    RouterModule.forChild([
      { path: '', component: LayoutWarehouseComponent }
    ])
  ]
})
export class LayoutWarehouseModule {}
