import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  createdAt: Date;
  isRead: boolean;
  userId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private hasNewUsersSubject = new BehaviorSubject<boolean>(false);
  public hasNewUsers$ = this.hasNewUsersSubject.asObservable();

  constructor(private firestore: AngularFirestore) {
    this.checkForNewUsers();
  }

  private async checkForNewUsers(): Promise<void> {
    try {
      const notificationsRef = this.firestore.collection('new-user-notifications');
      const snapshot = await notificationsRef.ref.where('isRead', '==', false).get();
      this.hasNewUsersSubject.next(!snapshot.empty);
    } catch (error) {
      console.error('❌ Error checking for new users:', error);
    }
  }

  async createNewUserNotification(userData: any): Promise<void> {
    try {
      const notification: any = {
        id: this.firestore.createId(),
        userId: userData.uid,
        userEmail: userData.email,
        displayName: userData.displayName || '',
        department: userData.department || '',
        factory: userData.factory || '',
        role: userData.role || 'User',
        createdAt: new Date(),
        isRead: false,
        readBy: []
      };
      await this.firestore.collection('new-user-notifications').doc(notification.id).set(notification);
      this.hasNewUsersSubject.next(true);
      console.log('✅ New user notification created:', notification.id);
    } catch (error) {
      console.error('❌ Error creating new user notification:', error);
    }
  }

  getNewUserNotifications(): Observable<any[]> {
    return this.firestore.collection<any>('new-user-notifications', ref =>
      ref.orderBy('createdAt', 'desc')
    ).valueChanges();
  }

  async markNotificationAsRead(notificationId: string, readBy: string): Promise<void> {
    try {
      const notificationDoc = await this.firestore.collection('new-user-notifications').doc(notificationId).get().toPromise();
      const currentData = notificationDoc?.data() as any;
      const updatedReadBy = currentData?.readBy || [];
      if (!updatedReadBy.includes(readBy)) {
        updatedReadBy.push(readBy);
      }
      await this.firestore.collection('new-user-notifications').doc(notificationId).update({
        isRead: true,
        readBy: updatedReadBy,
        readAt: new Date()
      });
      this.checkForNewUsers();
      console.log('✅ Notification marked as read:', notificationId);
    } catch (error) {
      console.error('❌ Error marking notification as read:', error);
    }
  }

  async markAllNotificationsAsRead(readBy: string): Promise<void> {
    try {
      const notificationsRef = this.firestore.collection('new-user-notifications');
      const snapshot = await notificationsRef.ref.where('isRead', '==', false).get();
      for (const doc of snapshot.docs) {
        const currentData = doc.data() as any;
        const updatedReadBy = currentData?.readBy || [];
        if (!updatedReadBy.includes(readBy)) {
          updatedReadBy.push(readBy);
        }
        await this.firestore.collection('new-user-notifications').doc(doc.id).update({
          isRead: true,
          readBy: updatedReadBy,
          readAt: new Date()
        });
      }
      this.hasNewUsersSubject.next(false);
      console.log('✅ All notifications marked as read');
    } catch (error) {
      console.error('❌ Error marking all notifications as read:', error);
    }
  }

  async deleteOldNotifications(daysOld: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      const notificationsRef = this.firestore.collection('new-user-notifications');
      const snapshot = await notificationsRef.ref
        .where('createdAt', '<', cutoffDate)
        .get();
      const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`✅ Deleted ${snapshot.docs.length} old notifications`);
    } catch (error) {
      console.error('❌ Error deleting old notifications:', error);
    }
  }

  // Tạo thông báo mới
  async createNotification(notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>): Promise<void> {
    try {
      const newNotification: Notification = {
        id: this.firestore.createId(),
        ...notification,
        createdAt: new Date(),
        isRead: false
      };
      await this.firestore.collection('notifications').doc(newNotification.id).set(newNotification);
      
      // Tự động cleanup sau khi tạo thông báo mới
      await this.cleanupOldNotifications();
      
      console.log('✅ Notification created:', newNotification.id);
    } catch (error) {
      console.error('❌ Error creating notification:', error);
    }
  }

  // Lấy tất cả thông báo
  getNotifications(): Observable<Notification[]> {
    return this.firestore.collection<Notification>('notifications', ref =>
      ref.orderBy('createdAt', 'desc').limit(20)
    ).valueChanges();
  }

  // Xóa thông báo cũ và chỉ giữ lại 20 thông báo gần nhất
  async cleanupOldNotifications(): Promise<void> {
    try {
      const notificationsRef = this.firestore.collection('notifications');
      const snapshot = await notificationsRef.ref.orderBy('createdAt', 'desc').get();
      
      if (snapshot.docs.length > 20) {
        const batch = this.firestore.firestore.batch();
        const docsToDelete = snapshot.docs.slice(20); // Xóa từ thông báo thứ 21 trở đi
        
        docsToDelete.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        console.log(`✅ Deleted ${docsToDelete.length} old notifications, keeping only 20 most recent`);
      }
    } catch (error) {
      console.error('❌ Error cleaning up old notifications:', error);
    }
  }

  // Lấy số lượng thông báo (cho navbar)
  getNotificationCount(): Observable<any> {
    return this.firestore.collection('notifications').valueChanges().pipe(
      map(notifications => ({
        status: 'success',
        count: notifications.length
      }))
    );
  }

  // Đánh dấu thông báo đã đọc
  async markNotificationAsReadById(notificationId: string): Promise<void> {
    try {
      await this.firestore.collection('notifications').doc(notificationId).update({
        isRead: true
      });
      console.log('✅ Notification marked as read:', notificationId);
    } catch (error) {
      console.error('❌ Error marking notification as read:', error);
    }
  }

  // Đánh dấu tất cả thông báo đã đọc
  async markAllNotificationsAsReadById(): Promise<void> {
    try {
      const notificationsRef = this.firestore.collection('notifications');
      const snapshot = await notificationsRef.ref.where('isRead', '==', false).get();
      const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { isRead: true });
      });
      await batch.commit();
      console.log('✅ All notifications marked as read');
    } catch (error) {
      console.error('❌ Error marking all notifications as read:', error);
    }
  }

  // Tạo thông báo mẫu để test
  async createSampleNotifications(): Promise<void> {
    const sampleNotifications = [
      {
        title: 'Cập nhật nhiệt độ',
        message: 'Nhiệt độ tại ASM1 đã vượt quá ngưỡng cho phép',
        type: 'warning' as const
      },
      {
        title: 'Hoàn thành Work Order',
        message: 'Work Order #WO-2024-001 đã được hoàn thành thành công',
        type: 'success' as const
      },
      {
        title: 'Lỗi hệ thống',
        message: 'Phát hiện lỗi kết nối database tại ASM2',
        type: 'error' as const
      },
      {
        title: 'Thông báo bảo trì',
        message: 'Lịch bảo trì máy móc sẽ diễn ra vào ngày mai',
        type: 'info' as const
      },
      {
        title: 'Shipment mới',
        message: 'Có 5 shipment mới cần xử lý',
        type: 'info' as const
      }
    ];

    for (const notification of sampleNotifications) {
      await this.createNotification(notification);
    }
    console.log('✅ Sample notifications created');
  }

  // Xóa tất cả thông báo cũ ngay lập tức
  async clearAllOldNotifications(): Promise<void> {
    try {
      const notificationsRef = this.firestore.collection('notifications');
      const snapshot = await notificationsRef.ref.get();
      
      if (snapshot.docs.length > 0) {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`✅ Deleted all ${snapshot.docs.length} old notifications`);
      }
    } catch (error) {
      console.error('❌ Error clearing all notifications:', error);
    }
  }

  // Xóa tất cả thông báo user mới
  async clearAllNewUserNotifications(): Promise<void> {
    try {
      const notificationsRef = this.firestore.collection('new-user-notifications');
      const snapshot = await notificationsRef.ref.get();
      
      if (snapshot.docs.length > 0) {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`✅ Deleted all ${snapshot.docs.length} new user notifications`);
      }
    } catch (error) {
      console.error('❌ Error clearing new user notifications:', error);
    }
  }

  // Xóa tất cả thông báo (cả 2 loại)
  async clearAllNotifications(): Promise<void> {
    await this.clearAllOldNotifications();
    await this.clearAllNewUserNotifications();
    console.log('🎉 Cleared all notifications');
  }
} 