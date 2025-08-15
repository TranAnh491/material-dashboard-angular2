import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface TabPermission {
  uid: string;
  email: string;
  displayName?: string;
  tabPermissions: { [key: string]: boolean };
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class TabPermissionService {
  
  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth
  ) { }

  // Lấy quyền truy cập tab của user hiện tại
  getCurrentUserTabPermissions(): Observable<{ [key: string]: boolean }> {
    return this.afAuth.authState.pipe(
      switchMap(user => {
        if (user) {
          return this.firestore
            .collection('user-tab-permissions')
            .doc(user.uid)
            .valueChanges()
            .pipe(
              map((data: any) => {
                if (data && data.tabPermissions) {
                  return data.tabPermissions;
                } else {
                  // Default: tất cả tab mẹ đều accessible (chỉ hiện tab mẹ)
                  return {
                    // Main tabs
                    'dashboard': true,
                    'work-order-status': true,
                    'shipment': true,
                    
                    // Inbound tabs
                    'inbound-asm1': true,
                    'inbound-asm2': true,
                    
                    // Outbound tabs
                    'outbound-asm1': true,
                    'outbound-asm2': true,
                    
                    // Inventory tabs
                    'materials-asm1': true,
                    'materials-asm2': true,
                
                    
                    // Other tabs
                    'fg': true,
                    'label': true,
                    'index': true,
                    'utilization': true,
                    'find': true,
                    'layout': true,
                    'checklist': true,
                    'equipment': true,
                    'task': true,
                    'settings': true,
                    
                    // Legacy permissions for backward compatibility
                    'materials': true,
                    
                    // Operation-specific permissions
                    'inventory-delete': true,
                    'inventory-export': true,
                    'inventory-edit-hsd': true,
                    
                    'inbound-add': true,
                    'inbound-edit': true,
                    'inbound-delete': true,
                    'inbound-generate-qr': true,
                    'inbound-export': true
                  };
                }
              })
            );
        } else {
          return of({});
        }
      })
    );
  }

  // Kiểm tra user có quyền truy cập tab không
  canAccessTab(tabKey: string): Observable<boolean> {
    return this.getCurrentUserTabPermissions().pipe(
      map(permissions => {
        // Nếu không có permission cho tab này, mặc định cho phép truy cập
        return permissions[tabKey] !== false;
      })
    );
  }

  // Lưu quyền truy cập tab cho user
  async saveUserTabPermissions(userId: string, tabPermissions: { [key: string]: boolean }): Promise<void> {
    try {
      const user = await this.afAuth.currentUser;
      if (user) {
        await this.firestore
          .collection('user-tab-permissions')
          .doc(userId)
          .set({
            uid: userId,
            email: user.email,
            displayName: user.displayName || '',
            tabPermissions: tabPermissions,
            createdAt: new Date(),
            updatedAt: new Date()
          }, { merge: true });
        
        console.log(`✅ Tab permissions saved for user ${userId}`);
      }
    } catch (error) {
      console.error('❌ Error saving tab permissions:', error);
      throw error;
    }
  }

  // Lấy tất cả quyền truy cập tab
  getAllUserTabPermissions(): Observable<TabPermission[]> {
    return this.firestore
      .collection('user-tab-permissions')
      .valueChanges()
      .pipe(
        map((data: any[]) => {
          return data.map(item => ({
            uid: item.uid,
            email: item.email,
            displayName: item.displayName,
            tabPermissions: item.tabPermissions || {},
            createdAt: item.createdAt?.toDate(),
            updatedAt: item.updatedAt?.toDate()
          }));
        })
      );
  }
} 