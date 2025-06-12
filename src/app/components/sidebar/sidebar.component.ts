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
        title: 'Materials',
        icon: 'inventory_2',
        class: '',
        children: [
            { path: '/work-order-status', title: 'Work order status', icon: 'assignment', class: '' },
            { path: '/inbound-materials', title: 'Inbound materials', icon: 'call_received', class: '' },
            { path: '/outbound-materials', title: 'Outbound materials', icon: 'call_made', class: '' },
            { path: '/materials-inventory', title: 'Materials inventory', icon: 'inventory', class: '' }
        ]
    },
    { path: '/table-list', title: 'Finished Goods',  icon:'all_inbox', class: '' },
    { path: '/typography', title: 'Bonded Materials',  icon:'lock', class: '' },
    { path: '/documents', title: 'Checklist',  icon:'checklist', class: '' },
    { path: '/maps', title: 'Find',  icon:'location_on', class: '' },
    { path: '/announcement', title: 'Announcement',  icon:'campaign', class: '' },
    { path: '/upgrade', title: 'Warehouse Team',  icon:'groups', class: 'active-pro' },
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
