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
import { InventoryOverviewASM2Component } from '../../pages/inventory-overview-asm2/inventory-overview-asm2.component';
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
import { QCComponent } from '../../pages/qc/qc.component';
import { WhSecurityComponent } from '../../pages/wh-security/wh-security.component';
import { MenuComponent } from '../../pages/menu/menu.component';
import { Rm1DeliveryComponent } from '../../pages/rm1-delivery/rm1-delivery.component';
import { AuthGuard } from '../../guards/auth.guard';
import { SettingsGuard } from '../../guards/settings.guard';
import { TabPermissionGuard } from '../../guards/tab-permission.guard';

export const AdminLayoutRoutes: Routes = [
  { 
    path: '', 
    redirectTo: 'menu', 
    pathMatch: 'full',
    canActivate: [AuthGuard, TabPermissionGuard]
  },
  { path: 'menu',                 component: MenuComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'dashboard',            component: DashboardComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'materials-asm1',       component: MaterialsASM1Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'materials-asm2',       component: MaterialsASM2Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'inventory-overview-asm1', component: InventoryOverviewASM1Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'inventory-overview-asm2', component: InventoryOverviewASM2Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'inbound-asm1',         component: InboundASM1Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'inbound-asm2',         component: InboundASM2Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'outbound-asm1',        component: OutboundASM1Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'outbound-asm2',        component: OutboundASM2Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'warehouse-loading',    loadChildren: () => import('../../pages/warehouse-loading/warehouse-loading.module').then(m => m.WarehouseLoadingModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'trace-back',           loadChildren: () => import('../../pages/trace-back/trace-back.module').then(m => m.TraceBackModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'location',             loadChildren: () => import('../../pages/location/location.module').then(m => m.LocationModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-in',                loadChildren: () => import('../../pages/fg-in/fg-in.module').then(m => m.FgInModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-out',               loadChildren: () => import('../../pages/fg-out/fg-out.module').then(m => m.FgOutModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-preparing',         loadChildren: () => import('../../pages/fg-preparing/fg-preparing.module').then(m => m.FGPreparingModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-inventory',         loadChildren: () => import('../../pages/fg-inventory/fg-inventory.module').then(m => m.FGInventoryModule), canActivate: [AuthGuard, TabPermissionGuard] },

  { path: 'checklist',            component: DocumentsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'safety',               loadChildren: () => import('../../pages/safety/safety.module').then(m => m.SafetyModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'equipment',            component: EquipmentComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'label',                component: PrintLabelComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'find-rm1',            component: FindRm1Component, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'index',                component: IndexComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'documents',            component: DocumentsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'kpi-reports',          component: KpiReportsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'work-order-status',    component: WorkOrderStatusComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'shipment',             component: ShipmentComponent, canActivate: [AuthGuard, TabPermissionGuard] },


  { path: 'stock-check',          component: StockCheckComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'manage',               component: ManageComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'qc',                   component: QCComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'rm1-delivery',         component: Rm1DeliveryComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'wh-security',          component: WhSecurityComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'utilization',          component: UtilizationComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'inbound-fgs',          component: InboundFgsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'outbound-fgs',         component: OutboundFgsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'settings',             component: SettingsComponent, canActivate: [AuthGuard, SettingsGuard, TabPermissionGuard] }
];
