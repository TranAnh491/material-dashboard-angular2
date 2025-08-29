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
  { 
    path: '', 
    title: 'ASM1 FG', 
    icon: 'check_circle_outline', 
    class: 'asm1-fg-parent',
    children: [
      { path: '/fg-in', title: 'FG In', icon: 'IB', class: '' },
      { path: '/fg-out', title: 'FG Out', icon: 'OB', class: '' },
      { path: '/fg-inventory', title: 'FG Inventory', icon: 'IV', class: '' }
    ]
  },
  { path: '/label', title: 'Label', icon: 'label', class: '' },
  { path: '/find-rm1', title: 'Find RM1', icon: 'search', class: '' },
  { path: '/location', title: 'Location', icon: 'location_on', class: '' },
  { path: '/safety', title: 'Safety', icon: 'security', class: '' },
  { path: '/chart', title: 'Chart', icon: 'insert_chart', class: '' },
  { path: '/index', title: 'Bonded Report', icon: 'analytics', class: '' },

  { path: '/utilization', title: 'Utilization', icon: 'assessment', class: '' },
  { path: '/find', title: 'Layout', icon: 'search', class: '' },
  { path: '/layout', title: '3D Map', icon: '3d_rotation', class: '' },
  { path: '/checklist', title: 'Safety & Quality', icon: 'checklist', class: '' },
  { path: '/equipment', title: 'Training', icon: 'integration_instructions', class: '' },
  { path: '/settings', title: 'Settings', icon: 'settings', class: '' }
]; 