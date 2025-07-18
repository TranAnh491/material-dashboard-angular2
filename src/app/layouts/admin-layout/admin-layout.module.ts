import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { AdminLayoutRoutes } from './admin-layout.routing';

// Import services
import { GoogleSheetService } from '../../services/google-sheet.service';

// Các component mặc định của admin layout
import { DashboardComponent } from '../../dashboard/dashboard.component';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { TableListComponent } from '../../table-list/table-list.component';
import { TypographyComponent } from '../../typography/typography.component';
import { IconsComponent } from '../../icons/icons.component';
import { MapsComponent } from '../../maps/maps.component';
import { NotificationsComponent } from '../../notifications/notifications.component';
import { UpgradeComponent } from '../../upgrade/upgrade.component';

// Angular Material modules
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatRippleModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatTableModule } from '@angular/material/table';
import { MatDialogModule } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { SharedModule } from '../../shared/shared.module';

// Các component materials mới
import { WorkOrderStatusComponent } from '../../pages/work-order-status/work-order-status.component';
import { InboundMaterialsComponent } from '../../pages/inbound-materials/inbound-materials.component';
import { OutboundMaterialsComponent } from '../../pages/outbound-materials/outbound-materials.component';
import { MaterialsInventoryComponent } from '../../pages/materials-inventory/materials-inventory.component';
import { EquipmentComponent } from '../../pages/equipment/equipment.component';
import { KpiReportsComponent } from '../../pages/kpi-reports/kpi-reports.component';
import { InboundFgsComponent } from '../../pages/inbound-fgs/inbound-fgs.component';
import { OutboundFgsComponent } from '../../pages/outbound-fgs/outbound-fgs.component';
import { ShipmentComponent } from '../../pages/shipment/shipment.component';
import { DocumentsComponent } from 'app/pages/documents/documents.component';
import { Layout3dComponent } from 'app/pages/layout-3d/layout-3d.component';
import { ShelfLifeComponent } from '../../pages/shelf-life/shelf-life.component';
import { UtilizationComponent } from '../../pages/utilization/utilization.component';
import { TemperatureKnowledgeTestComponent } from '../../pages/temperature-knowledge-test/temperature-knowledge-test.component';
import { SettingsComponent } from '../../pages/settings/settings.component';
import { PrintLabelComponent } from '../../pages/print-label/print-label.component';

@NgModule({
  imports: [
    CommonModule,
    RouterModule.forChild(AdminLayoutRoutes),
    FormsModule,
    HttpClientModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatRippleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatCheckboxModule,
    MatRadioModule,
    MatTableModule,
    MatDialogModule,
    MatChipsModule,
    DragDropModule,
    SharedModule
  ],
  declarations: [
    DashboardComponent,
    UserProfileComponent,
    TableListComponent,
    TypographyComponent,
    IconsComponent,
    MapsComponent,
    NotificationsComponent,
    UpgradeComponent,
    KpiReportsComponent,
    EquipmentComponent,
    InboundFgsComponent,
    OutboundFgsComponent,
    ShipmentComponent,
    WorkOrderStatusComponent,
    InboundMaterialsComponent,
    OutboundMaterialsComponent,
    MaterialsInventoryComponent,
    DocumentsComponent,
    Layout3dComponent,
    ShelfLifeComponent,
    UtilizationComponent,
    TemperatureKnowledgeTestComponent,
    SettingsComponent,
    PrintLabelComponent
  ],
  providers: [
    GoogleSheetService
  ]
})
export class AdminLayoutModule {}
// This module defines the admin layout for the application, including routing and component declarations.
// It imports necessary Angular modules and Material components, and declares the components used in the admin layout.