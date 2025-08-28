import { Routes } from '@angular/router';

import { DashboardComponent } from '../../dashboard/dashboard.component';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { TableListComponent } from '../../table-list/table-list.component';
import { TypographyComponent } from '../../typography/typography.component';
import { IconsComponent } from '../../icons/icons.component';
import { MapsComponent } from '../../maps/maps.component';
import { NotificationsComponent } from '../../notifications/notifications.component';
import { UpgradeComponent } from '../../upgrade/upgrade.component';
import { DocumentsComponent } from 'app/pages/documents/documents.component';
import { Layout3dComponent } from 'app/pages/layout-3d/layout-3d.component';

import { KpiReportsComponent } from '../../pages/kpi-reports/kpi-reports.component';
import { EquipmentComponent } from '../../pages/equipment/equipment.component';
import { InboundFgsComponent } from '../../pages/inbound-fgs/inbound-fgs.component';
import { OutboundFgsComponent } from '../../pages/outbound-fgs/outbound-fgs.component';
import { ShipmentComponent } from '../../pages/shipment/shipment.component';

import { WorkOrderStatusComponent } from '../../pages/work-order-status/work-order-status.component';
import { InboundMaterialsComponent } from '../../pages/inbound-materials/inbound-materials.component';
import { OutboundMaterialsComponent } from '../../pages/outbound-materials/outbound-materials.component';

import { MaterialsASM1Component } from '../../pages/materials-asm1/materials-asm1.component';
import { MaterialsASM2Component } from '../../pages/materials-asm2/materials-asm2.component';
import { InventoryOverviewASM1Component } from '../../pages/inventory-overview-asm1/inventory-overview-asm1.component';
import { InboundASM1Component } from '../../pages/inbound-asm1/inbound-asm1.component';
import { InboundASM2Component } from '../../pages/inbound-asm2/inbound-asm2.component';
import { OutboundASM1Component } from '../../pages/outbound-asm1/outbound-asm1.component';
import { OutboundASM2Component } from '../../pages/outbound-asm2/outbound-asm2.component';

import { UtilizationComponent } from '../../pages/utilization/utilization.component';
import { TemperatureKnowledgeTestComponent } from '../../pages/temperature-knowledge-test/temperature-knowledge-test.component';
import { MaterialsTestComponent } from '../../pages/materials-test/materials-test.component';
import { FinishedGoodsTestComponent } from '../../pages/finished-goods-test/finished-goods-test.component';
import { FgInComponent } from '../../pages/fg-in/fg-in.component';
import { FgOutComponent } from '../../pages/fg-out/fg-out.component';
import { FgInventoryComponent } from '../../pages/fg-inventory/fg-inventory.component';
import { SettingsComponent } from '../../pages/settings/settings.component';
import { PrintLabelComponent } from '../../pages/print-label/print-label.component';
import { IndexComponent } from '../../pages/index/index.component';
import { AuthGuard } from '../../guards/auth.guard';
import { SettingsGuard } from '../../guards/settings.guard';
import { ManageInventoryComponent } from '../../pages/manage-inventory/manage-inventory.component';

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
  { path: 'fg-in',                component: FgInComponent, canActivate: [AuthGuard] },
  { path: 'fg-out',               component: FgOutComponent, canActivate: [AuthGuard] },
  { path: 'fg-inventory',         component: FgInventoryComponent, canActivate: [AuthGuard] },

  { path: 'find',                 component: MapsComponent, canActivate: [AuthGuard] },
  { path: 'layout',               component: Layout3dComponent, canActivate: [AuthGuard] },
  { path: 'checklist',            component: DocumentsComponent, canActivate: [AuthGuard] },
  { path: 'safety',               loadChildren: () => import('../../pages/safety/safety.module').then(m => m.SafetyModule), canActivate: [AuthGuard] },
  { path: 'equipment',            component: EquipmentComponent, canActivate: [AuthGuard] },
  { path: 'label',                component: PrintLabelComponent, canActivate: [AuthGuard] },
  { path: 'index',                component: IndexComponent, canActivate: [AuthGuard] },
  { path: 'user-profile',         component: UserProfileComponent, canActivate: [AuthGuard] },
  { path: 'table-list',           component: TableListComponent, canActivate: [AuthGuard] },
  { path: 'typography',           component: TypographyComponent, canActivate: [AuthGuard] },
  { path: 'icons',                component: IconsComponent, canActivate: [AuthGuard] },
  { path: 'documents',            component: DocumentsComponent, canActivate: [AuthGuard] },
  { path: 'maps',                 component: MapsComponent, canActivate: [AuthGuard] },
  { path: 'notifications',        component: NotificationsComponent, canActivate: [AuthGuard] },
  { path: 'kpi-reports',          component: KpiReportsComponent, canActivate: [AuthGuard] },
  { path: 'work-order-status',    component: WorkOrderStatusComponent, canActivate: [AuthGuard] },
  { path: 'shipment',             component: ShipmentComponent, canActivate: [AuthGuard] },
  { path: 'inbound-materials',    component: InboundMaterialsComponent, canActivate: [AuthGuard] },
  { path: 'outbound-materials',   component: OutboundMaterialsComponent, canActivate: [AuthGuard] },
  { path: 'manage-inventory',     component: ManageInventoryComponent, canActivate: [AuthGuard] },


  { path: 'utilization',          component: UtilizationComponent, canActivate: [AuthGuard] },
  { path: 'inbound-fgs',          component: InboundFgsComponent, canActivate: [AuthGuard] },
  { path: 'outbound-fgs',         component: OutboundFgsComponent, canActivate: [AuthGuard] },
  { path: 'upgrade',              component: UpgradeComponent, canActivate: [AuthGuard] },
  { path: 'layout-3d',            component: Layout3dComponent, canActivate: [AuthGuard] },
  { path: 'temperature-knowledge-test', component: TemperatureKnowledgeTestComponent, canActivate: [AuthGuard] },
  { path: 'materials-test',       component: MaterialsTestComponent, canActivate: [AuthGuard] },
  { path: 'finished-goods-test',  component: FinishedGoodsTestComponent, canActivate: [AuthGuard] },
  { path: 'task',                 loadChildren: () => import('../../pages/task/task.module').then(m => m.TaskModule), canActivate: [AuthGuard] },
  { path: 'settings',             component: SettingsComponent, canActivate: [AuthGuard, SettingsGuard] }
];
