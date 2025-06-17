import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

declare const $: any;

interface RouteInfo {
  path?: string;
  title: string;
  icon?: string;
  svg?: string;
  class: string;
  children?: RouteInfo[];
  expanded?: boolean;
}

const RAW_ROUTES: RouteInfo[] = [
  {
    path: '/dashboard',
    title: 'Dashboard',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    class: ''
  },
  {
    title: 'Daily Operations',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path d="M8 7V3m8 4V3M4 11h16"/></svg>`,
    class: '',
    children: [
      { path: '/work-order-status', title: 'Work order status', class: '' },
      { path: '/shipment', title: 'Shipment', class: '' }
    ]
  },
  {
    title: 'Materials',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M20 13V6a2 2 0 00-2-2h-5.586l-8 8 5.586 5.586 8-8z"/></svg>`,
    class: '',
    children: [
      { path: '/inbound-materials', title: 'Inbound materials', class: '' },
      { path: '/outbound-materials', title: 'Outbound materials', class: '' },
      { path: '/materials-inventory', title: 'Materials inventory', class: '' }
    ]
  },
  {
    title: 'Finished Goods',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4h16v16H4V4z"/><path d="M8 8h8v8H8V8z"/></svg>`,
    class: '',
    children: [
      { path: '/inbound-fgs', title: 'Inbound FGs', class: '' },
      { path: '/outbound-fgs', title: 'Outbound FGs', class: '' },
      { path: '/table-list', title: 'FGs Inventory', class: '' }
    ]
  },
  {
    path: '/typography',
    title: 'Bonded Materials',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path d="M12 4v16m8-8H4"/></svg>`,
    class: ''
  },
  {
    path: '/maps',
    title: 'Layout',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 20l-5-2V4l5 2m6 14l5-2V4l-5 2M9 4l6 2m0 14V6"/></svg>`,
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

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit() {
    this.menuItems = RAW_ROUTES.map(item => ({
      ...item,
      svg: item.svg ? this.sanitizer.bypassSecurityTrustHtml(item.svg) : '',
      children: item.children?.map(child => ({
        ...child,
        svg: child.svg ? this.sanitizer.bypassSecurityTrustHtml(child.svg) : ''
      }))
    }));
    this.googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=0';
  }

  isMobileMenu() {
    return $(window).width() <= 991;
  }

  openGoogleSheet() {
    window.open(this.googleSheetUrl, '_blank');
  }
}
