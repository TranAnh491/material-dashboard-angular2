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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';

// Firebase imports
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { environment } from '../environments/environment';

// Components
import { LoginComponent } from './pages/login/login.component';
import { FindRm1Component } from './pages/find-rm1/find-rm1.component';
import { ManageComponent } from './pages/manage/manage.component';
import { QCComponent } from './pages/qc/qc.component';

// Pipes
import { SanitizeHtmlPipe } from './pipes/sanitize-html.pipe';

// Có thể giữ các import dưới đây nếu dùng trong routes hoặc chỗ khác,
// nhưng KHÔNG đưa vào declarations!
// import { WorkOrderStatusComponent } from './pages/work-order-status/work-order-status.component';
// import { InboundMaterialsComponent } from './pages/inbound-materials/inbound-materials.component';
// import { OutboundMaterialsComponent } from './pages/outbound-materials/outbound-materials.component';


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
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatSlideToggleModule,
    MatDialogModule,
    MatProgressBarModule,
    AngularFireModule.initializeApp(environment.firebase),
    AngularFirestoreModule,
    AngularFireAuthModule
  ],
  declarations: [
    AppComponent,
    AdminLayoutComponent,
    LoginComponent,
    FindRm1Component,
    ManageComponent,
    QCComponent,
    SanitizeHtmlPipe,
    // DocumentsComponent removed from here
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
