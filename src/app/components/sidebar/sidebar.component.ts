import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { ROUTES } from '../../routes/sidebar-routes';
import { FilteredRoutesService } from '../../services/filtered-routes.service';
import { NotificationService } from '../../services/notification.service';
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
  hasNewUsers = false;
  private destroy$ = new Subject<void>();
  private allFilteredRoutes: any[] = [];

  constructor(
    private router: Router,
    private filteredRoutesService: FilteredRoutesService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    // Sử dụng filtered routes thay vì ROUTES trực tiếp
    this.filteredRoutesService.getFilteredRoutes()
      .pipe(takeUntil(this.destroy$))
      .subscribe(filteredRoutes => {
        this.allFilteredRoutes = filteredRoutes.filter(menuItem => menuItem).map(menuItem => ({...menuItem, expanded: false}));
        this.updateMenuItems();
      });
    
    // Lắng nghe thông báo tài khoản mới
    this.notificationService.hasNewUsers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(hasNewUsers => {
        this.hasNewUsers = hasNewUsers;
      });
    
    this.googleSheetUrl = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit#gid=GID_CUA_WO_MASS';
  }

  @HostListener('window:resize', ['$event'])
  onResize() {
    this.updateMenuItems();
  }

  private updateMenuItems() {
    if (!this.allFilteredRoutes || this.allFilteredRoutes.length === 0) {
      return;
    }

    // Lọc menu items cho mobile
    if (this.isMobileMenu()) {
      this.menuItems = this.filterMobileMenuItems([...this.allFilteredRoutes]);
    } else {
      this.menuItems = [...this.allFilteredRoutes];
    }
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

  hasActiveChild(menuItem: any): boolean {
    if (!menuItem.children) return false;
    return menuItem.children.some(child => {
      return this.router.url === child.path;
    });
  }

  // Lọc menu items cho mobile - chỉ hiển thị các tab được phép
  private filterMobileMenuItems(menuItems: any[]): any[] {
    // Danh sách các path được phép trên mobile
    const allowedMobilePaths = [
      '/dashboard',           // Tab 1
      '/inbound-asm1',        // Tab 4
      '/outbound-asm1',       // Tab 5
      '/materials-asm1',      // Tab 6
      '/inbound-asm2',        // Tab 8
      '/outbound-asm2',       // Tab 9
      '/materials-asm2',      // Tab 10
      '/find-rm1',           // Tab 16
      '/location',           // Tab 17
      '/stock-check',        // Tab 18
      '/safety'              // Tab 20
    ];

    return menuItems.map(menuItem => {
      // Nếu là route có path trực tiếp (không có children)
      if (menuItem.path && !menuItem.children) {
        if (allowedMobilePaths.includes(menuItem.path)) {
          return menuItem;
        }
        return null;
      }
      
      // Nếu là route có children (như ASM1 RM, ASM2 RM, ASM1 FG)
      if (menuItem.children && menuItem.children.length > 0) {
        // Lọc children chỉ giữ lại những tab được phép
        const filteredChildren = menuItem.children.filter(child => 
          allowedMobilePaths.includes(child.path)
        );
        
        // Chỉ hiển thị menu item này nếu còn ít nhất 1 child được phép
        if (filteredChildren.length > 0) {
          return {
            ...menuItem,
            children: filteredChildren
          };
        }
        return null;
      }
      
      return null;
    }).filter(item => item !== null);
  }
}
