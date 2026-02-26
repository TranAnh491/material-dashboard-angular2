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
                // Kiểm tra xem user có document trong user-tab-permissions chưa
                if (data && data.tabPermissions && typeof data.tabPermissions === 'object') {
                  // Nếu user có permissions được cấu hình cụ thể, sử dụng permissions đó
                  // KHÔNG tự động thêm Dashboard nữa - phải được cấp quyền rõ ràng
                  return of({ ...data.tabPermissions });
                } else {
                  // Nếu không có permissions được cấu hình, trả về TẤT CẢ false (không xem được gì)
                  // User mới đăng ký phải chờ admin duyệt trong Settings
                  console.log(`⚠️ No tab permissions found for user ${user.uid}, returning empty permissions (chờ duyệt)`);
                  return of({});
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
  // CHỈ tạo permissions tối thiểu - chỉ Dashboard, các tab khác phải được cấp quyền rõ ràng
  private generateDefaultPermissions(factoryAccess: any): { [key: string]: boolean } {
    // CHỈ cho phép Dashboard mặc định, các tab khác phải được cấp quyền trong Settings
    const basePermissions = {
      'dashboard': true, // Chỉ dashboard được phép mặc định
      // Tất cả các tab khác mặc định KHÔNG được phép (false hoặc không có trong object)
    };

    // Factory-specific permissions dựa trên quyền truy cập nhà máy
    // CHỈ cho phép khi có quyền truy cập RÕ RÀNG là true
    const factoryPermissions = {
      // Inbound tabs
      'inbound-asm1': factoryAccess.canAccessASM1 === true, // Chỉ cho phép khi TRUE rõ ràng
      'inbound-asm2': factoryAccess.canAccessASM2 === true, // Chỉ cho phép khi TRUE rõ ràng
      
      // Outbound tabs
      'outbound-asm1': factoryAccess.canAccessASM1 === true,
      'outbound-asm2': factoryAccess.canAccessASM2 === true,
      
      // Inventory tabs
      'materials-asm1': factoryAccess.canAccessASM1 === true,
      'materials-asm2': factoryAccess.canAccessASM2 === true,
      'inventory-overview-asm1': factoryAccess.canAccessASM1 === true,
      
      // Location tab - chỉ cho phép khi có quyền truy cập ASM1
      'location': factoryAccess.canAccessASM1 === true,
      
      // Safety tab - chỉ cho phép khi có quyền truy cập ít nhất một nhà máy
      'safety': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true
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
    { key: 'inventory-overview-asm2', name: 'RM2 Inventory Overview' },
    
    // ASM1 FG tabs
    { key: 'fg-in', name: 'FG In' },
    { key: 'fg-out', name: 'FG Out' },
    { key: 'fg-check', name: 'FG Check' },
    { key: 'fg-inventory', name: 'FG Inventory' },
    
    // Location tab
    { key: 'location', name: 'Location' },
    
    // Find RM1 tab
    { key: 'find-rm1', name: 'Find RM1' },
    
    // Warehouse Loading tab
    { key: 'warehouse-loading', name: 'Loading' },
    
    // Trace Back tab
    { key: 'trace-back', name: 'Trace Back' },
    
    // Manage tab
    { key: 'manage', name: 'Manage' },
    
    // Other tabs
    { key: 'stock-check', name: 'Stock Check' },
    { key: 'label', name: 'Label' },
    { key: 'index', name: 'Bonded Report' },
    { key: 'utilization', name: 'Utilization' },
    { key: 'checklist', name: 'Safety & Quality' },
    { key: 'safety', name: 'Safety Stock' },
    { key: 'equipment', name: 'Training' },
    { key: 'qc', name: 'Quality' },
    { key: 'wh-security', name: 'WH Security' },
    { key: 'rm1-delivery', name: 'RM1 Delivery' },
    { key: 'settings', name: 'Settings' }
  ];
} 