import { Component, OnInit, ElementRef, OnDestroy, Output, EventEmitter } from '@angular/core';
import { ROUTES } from '../../routes/sidebar-routes';
import {Location, LocationStrategy, PathLocationStrategy} from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { NotificationService } from '../../services/notification.service';
import { interval, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { FirebaseAuthService, User } from '../../services/firebase-auth.service';
import { NotificationDropdownComponent } from '../notification-dropdown/notification-dropdown.component';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent implements OnInit, OnDestroy {
    private listTitles: any[];
    private location: Location;
      mobile_menu_visible: any = 0;
    private toggleButton: any;
    private sidebarVisible: boolean;

    public notificationCount = 0;
    private lastNotificationCount = 0;
    private notificationSubscription: Subscription;
    private navigationSubscription?: Subscription;
    public currentUser: User | null = null;
    private userSubscription: Subscription;
    public selectedFactory: string = 'ASM1'; // Default to ASM1

    @Output() factoryChanged = new EventEmitter<string>();

    constructor(
      location: Location,  
      private element: ElementRef, 
      private router: Router, 
      private notificationService: NotificationService,
      private authService: FirebaseAuthService
    ) {
      this.location = location;
          this.sidebarVisible = false;
    }

    ngOnInit(){
      this.listTitles = ROUTES.filter(listTitle => listTitle);
      const navbar: HTMLElement = this.element.nativeElement;
      this.toggleButton = navbar.getElementsByClassName('navbar-toggler')[0];
      this.router.events.subscribe((event) => {
        this.sidebarClose();
         var $layer: any = document.getElementsByClassName('close-layer')[0];
         if ($layer) {
           $layer.remove();
           this.mobile_menu_visible = 0;
         }
     });

      // Lấy số lượng thông báo đã lưu trữ từ localStorage
      this.lastNotificationCount = parseInt(localStorage.getItem('lastNotificationCount') || '0', 10);
      this.notificationCount = this.lastNotificationCount; // Hiển thị số cũ trong khi chờ tải

      // Bắt đầu kiểm tra thông báo định kỳ (ví dụ: mỗi 30 giây)
      this.notificationSubscription = interval(30000).subscribe(() => this.checkForNotifications());
      this.checkForNotifications(); // Kiểm tra ngay lần đầu

      // Subscribe to user changes
      this.userSubscription = this.authService.currentUser.subscribe(user => {
        this.currentUser = user;
      });

      // Load selected factory from localStorage
      const savedFactory = localStorage.getItem('selectedFactory');
      if (savedFactory) {
        this.selectedFactory = savedFactory;
      }

      this.navigationSubscription = this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(() => {
          const f = localStorage.getItem('selectedFactory');
          if (f === 'ASM1' || f === 'ASM2') {
            this.selectedFactory = f;
          }
        });
    }

    checkForNotifications() {
      this.notificationService.getNotificationCount().subscribe({
        next: (data) => {
          if (data.status === 'success') {
            if (data.count > this.lastNotificationCount) {
              this.notificationCount = data.count - this.lastNotificationCount;
            } else {
              // Nếu không có thông báo mới, hoặc sheet đã bị xóa bớt, reset về 0
              this.notificationCount = 0;
            }
            // Không lưu data.count trực tiếp, chỉ lưu khi người dùng đã xem
          }
        },
        error: (err) => {
          console.error('Failed to get notifications:', err);
          this.notificationCount = 0; // Reset nếu có lỗi
        }
      });
    }

    // Khi người dùng nhấp vào chuông thông báo, reset số lượng
    resetNotificationCount() {
        this.notificationService.getNotificationCount().subscribe({
            next: (data) => {
                if(data.status === 'success') {
                    this.lastNotificationCount = data.count;
                    localStorage.setItem('lastNotificationCount', this.lastNotificationCount.toString());
                    this.notificationCount = 0;
                }
            }
        });
    }

    ngOnDestroy() {
      // Hủy đăng ký để tránh rò rỉ bộ nhớ
      if (this.notificationSubscription) {
        this.notificationSubscription.unsubscribe();
      }
      if (this.navigationSubscription) {
        this.navigationSubscription.unsubscribe();
      }
      if (this.userSubscription) {
        this.userSubscription.unsubscribe();
      }
    }

    sidebarOpen() {
        const toggleButton = this.toggleButton;
        const body = document.getElementsByTagName('body')[0];
        if (toggleButton) {
          setTimeout(function(){
              toggleButton.classList.add('toggled');
          }, 500);
        }
        if (body) {
          body.classList.add('nav-open');
        }
        this.sidebarVisible = true;
    };
    sidebarClose() {
        const body = document.getElementsByTagName('body')[0];
        if (this.toggleButton) {
          this.toggleButton.classList.remove('toggled');
        }
        this.sidebarVisible = false;
        if (body) {
          body.classList.remove('nav-open');
        }
    };
    sidebarToggle() {
        // const toggleButton = this.toggleButton;
        // const body = document.getElementsByTagName('body')[0];
        var $toggle = document.getElementsByClassName('navbar-toggler')[0];

        if (this.sidebarVisible === false) {
            this.sidebarOpen();
        } else {
            this.sidebarClose();
        }
        const body = document.getElementsByTagName('body')[0];

        if (this.mobile_menu_visible == 1) {
            // $('html').removeClass('nav-open');
            body.classList.remove('nav-open');
            if ($layer) {
                $layer.remove();
            }
            setTimeout(function() {
                $toggle.classList.remove('toggled');
            }, 400);

            this.mobile_menu_visible = 0;
        } else {
            setTimeout(function() {
                $toggle.classList.add('toggled');
            }, 430);

            var $layer = document.createElement('div');
            $layer.setAttribute('class', 'close-layer');


            if (body.querySelectorAll('.main-panel')) {
                document.getElementsByClassName('main-panel')[0].appendChild($layer);
            }else if (body.classList.contains('off-canvas-sidebar')) {
                document.getElementsByClassName('wrapper-full-page')[0].appendChild($layer);
            }

            setTimeout(function() {
                $layer.classList.add('visible');
            }, 100);

            $layer.onclick = function() { //asign a function
              body.classList.remove('nav-open');
              this.mobile_menu_visible = 0;
              $layer.classList.remove('visible');
              setTimeout(function() {
                  $layer.remove();
                  $toggle.classList.remove('toggled');
              }, 400);
            }.bind(this);

            body.classList.add('nav-open');
            this.mobile_menu_visible = 1;

        }
    };

    getTitle(){
      // Luôn trả về chuỗi rỗng để ẩn tiêu đề trong navbar
      return '';
    }

    /** Đường dẫn app hiện tại (bỏ query/hash) — dùng cho *ngIf navbar. */
    private currentAppPath(): string {
      let u = (this.router.url || '').trim();
      if (!u) {
        u = this.location.prepareExternalUrl(this.location.path()) || '/';
        if (u.charAt(0) === '#') {
          u = u.slice(1);
        }
      }
      if (!u.startsWith('/')) {
        u = '/' + u;
      }
      return u.split('?')[0].split('#')[0] || '/';
    }

    isDashboard(): boolean {
      return this.currentAppPath() === '/dashboard';
    }

    /**
     * Cụm factory chip + notifications + profile trên navbar từng bật ở mọi tab (trừ Dashboard),
     * gây trùng UI. Tắt mặc định; bật lại chỉ khi thật sự cần (đổi return true + điều kiện route).
     */
    shouldShowNavbarFactoryToolbar(): boolean {
      return false;
    }

    isMenuPage(): boolean {
      const p = this.currentAppPath();
      return p === '/menu' || p === '/';
    }

    isQCPage(): boolean {
      const p = this.currentAppPath();
      return p === '/qc' || p === '/qc-traceability';
    }

    isSettingsPage(): boolean {
      return this.currentAppPath() === '/settings';
    }


    isRm1DeliveryPage(): boolean {
      return this.currentAppPath() === '/rm1-delivery';
    }

    isInboundAsm1Page(): boolean {
      return this.currentAppPath() === '/inbound-asm1';
    }

    isInboundAsm2Page(): boolean {
      return this.currentAppPath() === '/inbound-asm2';
    }

    isInboundAsmPage(): boolean {
      return this.isInboundAsm1Page() || this.isInboundAsm2Page();
    }

    isOutboundAsm1Page(): boolean {
      return this.currentAppPath() === '/outbound-asm1';
    }

    isOutboundAsm2Page(): boolean {
      return this.currentAppPath() === '/outbound-asm2';
    }

    isOutboundAsmPage(): boolean {
      return this.isOutboundAsm1Page() || this.isOutboundAsm2Page();
    }

    isShipmentPage(): boolean {
      return this.currentAppPath() === '/shipment';
    }

    isPdControlPage(): boolean {
      return this.currentAppPath() === '/pd-control';
    }

    isShortedMaterialsPage(): boolean {
      return this.currentAppPath() === '/shorted-materials';
    }

    isQcTraceabilityPage(): boolean {
      return this.currentAppPath() === '/qc-traceability';
    }

    goToMenu(): void {
      this.router.navigate(['/menu']);
    }

    async signOut(): Promise<void> {
      try {
        await this.authService.signOut();
        this.router.navigate(['/login']);
      } catch (error) {
        console.error('Đăng xuất thất bại:', error);
      }
    }

    selectFactory(factory: string): void {
      this.selectedFactory = factory;
      // Emit event hoặc lưu vào localStorage để các component khác có thể sử dụng
      localStorage.setItem('selectedFactory', factory);
      console.log('Selected factory:', factory);
      
      // Emit event to notify other components
      this.factoryChanged.emit(factory);
      
      // Có thể thêm logic để thông báo cho các component khác biết factory đã thay đổi
    }



}
