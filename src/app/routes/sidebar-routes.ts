export interface RouteInfo {
    path: string;
    title: string;
    icon: string;
    class: string;
    children?: RouteInfo[];
}

export const ROUTES: RouteInfo[] = [
    { path: '/dashboard', title: 'Dashboard',  icon: 'dashboard', class: '' },
    { path: '#daily-operations', title: 'Daily Operations', icon: 'event_note', class: '', children: [
        { path: '/work-order-status', title: 'Work Order',  icon: 'assignment', class: 'ml-4' },
        { path: '/shipment', title: 'Shipment', icon: 'local_shipping', class: 'ml-4' }
    ]},
    { path: '#materials', title: 'Materials', icon: 'inventory_2', class: '', children: [
        { path: '/inbound-materials', title: 'Inbound', icon: 'arrow_downward', class: 'ml-4' },
        { path: '/outbound-materials', title: 'Outbound', icon: 'arrow_upward', class: 'ml-4' },
        { path: '/materials-inventory', title: 'Inventory', icon: 'inventory', class: 'ml-4' }
    ]},
    { path: '/fg', title: 'Finished Goods', icon: 'check_circle_outline', class: ''},
    { path: '/bm', title: 'Bonded Materials', icon: 'lock', class: ''},
    { path: '/shelf-life', title: 'Materials Lifecycle', icon: 'hourglass_empty', class: '' },
    { path: '/utilization', title: 'Utilization', icon: 'assessment', class: '' },
    { path: '/find', title: 'Find', icon: 'search', class: '' },
    { path: '/layout', title: 'Layout', icon: 'grid_view', class: '' },
    { path: '/checklist', title: 'Safety', icon: 'checklist', class: '' },
    { path: '/equipment', title: 'Instruction and Test', icon: 'integration_instructions', class: '' },
    { path: '/label', title: 'Label', icon: 'label', class: '' },
    { path: '/task', title: 'Task Board', icon: 'view_kanban', class: '' },
    { path: '/settings', title: 'Settings', icon: 'settings', class: '' }
]; 