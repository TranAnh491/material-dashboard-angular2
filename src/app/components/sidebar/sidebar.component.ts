import { Component, OnInit } from '@angular/core';

declare const $: any;

declare interface RouteInfo {
  path?: string;
  title: string;
  icon?: string;
  svg?: string;
  class: string;
  children?: RouteInfo[];
}

export const ROUTES: RouteInfo[] = [
  {
    path: '/dashboard',
    title: 'Dashboard',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    class: ''
  },
  {
    title: 'Daily Operations',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 7V3m8 4V3M4 11h16M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z"/></svg>`,
    class: '',
    children: [
      { path: '/work-order-status', title: 'Work order status', svg: '', class: '' },
      { path: '/shipment', title: 'Shipment', svg: '', class: '' }
    ]
  },
  {
    title: 'Materials',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M20 13V6a2 2 0 00-2-2h-5.586a1 1 0 00-.707.293l-8 8a1 1 0 000 1.414l5.586 5.586a1 1 0 001.414 0l8-8A1 1 0 0020 13z"/></svg>`,
    class: '',
    children: [
      { path: '/inbound-materials', title: 'Inbound materials', svg: '', class: '' },
      { path: '/outbound-materials', title: 'Outbound materials', svg: '', class: '' },
      { path: '/materials-inventory', title: 'Materials inventory', svg: '', class: '' }
    ]
  },
  {
    title: 'Finished Goods',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4h16v16H4V4z"/><path d="M8 8h8v8H8V8z"/></svg>`,
    class: '',
    children: [
      { path: '/inbound-fgs', title: 'Inbound FGs', svg: '', class: '' },
      { path: '/outbound-fgs', title: 'Outbound FGs', svg: '', class: '' },
      { path: '/table-list', title: 'FGs Inventory', svg: '', class: '' }
    ]
  },
  {
    path: '/typography',
    title: 'Bonded Materials',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4"/></svg>`,
    class: ''
  },
  {
    path: '/maps',
    title: 'Find',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>`,
    class: ''
  },
  {
    path: '/layout-3d',
    title: '3D Layout',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>`,
    class: ''
  },
  {
    path: '/documents',
    title: 'Checklist',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7"/></svg>`,
    class: ''
  },
  {
    path: '/equipment',
    title: 'Equipment',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9.75 3a.75.75 0 011.5 0v2.25h1.5V3a.75.75 0 011.5 0v2.25H18A2.25 2.25 0 0120.25 7.5v11.25A2.25 2.25 0 0118 21H6a2.25 2.25 0 01-2.25-2.25V7.5A2.25 2.25 0 016 5.25h3.75V3z"/></svg>`,
    class: ''
  }
];

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit {
  menuItems: any[] = [];
  googleSheetUrl: string;

  constructor() {}

  ngOnInit() {
    this.menuItems = ROUTES;
    this.googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=GID_CUA_WO_MASS';
  }

  isMobileMenu() {
    return $(window).width() <= 991;
  }

  openGoogleSheet() {
    window.open(this.googleSheetUrl, '_blank');
  }
}
