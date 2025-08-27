export interface RouteInfo {
    path: string;
    title: string;
    icon: string;
    class: string;
    children?: RouteInfo[];
}

export const ROUTES: RouteInfo[] = [
  { path: '/dashboard', title: 'Dashboard',  icon: 'dashboard', class: '' },
  { path: '/work-order-status', title: 'Work Order',  icon: 'assignment', class: '' },
  { path: '/shipment', title: 'Shipment', icon: 'local_shipping', class: '' },
  { 
    path: '', 
    title: 'ASM1 RM', 
    icon: 'inventory', 
    class: 'asm1-rm-parent',
    children: [
      { path: '/inbound-asm1', title: 'RM1 Inbound', icon: 'IB', class: '' },
      { path: '/outbound-asm1', title: 'RM1 Outbound', icon: 'OB', class: '' },
      { path: '/materials-asm1', title: 'RM1 Inventory', icon: 'IV', class: '' },
      { path: '/inventory-overview-asm1', title: 'RM1 Overview', icon: 'IO', class: '' }
    ]
  },
  { 
    path: '', 
    title: 'ASM2 RM', 
    icon: 'inventory', 
    class: 'asm2-rm-parent',
    children: [
      { path: '/inbound-asm2', title: 'RM2 Inbound', icon: 'IB', class: '' },
      { path: '/outbound-asm2', title: 'RM2 Outbound', icon: 'OB', class: '' },
      { path: '/materials-asm2', title: 'RM2 Inventory', icon: 'IV', class: '' }
    ]
  },
  { path: '/fg', title: 'Finished Goods', icon: 'check_circle_outline', class: ''},
  { path: '/label', title: 'Label', icon: 'label', class: '' },
  { path: '/index', title: 'Bonded Report', icon: 'analytics', class: '' },

  { path: '/utilization', title: 'Utilization', icon: 'assessment', class: '' },
  { path: '/find', title: 'Find', icon: 'search', class: '' },
  { path: '/layout', title: 'Layout', icon: 'grid_view', class: '' },
  { path: '/checklist', title: 'Safety & Quality', icon: 'checklist', class: '' },
  { path: '/safety', title: 'Safety', icon: 'security', class: '' },
  { path: '/equipment', title: 'Training', icon: 'integration_instructions', class: '' },
  { path: '/settings', title: 'Settings', icon: 'settings', class: '' }
]; 