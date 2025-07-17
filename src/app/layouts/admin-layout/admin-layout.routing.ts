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
import { MaterialsInventoryComponent } from '../../pages/materials-inventory/materials-inventory.component';
import { ShelfLifeComponent } from 'app/pages/shelf-life/shelf-life.component';
import { UtilizationComponent } from '../../pages/utilization/utilization.component';
import { TemperatureKnowledgeTestComponent } from '../../pages/temperature-knowledge-test/temperature-knowledge-test.component';
import { SettingsComponent } from '../../pages/settings/settings.component';

export const AdminLayoutRoutes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard',            component: DashboardComponent },
  { path: 'materials',            component: MaterialsInventoryComponent },
  { path: 'fg',                   component: TableListComponent },
  { path: 'bm',                   component: TypographyComponent },
  { path: 'find',                 component: MapsComponent },
  { path: 'layout',               component: Layout3dComponent },
  { path: 'checklist',            component: DocumentsComponent },
  { path: 'equipment',            component: EquipmentComponent },
  { path: 'user-profile',         component: UserProfileComponent },
  { path: 'table-list',           component: TableListComponent },
  { path: 'typography',           component: TypographyComponent },
  { path: 'icons',                component: IconsComponent },
  { path: 'documents',            component: DocumentsComponent },
  { path: 'maps',                 component: MapsComponent },
  { path: 'notifications',        component: NotificationsComponent },
  { path: 'kpi-reports',          component: KpiReportsComponent },
  { path: 'work-order-status',    component: WorkOrderStatusComponent },
  { path: 'shipment',             component: ShipmentComponent },
  { path: 'inbound-materials',    component: InboundMaterialsComponent },
  { path: 'outbound-materials',   component: OutboundMaterialsComponent },
  { path: 'materials-inventory',  component: MaterialsInventoryComponent },
  { path: 'shelf-life',           component: ShelfLifeComponent },
  { path: 'utilization',          component: UtilizationComponent },
  { path: 'inbound-fgs',          component: InboundFgsComponent },
  { path: 'outbound-fgs',         component: OutboundFgsComponent },
  { path: 'upgrade',              component: UpgradeComponent },
  { path: 'layout-3d',            component: Layout3dComponent },
  { path: 'temperature-knowledge-test', component: TemperatureKnowledgeTestComponent },
  { path: 'task',                 loadChildren: () => import('../../pages/task/task.module').then(m => m.TaskModule) },
  { path: 'settings',             component: SettingsComponent }
];
