import { Routes } from '@angular/router';

import { DashboardComponent } from '../../dashboard/dashboard.component';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { TableListComponent } from '../../table-list/table-list.component';
import { TypographyComponent } from '../../typography/typography.component';
import { IconsComponent } from '../../icons/icons.component';
import { MapsComponent } from '../../maps/maps.component';
import { NotificationsComponent } from '../../notifications/notifications.component';
import { UpgradeComponent } from '../../upgrade/upgrade.component';
import { DocumentsComponent } from '../../pages/documents/documents.component';

import { KpiReportsComponent } from '../../pages/kpi-reports/kpi-reports.component';
import { EquipmentComponent } from '../../pages/equipment/equipment.component';
import { InboundFgsComponent } from '../../pages/inbound-fgs/inbound-fgs.component';
import { OutboundFgsComponent } from '../../pages/outbound-fgs/outbound-fgs.component';
import { ShipmentComponent } from '../../pages/shipment/shipment.component';

import { WorkOrderStatusComponent } from '../../pages/work-order-status/work-order-status.component';
import { InboundMaterialsComponent } from '../../pages/inbound-materials/inbound-materials.component';
import { OutboundMaterialsComponent } from '../../pages/outbound-materials/outbound-materials.component';
import { MaterialsInventoryComponent } from '../../pages/materials-inventory/materials-inventory.component';
import { Layout3dComponent } from 'app/pages/layout-3d/layout-3d.component';

export const AdminLayoutRoutes: Routes = [
  { path: 'dashboard',            component: DashboardComponent },
  { path: 'user-profile',         component: UserProfileComponent },
  { path: 'table-list',           component: TableListComponent },
  { path: 'typography',           component: TypographyComponent },
  { path: 'icons',                component: IconsComponent },
  { path: 'documents',            component: DocumentsComponent },
  { path: 'maps',                 component: MapsComponent },
  { path: 'notifications',        component: NotificationsComponent },
  { path: 'kpi-reports',        component: KpiReportsComponent },
  { path: 'equipment',            component: EquipmentComponent },
  { path: 'work-order-status',    component: WorkOrderStatusComponent },
  { path: 'shipment',             component: ShipmentComponent },
  { path: 'inbound-materials',    component: InboundMaterialsComponent },
  { path: 'outbound-materials',   component: OutboundMaterialsComponent },
  { path: 'materials-inventory',  component: MaterialsInventoryComponent },
  { path: 'inbound-fgs',          component: InboundFgsComponent },
  { path: 'outbound-fgs',         component: OutboundFgsComponent },
  { path: 'upgrade',              component: UpgradeComponent },
  { path: 'layout-3d',            component: Layout3dComponent },
];
