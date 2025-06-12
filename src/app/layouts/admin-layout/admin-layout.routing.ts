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
import { LogComponent } from '../../pages/log/log.component';

import { WorkOrderStatusComponent } from '../../pages/work-order-status/work-order-status.component';
import { InboundMaterialsComponent } from '../../pages/inbound-materials/inbound-materials.component';
import { OutboundMaterialsComponent } from '../../pages/outbound-materials/outbound-materials.component';
import { MaterialsInventoryComponent } from '../../pages/materials-inventory/materials-inventory.component';

export const AdminLayoutRoutes: Routes = [
  { path: 'dashboard',            component: DashboardComponent },
  { path: 'user-profile',         component: UserProfileComponent },
  { path: 'table-list',           component: TableListComponent },
  { path: 'typography',           component: TypographyComponent },
  { path: 'icons',                component: IconsComponent },
  { path: 'documents',            component: DocumentsComponent },
  { path: 'maps',                 component: MapsComponent },
  { path: 'transport-document',   component: NotificationsComponent },
  { path: 'log',                  component: LogComponent },
  { path: 'upgrade',              component: UpgradeComponent },

  // 4 chức năng materials
  { path: 'work-order-status',    component: WorkOrderStatusComponent },
  { path: 'inbound-materials',    component: InboundMaterialsComponent },
  { path: 'outbound-materials',   component: OutboundMaterialsComponent },
  { path: 'materials-inventory',  component: MaterialsInventoryComponent }
];
