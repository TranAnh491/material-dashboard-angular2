import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { AppRoutingModule } from './app.routing';
import { ComponentsModule } from './components/components.module';
import { AppComponent } from './app.component';
import { AdminLayoutComponent } from './layouts/admin-layout/admin-layout.component';
import { LayoutComponent } from './layout/layout.component';

// Có thể giữ các import dưới đây nếu dùng trong routes hoặc chỗ khác,
// nhưng KHÔNG đưa vào declarations!
// import { WorkOrderStatusComponent } from './pages/work-order-status/work-order-status.component';
// import { InboundMaterialsComponent } from './pages/inbound-materials/inbound-materials.component';
// import { OutboundMaterialsComponent } from './pages/outbound-materials/outbound-materials.component';
// import { MaterialsInventoryComponent } from './pages/materials-inventory/materials-inventory.component';

@NgModule({
  imports: [
    BrowserAnimationsModule,
    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    ComponentsModule,
    RouterModule,
    AppRoutingModule,
  ],
  declarations: [
    AppComponent,
    AdminLayoutComponent,
    LayoutComponent,
    // KHÔNG khai báo 4 component materials ở đây!
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
