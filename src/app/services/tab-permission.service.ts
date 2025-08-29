import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { FactoryAccessService } from './factory-access.service';

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
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService
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
              switchMap((data: any) => {
                if (data && data.tabPermissions) {
                  // Nếu user có permissions được cấu hình cụ thể, sử dụng permissions đó
                  return of(data.tabPermissions);
                } else {
                  // Nếu không có permissions được cấu hình, tạo permissions dựa trên factory access
                  return this.factoryAccessService.getCurrentUserFactoryAccess().pipe(
                    map(factoryAccess => this.generateDefaultPermissions(factoryAccess))
                  );
                }
              })
            );
        } else {
          return of({});
        }
      })
    );
  }

  // Tạo default permissions dựa trên factory access
  private generateDefaultPermissions(factoryAccess: any): { [key: string]: boolean } {
    const basePermissions = {
      // Main tabs - luôn cho phép
      'dashboard': true,
      'work-order-status': true,
      'shipment': true,
      
      // Manage Inventory tab - luôn cho phép
      'manage-inventory': true,
      
      // Other tabs - luôn cho phép
      'fg': true,
      'label': true,
      'chart': true,
      'index': true,
      'utilization': true,
      'find': true,
      'layout': true,
      'checklist': true,
      'safety': true,
      'equipment': true,
      'task': true,
      'settings': true,
      
      // Legacy permissions for backward compatibility
      'materials': true,
      
      // Operation-specific permissions - mặc định cho phép
      'inventory-delete': true,
      'inventory-export': true,
      'inventory-edit-hsd': true,
      'inbound-add': true,
      'inbound-edit': true,
      'inbound-delete': true,
      'inbound-generate-qr': true,
      'inbound-export': true
    };

    // Factory-specific permissions dựa trên quyền truy cập nhà máy
    // Nếu user có quyền truy cập nhà máy, cho phép truy cập tabs tương ứng
    const factoryPermissions = {
      // Inbound tabs
      'inbound-asm1': factoryAccess.canAccessASM1 !== false, // Cho phép nếu không bị chặn rõ ràng
      'inbound-asm2': factoryAccess.canAccessASM2 !== false, // Cho phép nếu không bị chặn rõ ràng
      
      // Outbound tabs
      'outbound-asm1': factoryAccess.canAccessASM1 !== false,
      'outbound-asm2': factoryAccess.canAccessASM2 !== false,
      
      // Inventory tabs
      'materials-asm1': factoryAccess.canAccessASM1 !== false,
      'materials-asm2': factoryAccess.canAccessASM2 !== false,
      'inventory-overview-asm1': factoryAccess.canAccessASM1 !== false,
      
      // Location tab - cho phép truy cập nếu có quyền truy cập ASM1
      'location': factoryAccess.canAccessASM1 !== false,
      
      // Safety tab - cho phép truy cập nếu có quyền truy cập bất kỳ nhà máy nào
      'safety': factoryAccess.canAccessASM1 !== false || factoryAccess.canAccessASM2 !== false
    };

    return { ...basePermissions, ...factoryPermissions };
  }

  // Kiểm tra user có quyền truy cập tab không
  canAccessTab(tabKey: string): Observable<boolean> {
    return this.getCurrentUserTabPermissions().pipe(
      map(permissions => {
        // Chỉ cho phép truy cập nếu có permission rõ ràng là true
        return permissions[tabKey] === true;
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

  // Available tabs for permissions - đồng bộ với sidebar routes hiện tại
  availableTabs = [
    // Main tabs
    { key: 'dashboard', name: 'Dashboard' },
    { key: 'work-order-status', name: 'Work Order' },
    { key: 'shipment', name: 'Shipment' },
    
    // Inbound tabs
    { key: 'inbound-asm1', name: 'RM1 Inbound' },
    { key: 'inbound-asm2', name: 'RM2 Inbound' },
    
    // Outbound tabs
    { key: 'outbound-asm1', name: 'RM1 Outbound' },
    { key: 'outbound-asm2', name: 'RM2 Outbound' },
    
    // Inventory tabs
    { key: 'materials-asm1', name: 'RM1 Inventory' },
    { key: 'materials-asm2', name: 'RM2 Inventory' },
    { key: 'inventory-overview-asm1', name: 'RM1 Inventory Overview' },
    
    // Location tab
    { key: 'location', name: 'Location' },
    
    // Manage Inventory tab
    { key: 'manage-inventory', name: 'Manage Inventory' },
    
    // Other tabs
    { key: 'fg', name: 'Finished Goods' },
    { key: 'label', name: 'Label' },
    { key: 'chart', name: 'Chart' },
    { key: 'index', name: 'Bonded Report' },
    { key: 'utilization', name: 'Utilization' },
    { key: 'find', name: 'Find' },
    { key: 'layout', name: 'Layout' },
    { key: 'checklist', name: 'Safety & Quality' },
    { key: 'safety', name: 'Safety' },
    { key: 'equipment', name: 'Training' },
    { key: 'task', name: 'Flow Work' },
    { key: 'settings', name: 'Settings' }
  ];
} 