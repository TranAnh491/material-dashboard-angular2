import { Component, OnInit } from '@angular/core';

declare const $: any;
declare interface RouteInfo {
    path?: string;
    title: string;
    icon: string;
    svg?: string;
    class: string;
    children?: RouteInfo[];
}
export const ROUTES: RouteInfo[] = [
    {
        path: '/dashboard',
        title: 'Dashboard',
        icon: 'dashboard',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
        class: ''
    },
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
    {
        path: '/documents',
        title: 'Checklist',
        icon: 'checklist',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
        class: ''
    },
    { path: '/equipment', title: 'Equipment',  icon:'construction', class: '' },
];

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit {
  menuItems: any[];
  googleSheetUrl: string;

  constructor() { }

  ngOnInit() {
    this.menuItems = ROUTES.filter(menuItem => menuItem);
    this.googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=GID_CUA_WO_MASS';
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
