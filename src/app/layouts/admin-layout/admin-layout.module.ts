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
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatDialogModule } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SharedModule } from '../../shared/shared.module';
import { InventoryOverviewASM1Module } from '../../pages/inventory-overview-asm1/inventory-overview-asm1.module';

// Các component materials mới
import { WorkOrderStatusComponent } from '../../pages/work-order-status/work-order-status.component';

import { MaterialsASM1Component } from '../../pages/materials-asm1/materials-asm1.component';
import { MaterialsASM2Component } from '../../pages/materials-asm2/materials-asm2.component';
import { InboundASM1Component } from '../../pages/inbound-asm1/inbound-asm1.component';
import { InboundASM2Component } from '../../pages/inbound-asm2/inbound-asm2.component';
import { OutboundASM1Component } from '../../pages/outbound-asm1/outbound-asm1.component';
import { OutboundASM2Component } from '../../pages/outbound-asm2/outbound-asm2.component';
import { EquipmentComponent } from '../../pages/equipment/equipment.component';
import { KpiReportsComponent } from '../../pages/kpi-reports/kpi-reports.component';
import { InboundFgsComponent } from '../../pages/inbound-fgs/inbound-fgs.component';
import { OutboundFgsComponent } from '../../pages/outbound-fgs/outbound-fgs.component';
import { ShipmentComponent } from '../../pages/shipment/shipment.component';
import { DocumentsComponent } from 'app/pages/documents/documents.component';
import { Layout3dComponent } from 'app/pages/layout-3d/layout-3d.component';
import { UtilizationComponent } from '../../pages/utilization/utilization.component';
import { SettingsComponent } from '../../pages/settings/settings.component';
import { PrintLabelComponent } from '../../pages/print-label/print-label.component';
import { IndexComponent } from '../../pages/index/index.component';
import { SettingsGuard } from '../../guards/settings.guard';

import { ChartComponent } from '../../pages/chart/chart.component';

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
    MatPaginatorModule,
    MatSortModule,
    MatDialogModule,
    MatChipsModule,
    MatSlideToggleModule,
    DragDropModule,
    SharedModule,
    InventoryOverviewASM1Module
  ],
  declarations: [
    DashboardComponent,
    KpiReportsComponent,
    EquipmentComponent,
    InboundFgsComponent,
    OutboundFgsComponent,
    ShipmentComponent,
    WorkOrderStatusComponent,

    MaterialsASM1Component,
    MaterialsASM2Component,
    InboundASM1Component,
    InboundASM2Component,
    OutboundASM1Component,
    OutboundASM2Component,
    DocumentsComponent,
    Layout3dComponent,
    UtilizationComponent,
    SettingsComponent,
    PrintLabelComponent,
    IndexComponent,

    ChartComponent
  ],
  providers: [
    GoogleSheetService,
    SettingsGuard
  ]
})
export class AdminLayoutModule {}
// This module defines the admin layout for the application, including routing and component declarations.
// It imports necessary Angular modules and Material components, and declares the components used in the admin layout.