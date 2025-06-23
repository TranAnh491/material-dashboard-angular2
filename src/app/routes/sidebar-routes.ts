export interface RouteInfo {
    path: string;
    title: string;
    icon: string;
    class: string;
}

export const ROUTES: RouteInfo[] = [
    { path: '/dashboard', title: 'Dashboard',  icon: 'dashboard', class: '' },
    { path: '/op-daily', title: 'Daily Operations', icon: 'event_note', class: ''},
    { path: '/materials', title: 'Materials', icon: 'inventory_2', class: ''},
    { path: '/fg', title: 'Finished Goods', icon: 'check_circle_outline', class: ''},
    { path: '/bm', title: 'Bonded Materials', icon: 'lock', class: ''},
    { path: '/find', title: 'Find', icon: 'search', class: '' },
    { path: '/layout', title: 'Layout', icon: 'grid_view', class: '' },
    { path: '/checklist', title: 'Checklist', icon: 'checklist', class: '' },
    { path: '/equipment', title: 'Equipment', icon: 'settings_input_component', class: '' },
]; 