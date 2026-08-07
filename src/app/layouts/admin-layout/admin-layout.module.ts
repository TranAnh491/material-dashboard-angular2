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
import { MenuComponent } from '../../pages/menu/menu.component';
import { MaterialsDashboardComponent } from '../../pages/materials-dashboard/materials-dashboard.component';
import { FgsDashboardComponent } from '../../pages/fgs-dashboard/fgs-dashboard.component';

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
import { MatMenuModule } from '@angular/material/menu';
import { SharedModule } from '../../shared/shared.module';
import { ComponentsModule } from '../../components/components.module';

// Các component materials mới
import { WorkOrderStatusComponent } from '../../pages/work-order-status/work-order-status.component';

import { EquipmentComponent } from '../../pages/equipment/equipment.component';
import { WarehouseManualComponent } from '../../pages/equipment/warehouse-manual.component';
import { WarehouseTrainingQuizComponent } from '../../pages/equipment/warehouse-training-quiz.component';
import { KpiReportsComponent } from '../../pages/kpi-reports/kpi-reports.component';
import { InboundFgsComponent } from '../../pages/inbound-fgs/inbound-fgs.component';
import { OutboundFgsComponent } from '../../pages/outbound-fgs/outbound-fgs.component';
import { ShipmentComponent } from '../../pages/shipment/shipment.component';
import { DocumentsComponent } from 'app/pages/documents/documents.component';
import { StockCheckComponent } from '../../pages/stock-check/stock-check.component';
import { SettingsComponent } from '../../pages/settings/settings.component';
import { PrintLabelComponent } from '../../pages/print-label/print-label.component';
import { IndexComponent } from '../../pages/index/index.component';
import { SxxkComponent } from '../../pages/sxxk/sxxk.component';
import { ScrapComponent } from '../../pages/scrap/scrap.component';
import { QCComponent } from '../../pages/qc/qc.component';
import { QcTraceabilityComponent } from '../../pages/qc/qc-traceability.component';
import { Rm1DeliveryComponent } from '../../pages/rm1-delivery/rm1-delivery.component';
import { ShortedMaterialsComponent } from '../../pages/shorted-materials/shorted-materials.component';
import { ReportComponent } from '../../pages/report/report.component';
import { BagHistoryComponent } from '../../pages/bag-history/bag-history.component';
import { SettingsGuard } from '../../guards/settings.guard';
import { PrintOptionDialogComponent } from '../../components/print-option-dialog/print-option-dialog.component';
import { LocationUnlockDialogComponent } from '../../components/location-unlock-dialog/location-unlock-dialog.component';

import { ChartComponent } from '../../pages/chart/chart.component';
import { ZaloComponent } from '../../pages/zalo/zalo.component';
import { NhietDoComponent } from '../../pages/nhiet-do/nhiet-do.component';
import { DanhMucNvlTpComponent } from '../../pages/danh-muc-nvl-tp/danh-muc-nvl-tp.component';
import { TruckScheduleSharedModule } from '../../pages/truck-schedule/truck-schedule-shared.module';

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
    MatMenuModule,
    DragDropModule,
    SharedModule,
    ComponentsModule,
    TruckScheduleSharedModule
  ],
  declarations: [
    DashboardComponent,
    MenuComponent,
    MaterialsDashboardComponent,
    FgsDashboardComponent,
    KpiReportsComponent,
    EquipmentComponent,
    WarehouseManualComponent,
    WarehouseTrainingQuizComponent,
    InboundFgsComponent,
    OutboundFgsComponent,
    ShipmentComponent,
    WorkOrderStatusComponent,

    DocumentsComponent,
    StockCheckComponent,
    SettingsComponent,
    PrintLabelComponent,
    IndexComponent,
    SxxkComponent,
    ScrapComponent,
    QCComponent,
    QcTraceabilityComponent,
    Rm1DeliveryComponent,
    ShortedMaterialsComponent,
    ReportComponent,
    BagHistoryComponent,
    PrintOptionDialogComponent,
    LocationUnlockDialogComponent,

    ChartComponent,
    ZaloComponent,
    NhietDoComponent,
    DanhMucNvlTpComponent
  ],
  providers: [
    GoogleSheetService,
    SettingsGuard
  ]
})
export class AdminLayoutModule {}
// This module defines the admin layout for the application, including routing and component declarations.
// It imports necessary Angular modules and Material components, and declares the components used in the admin layout.