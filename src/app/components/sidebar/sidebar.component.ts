import { Component, OnInit } from '@angular/core';
import { ROUTES } from '../../routes/sidebar-routes';

declare const $: any;

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit {
  menuItems: any[];
  googleSheetUrl: string;

  constructor() {}

  ngOnInit() {
    this.menuItems = ROUTES.filter(menuItem => menuItem).map(menuItem => ({...menuItem, expanded: false}));
    this.googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=GID_CUA_WO_MASS';
  }

  isMobileMenu() {
    return $(window).width() <= 991;
  }

  openGoogleSheet() {
    window.open(this.googleSheetUrl, '_blank');
  }

  toggleSubMenu(menuItem) {
    menuItem.expanded = !menuItem.expanded;
  }
}
