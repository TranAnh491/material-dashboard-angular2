import { Routes } from '@angular/router';


import { KpiReportsComponent } from '../../pages/kpi-reports/kpi-reports.component';
import { InboundFgsComponent } from '../../pages/inbound-fgs/inbound-fgs.component';
import { OutboundFgsComponent } from '../../pages/outbound-fgs/outbound-fgs.component';



import { StockCheckComponent } from '../../pages/stock-check/stock-check.component';

import { IndexComponent } from '../../pages/index/index.component';
import { SxxkComponent } from '../../pages/sxxk/sxxk.component';
import { ScrapComponent } from '../../pages/scrap/scrap.component';
import { MenuComponent } from '../../pages/menu/menu.component';
import { AccountComponent } from '../../pages/account/account.component';
import { Rm1DeliveryComponent } from '../../pages/rm1-delivery/rm1-delivery.component';
import { ShortedMaterialsComponent } from '../../pages/shorted-materials/shorted-materials.component';
import { ReportComponent } from '../../pages/report/report.component';
import { BagHistoryComponent } from '../../pages/bag-history/bag-history.component';
import { ZaloComponent } from '../../pages/zalo/zalo.component';
import { EquipmentChecklistComponent } from '../../pages/equipment-checklist/equipment-checklist.component';
import { TruckScheduleComponent } from '../../pages/truck-schedule/truck-schedule.component';
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
  { path: 'tai-khoan',            component: AccountComponent, canActivate: [AuthGuard] },
  { path: 'dashboard',            loadChildren: () => import('../../dashboard/dashboard-page.module').then(m => m.DashboardPageModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'materials-dashboard',  loadChildren: () => import('../../pages/materials-dashboard/materials-dashboard-page.module').then(m => m.MaterialsDashboardPageModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'lich-lam-viec',        loadChildren: () => import('../../pages/work-schedule/work-schedule.module').then(m => m.WorkScheduleModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fgs-dashboard',          loadChildren: () => import('../../pages/fgs-dashboard/fgs-dashboard-page.module').then(m => m.FgsDashboardPageModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'materials',            loadChildren: () => import('../../pages/materials/materials.module').then(m => m.MaterialsModule), canActivate: [AuthGuard, TabPermissionGuard], data: { preload: true } },
  { path: 'quan-ly-nguyen-lieu',  loadChildren: () => import('../../pages/materials/materials.module').then(m => m.MaterialsModule), canActivate: [AuthGuard, TabPermissionGuard], data: { preload: true } },
  { path: 'inventory-overview',   loadChildren: () => import('../../pages/inventory-overview/inventory-overview.module').then(m => m.InventoryOverviewModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'inbound',              loadChildren: () => import('../../pages/inbound/inbound.module').then(m => m.InboundModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'danh-muc-nvl-tp',      loadChildren: () => import('../../pages/danh-muc-nvl-tp/danh-muc-nvl-tp-page.module').then(m => m.DanhMucNvlTpPageModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'outbound',             loadChildren: () => import('../../pages/outbound/outbound.module').then(m => m.OutboundModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'bag-history',          component: BagHistoryComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'pd-control',           loadChildren: () => import('../../pages/pd-control/pd-control.module').then(m => m.PdControlModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'location',             loadChildren: () => import('../../pages/location/location.module').then(m => m.LocationModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'j-warehouse', loadChildren: () => import('../../pages/j-warehouse/j-warehouse.module').then(m => m.JWarehousePageModule), canActivate: [AuthGuard, TabPermissionGuard], data: { preload: true, preloadDelay: 3000 } },
  { path: 'fg-in',                loadChildren: () => import('../../pages/fg-in/fg-in.module').then(m => m.FgInModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-out',               loadChildren: () => import('../../pages/fg-out/fg-out.module').then(m => m.FgOutModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'bieu-mau',             loadChildren: () => import('../../pages/bieu-mau/bieu-mau.module').then(m => m.BieuMauModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-check',             loadChildren: () => import('../../pages/fg-check/fg-check.module').then(m => m.FGCheckModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-inventory',         loadChildren: () => import('../../pages/fg-inventory/fg-inventory.module').then(m => m.FGInventoryModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-overview',          loadChildren: () => import('../../pages/fg-overview/fg-overview.module').then(m => m.FgOverviewModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'fg-location',          loadChildren: () => import('../../pages/fg-location/fg-location.module').then(m => m.FgLocationModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'pallet-id',            loadChildren: () => import('../../pages/pallet-id/pallet-id.module').then(m => m.PalletIdModule), canActivate: [AuthGuard, TabPermissionGuard] },

  { path: 'checklist',            loadChildren: () => import('../../pages/documents/documents.module').then(m => m.DocumentsModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'equipment',            loadChildren: () => import('../../pages/equipment/equipment-page.module').then(m => m.EquipmentPageModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'label',                loadChildren: () => import('../../pages/print-label/print-label.module').then(m => m.PrintLabelModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'index',                component: IndexComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'documents',            loadChildren: () => import('../../pages/documents/documents.module').then(m => m.DocumentsModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'kpi-reports',          component: KpiReportsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'work-order-status',    loadChildren: () => import('../../pages/work-order-status/work-order-status.module').then(m => m.WorkOrderStatusModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'shipment',             loadChildren: () => import('../../pages/shipment/shipment.module').then(m => m.ShipmentModule), canActivate: [AuthGuard, TabPermissionGuard] },


  { path: 'stock-check',          component: StockCheckComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'sxxk',                component: SxxkComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'scrap',               component: ScrapComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'qc',                   loadChildren: () => import('../../pages/qc/qc-page.module').then(m => m.QcPageModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'qc-traceability',      loadChildren: () => import('../../pages/qc/qc-traceability.module').then(m => m.QcTraceabilityModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'rm1-delivery',         component: Rm1DeliveryComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'shorted-materials',    component: ShortedMaterialsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'report',               component: ReportComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'zalo',                 component: ZaloComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  // Xe Tải: ai đăng nhập cũng dùng được (không quản lý tab permission)
  { path: 'xe-tai',               component: TruckScheduleComponent, canActivate: [AuthGuard] },
  { path: 'inbound-fgs',          component: InboundFgsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'outbound-fgs',         component: OutboundFgsComponent, canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'settings',             loadChildren: () => import('../../pages/settings/settings-page.module').then(m => m.SettingsPageModule), canActivate: [AuthGuard, SettingsGuard, TabPermissionGuard] },
  { path: 'nhiet-do',             loadChildren: () => import('../../pages/nhiet-do/nhiet-do-page.module').then(m => m.NhietDoPageModule), canActivate: [AuthGuard, TabPermissionGuard] },
  { path: 'equipment-checklist',  component: EquipmentChecklistComponent, canActivate: [AuthGuard, TabPermissionGuard] }
];
