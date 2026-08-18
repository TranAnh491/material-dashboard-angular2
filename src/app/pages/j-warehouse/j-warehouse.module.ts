import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { JWarehouseComponent } from './j-warehouse.component';

// JWarehouseRack3dComponent (standalone) KHÔNG khai báo ở đây — nó kéo theo three.js (~500KB+).
// Được tải động (import() theo yêu cầu, khi bấm nút 3D) trong j-warehouse.component.ts, để mở
// trang J Warehouse (2D) không phải tải three.js ngay từ đầu.
@NgModule({
  declarations: [JWarehouseComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: JWarehouseComponent }])
  ]
})
export class JWarehouseModule {}
