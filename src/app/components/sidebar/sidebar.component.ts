import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ROUTES, RouteInfo } from '../../routes/sidebar-routes';

declare const $: any;

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit {
  menuItems: RouteInfo[];
  googleSheetUrl: string;

  constructor(private sanitizer: DomSanitizer) {}

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
