import { Routes } from '@angular/router';

import { DashboardComponent } from '../../dashboard/dashboard.component';
import { DocumentsComponent } from 'app/pages/documents/documents.component';

import { KpiReportsComponent } from '../../pages/kpi-reports/kpi-reports.component';
import { EquipmentComponent } from '../../pages/equipment/equipment.component';
import { InboundFgsComponent } from '../../pages/inbound-fgs/inbound-fgs.component';
import { OutboundFgsComponent } from '../../pages/outbound-fgs/outbound-fgs.component';
import { ShipmentComponent } from '../../pages/shipment/shipment.component';

import { WorkOrderStatusComponent } from '../../pages/work-order-status/work-order-status.component';

import { MaterialsASM1Component } from '../../pages/materials-asm1/materials-asm1.component';
import { MaterialsASM2Component } from '../../pages/materials-asm2/materials-asm2.component';
import { InventoryOverviewASM1Component } from '../../pages/inventory-overview-asm1/inventory-overview-asm1.component';
import { InboundASM1Component } from '../../pages/inbound-asm1/inbound-asm1.component';
import { InboundASM2Component } from '../../pages/inbound-asm2/inbound-asm2.component';
import { OutboundASM1Component } from '../../pages/outbound-asm1/outbound-asm1.component';
import { OutboundASM2Component } from '../../pages/outbound-asm2/outbound-asm2.component';

import { UtilizationComponent } from '../../pages/utilization/utilization.component';
import { StockCheckComponent } from '../../pages/stock-check/stock-check.component';

import { SettingsComponent } from '../../pages/settings/settings.component';
import { PrintLabelComponent } from '../../pages/print-label/print-label.component';
import { FindRm1Component } from '../../pages/find-rm1/find-rm1.component';
import { IndexComponent } from '../../pages/index/index.component';
import { ManageComponent } from '../../pages/manage/manage.component';
import { AuthGuard } from '../../guards/auth.guard';
import { SettingsGuard } from '../../guards/settings.guard';

export const AdminLayoutRoutes: Routes = [
  { 
    path: '', 
    redirectTo: 'dashboard', 
    pathMatch: 'full',
    canActivate: [AuthGuard]
  },
  { path: 'dashboard',            component: DashboardComponent, canActivate: [AuthGuard] },
  { path: 'materials-asm1',       component: MaterialsASM1Component, canActivate: [AuthGuard] },
  { path: 'materials-asm2',       component: MaterialsASM2Component, canActivate: [AuthGuard] },
  { path: 'inventory-overview-asm1', component: InventoryOverviewASM1Component, canActivate: [AuthGuard] },
  { path: 'inbound-asm1',         component: InboundASM1Component, canActivate: [AuthGuard] },
  { path: 'inbound-asm2',         component: InboundASM2Component, canActivate: [AuthGuard] },
  { path: 'outbound-asm1',        component: OutboundASM1Component, canActivate: [AuthGuard] },
  { path: 'outbound-asm2',        component: OutboundASM2Component, canActivate: [AuthGuard] },
  { path: 'location',             loadChildren: () => import('../../pages/location/location.module').then(m => m.LocationModule), canActivate: [AuthGuard] },
  { path: 'fg-in',                loadChildren: () => import('../../pages/fg-in/fg-in.module').then(m => m.FgInModule), canActivate: [AuthGuard] },
  { path: 'fg-out',               loadChildren: () => import('../../pages/fg-out/fg-out.module').then(m => m.FgOutModule), canActivate: [AuthGuard] },
  { path: 'fg-preparing',         loadChildren: () => import('../../pages/fg-preparing/fg-preparing.module').then(m => m.FGPreparingModule), canActivate: [AuthGuard] },
  { path: 'fg-inventory',         loadChildren: () => import('../../pages/fg-inventory/fg-inventory.module').then(m => m.FGInventoryModule), canActivate: [AuthGuard] },

  { path: 'checklist',            component: DocumentsComponent, canActivate: [AuthGuard] },
  { path: 'safety',               loadChildren: () => import('../../pages/safety/safety.module').then(m => m.SafetyModule), canActivate: [AuthGuard] },
  { path: 'equipment',            component: EquipmentComponent, canActivate: [AuthGuard] },
  { path: 'label',                component: PrintLabelComponent, canActivate: [AuthGuard] },
  { path: 'find-rm1',            component: FindRm1Component, canActivate: [AuthGuard] },
  { path: 'index',                component: IndexComponent, canActivate: [AuthGuard] },
  { path: 'documents',            component: DocumentsComponent, canActivate: [AuthGuard] },
  { path: 'kpi-reports',          component: KpiReportsComponent, canActivate: [AuthGuard] },
  { path: 'work-order-status',    component: WorkOrderStatusComponent, canActivate: [AuthGuard] },
  { path: 'shipment',             component: ShipmentComponent, canActivate: [AuthGuard] },


  { path: 'stock-check',          component: StockCheckComponent, canActivate: [AuthGuard] },
  { path: 'manage',               component: ManageComponent, canActivate: [AuthGuard] },
  { path: 'utilization',          component: UtilizationComponent, canActivate: [AuthGuard] },
  { path: 'inbound-fgs',          component: InboundFgsComponent, canActivate: [AuthGuard] },
  { path: 'outbound-fgs',         component: OutboundFgsComponent, canActivate: [AuthGuard] },
  { path: 'settings',             component: SettingsComponent, canActivate: [AuthGuard, SettingsGuard] }
];
