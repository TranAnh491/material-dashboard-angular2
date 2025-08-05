import { Component, OnInit, OnDestroy } from '@angular/core';
import { ROUTES } from '../../routes/sidebar-routes';
import { FilteredRoutesService } from '../../services/filtered-routes.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

declare const $: any;

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit, OnDestroy {
  menuItems: any[];
  googleSheetUrl: string;
  private destroy$ = new Subject<void>();

  constructor(
    private filteredRoutesService: FilteredRoutesService
  ) {}

  ngOnInit() {
    // Sử dụng filtered routes thay vì ROUTES trực tiếp
    this.filteredRoutesService.getFilteredRoutes()
      .pipe(takeUntil(this.destroy$))
      .subscribe(filteredRoutes => {
        this.menuItems = filteredRoutes.filter(menuItem => menuItem).map(menuItem => ({...menuItem, expanded: false}));
      });
    
    this.googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=GID_CUA_WO_MASS';
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
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
