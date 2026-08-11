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

  // Lấy quyền truy cập tab của user hiện tại (chỉ từ user-tab-permissions — cấp trong Settings)
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
                if (data && data.tabPermissions && typeof data.tabPermissions === 'object') {
                  return of({ ...data.tabPermissions });
                }
                console.log(
                  `⚠️ No tab permissions found for user ${user.uid}, returning empty permissions (chờ duyệt)`
                );
                return of({});
              })
            );
        }
        return of({});
      })
    );
  }

  // Tạo default permissions dựa trên factory access
  // CHỈ tạo permissions tối thiểu - chỉ Dashboard, các tab khác phải được cấp quyền rõ ràng
  private generateDefaultPermissions(factoryAccess: any): { [key: string]: boolean } {
    // CHỈ cho phép Dashboard mặc định, các tab khác phải được cấp quyền trong Settings
    const basePermissions = {
      'dashboard': true,
      // Tất cả các tab khác mặc định KHÔNG được phép (false hoặc không có trong object)
    };

    // Factory-specific permissions dựa trên quyền truy cập nhà máy
    // CHỈ cho phép khi có quyền truy cập RÕ RÀNG là true
    const factoryPermissions = {
      // Inbound tab — trang gộp dùng chung ASM1 + ASM2
      'inbound': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,
      'danh-muc-nvl-tp': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,
      
      // Outbound tab — trang gộp dùng chung ASM1 + ASM2
      'outbound': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,

      // Inventory (Materials) tab — trang gộp dùng chung ASM1 + ASM2
      'materials': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,
      // Inventory Overview tab — trang gộp dùng chung ASM1 + ASM2
      'inventory-overview': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,
      'bag-history': factoryAccess.canAccessASM1 === true,
      
      // Location tab - chỉ cho phép khi có quyền truy cập ASM1
      'location': factoryAccess.canAccessASM1 === true,
      'layout-warehouse': factoryAccess.canAccessASM1 === true,
      'layout-warehouse-asm3': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,
      'j-warehouse': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,
      
      // Materials Dashboard - cần quyền ít nhất 1 nhà máy
      'materials-dashboard': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true,
      'fgs-dashboard': factoryAccess.canAccessASM1 === true || factoryAccess.canAccessASM2 === true
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
    { key: 'materials-dashboard', name: 'Materials Dashboard' },
    { key: 'fgs-dashboard', name: 'FGs Dashboard' },
    { key: 'work-order-status', name: 'Work Order' },
    { key: 'shipment', name: 'Shipment' },
    
    // Inbound tab (gộp ASM1 + ASM2)
    { key: 'inbound', name: 'RM Inbound' },

    // Outbound tab (gộp ASM1 + ASM2)
    { key: 'outbound', name: 'RM Outbound' },


    // Inventory (Materials) tab (gộp ASM1 + ASM2)
    { key: 'materials', name: 'RM Inventory' },
    // Inventory Overview tab (gộp ASM1 + ASM2)
    { key: 'inventory-overview', name: 'RM Inventory Overview' },
    { key: 'bag-history', name: 'Control Batch' },
    
    // ASM FG tabs
    { key: 'fg-in', name: 'FG In' },
    { key: 'fg-out', name: 'FG Out' },
    { key: 'fg-check', name: 'FG Check' },
    { key: 'fg-inventory', name: 'FG Inventory' },
    { key: 'fg-overview', name: 'FG Overview' },
    { key: 'fg-location', name: 'FG Location' },
    
    // Location tab
    { key: 'location', name: 'Materials' },
    { key: 'layout-warehouse', name: 'Layout Warehouse' },
    { key: 'layout-warehouse-asm3', name: 'Layout Warehouse ASM3' },
    { key: 'j-warehouse', name: 'J Warehouse' },

    // Other tabs
    { key: 'stock-check', name: 'Stock Check' },
    { key: 'bieu-mau', name: 'Biểu mẫu' },
    { key: 'label', name: 'Label' },
    { key: 'index', name: 'Bonded Report' },
    { key: 'sxxk', name: 'SXXK' },
    { key: 'scrap', name: 'SCRAP' },
    { key: 'checklist', name: 'Safety & Quality' },
    { key: 'equipment', name: 'Training' },
    { key: 'qc', name: 'Quality' },
    { key: 'nhiet-do', name: 'Nhiệt Độ' },
    { key: 'rm1-delivery', name: 'RM Delivery' },
    { key: 'report', name: 'Report' },
    { key: 'shorted-materials', name: 'Shorted materials' },
    { key: 'settings', name: 'Settings' }
  ];
} 