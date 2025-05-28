import { Component, OnInit } from '@angular/core';

declare const $: any;
declare interface RouteInfo {
    path: string;
    title: string;
    icon: string;
    class: string;
}
export const ROUTES: RouteInfo[] = [
    { path: '/dashboard', title: 'Dashboard',  icon: 'dashboard', class: '' },
    { path: '/user-profile', title: 'Materials',  icon:'inventory_2', class: '' },
    { path: '/table-list', title: 'Finished Goods',  icon:'all_inbox', class: '' },
    { path: '/typography', title: 'Bonded Materials',  icon:'lock', class: '' },
    { path: '/icons', title: 'SKU',  icon:'qr_code_2', class: '' },
    { path: '/maps', title: 'Layout',  icon:'location_on', class: '' },
    { path: '/notifications', title: 'Transport Fleet',  icon:'local_shipping', class: '' },
    { path: '/upgrade', title: 'Made in Airspeed',  icon:'verified', class: 'active-pro' },
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
}
