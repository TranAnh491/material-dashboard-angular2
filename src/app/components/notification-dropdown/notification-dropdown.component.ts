import { Component, OnInit, HostListener } from '@angular/core';
import { Observable } from 'rxjs';
import { NotificationService, Notification } from '../../services/notification.service';

@Component({
  selector: 'app-notification-dropdown',
  templateUrl: './notification-dropdown.component.html',
  styleUrls: ['./notification-dropdown.component.css']
})
export class NotificationDropdownComponent implements OnInit {
  notifications$: Observable<Notification[]>;
  isOpen = false;
  unreadCount = 0;

  constructor(private notificationService: NotificationService) {
    this.notifications$ = this.notificationService.getNotifications();
  }

  ngOnInit(): void {
    this.notifications$.subscribe(notifications => {
      this.unreadCount = notifications.filter(n => !n.isRead).length;
    });
  }

  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
  }

  markAsRead(notificationId: string): void {
    this.notificationService.markNotificationAsReadById(notificationId);
  }

  markAllAsRead(): void {
    this.notificationService.markAllNotificationsAsReadById();
  }

  getNotificationIcon(type: string): string {
    switch (type) {
      case 'success': return 'check_circle';
      case 'warning': return 'warning';
      case 'error': return 'error';
      default: return 'info';
    }
  }

  getNotificationColor(type: string): string {
    switch (type) {
      case 'success': return 'text-success';
      case 'warning': return 'text-warning';
      case 'error': return 'text-danger';
      default: return 'text-info';
    }
  }

  formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    if (hours < 24) return `${hours} giờ trước`;
    if (days < 7) return `${days} ngày trước`;
    return date.toLocaleDateString('vi-VN');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.notification-dropdown')) {
      this.isOpen = false;
    }
  }
} 