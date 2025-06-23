import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { AppRoutingModule } from './app.routing';
import { ComponentsModule } from './components/components.module';
import { AppComponent } from './app.component';
import { AdminLayoutComponent } from './layouts/admin-layout/admin-layout.component';
import { MatButtonModule } from '@angular/material/button';
import { MatRippleModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';

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
    MatButtonModule,
    MatRippleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    MatSnackBarModule
  ],
  declarations: [
    AppComponent,
    AdminLayoutComponent,
    // DocumentsComponent removed from here
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
