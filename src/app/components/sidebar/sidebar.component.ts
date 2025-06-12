import { Component, OnInit } from '@angular/core';

declare const $: any;
declare interface RouteInfo {
    path?: string;
    title: string;
    icon: string;
    class: string;
    children?: RouteInfo[];
}
export const ROUTES: RouteInfo[] = [
    { path: '/dashboard', title: 'Dashboard',  icon: 'dashboard', class: '' },
    {
        title: 'Daily Operations',
        icon: 'event_note',
        class: '',
        children: [
            { path: '/work-order-status', title: 'Work order status', icon: 'assignment', class: '' },
            { path: '/shipment', title: 'Shipment', icon: 'local_shipping', class: '' }
        ]
    },
    {
        title: 'Materials',
        icon: 'inventory_2',
        class: '',
        children: [
            { path: '/inbound-materials', title: 'Inbound materials', icon: 'call_received', class: '' },
            { path: '/outbound-materials', title: 'Outbound materials', icon: 'call_made', class: '' },
            { path: '/materials-inventory', title: 'Materials inventory', icon: 'inventory', class: '' }
        ]
    },
    {
        title: 'Finished Goods',
        icon: 'all_inbox',
        class: '',
        children: [
            { path: '/inbound-fgs', title: 'Inbound FGs', icon: 'arrow_downward', class: '' },
            { path: '/outbound-fgs', title: 'Outbound FGs', icon: 'arrow_upward', class: '' },
            { path: '/table-list', title: 'FGs Inventory', icon: 'inventory', class: '' },
        ]
    },
    { path: '/typography', title: 'Bonded Materials',  icon:'lock', class: '' },
    { path: '/maps', title: 'Layout',  icon:'view_quilt', class: '' },
    { path: '/documents', title: 'Checklist',  icon:'checklist', class: '' },
    { path: '/announcement', title: 'Announcement',  icon:'campaign', class: '' },
    { path: '/kpi-reports', title: 'KPI & Reports',  icon:'bar_chart', class: '' },
    { path: '/equipment', title: 'Equipment',  icon:'construction', class: '' },
    { path: 'upgrade', title: 'Warehouse Team',  icon:'groups', class: 'active-pro' },
];

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit {
  menuItems: any[];

  constructor() { }

  ngOnInit() {
    this.menuItems = ROUTES.filter(menuItem => menuItem);
  }
  isMobileMenu() {
      if ($(window).width() > 991) {
          return false;
      }
      return true;
  };

  openGoogleSheet() {
    window.open('https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit?gid=0#gid=0', '_blank');
  }
}
