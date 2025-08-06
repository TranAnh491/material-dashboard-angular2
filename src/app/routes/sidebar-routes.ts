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
    { path: '#materials', title: 'Materials', icon: 'inventory_2', class: '', children: [
        { path: '/inbound-materials', title: 'Inbound', icon: 'arrow_downward', class: 'ml-4' },
        { path: '/outbound-materials', title: 'Outbound', icon: 'arrow_upward', class: 'ml-4' },
        { path: '/materials-inventory', title: 'Inventory', icon: 'inventory', class: 'ml-4' }
    ]},
    { path: '/fg', title: 'Finished Goods', icon: 'check_circle_outline', class: ''},
    { path: '/label', title: 'Label', icon: 'label', class: '' },
    { path: '/index', title: 'Index', icon: 'analytics', class: '' },
    { path: '/bm', title: 'Bonded Materials', icon: 'lock', class: ''},

    { path: '/utilization', title: 'Utilization', icon: 'assessment', class: '' },
    { path: '/find', title: 'Find', icon: 'search', class: '' },
    { path: '/layout', title: 'Layout', icon: 'grid_view', class: '' },
    { path: '/checklist', title: 'Safety & Quality', icon: 'checklist', class: '' },
    { path: '/equipment', title: 'Training', icon: 'integration_instructions', class: '' },
    { path: '/task', title: 'Flow Work', icon: 'view_kanban', class: '' },
    { path: '/settings', title: 'Settings', icon: 'settings', class: '' }
]; 