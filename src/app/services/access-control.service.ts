import { Injectable } from '@angular/core';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { TabPermissionService } from './tab-permission.service';
import { FactoryAccessService } from './factory-access.service';

@Injectable({
  providedIn: 'root'
})
export class AccessControlService {
  
  constructor(
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService
  ) { }

  // Kiểm tra user có thể truy cập tab cụ thể không
  canAccessTab(tabKey: string): Observable<boolean> {
    return combineLatest([
      this.tabPermissionService.getCurrentUserTabPermissions(),
      this.factoryAccessService.getCurrentUserFactoryAccess()
    ]).pipe(
      map(([permissions, factoryAccess]) => {
        // Kiểm tra tab permission trước
        if (permissions[tabKey] === false) {
          return false;
        }

        // Nếu có permission rõ ràng là true, cho phép
        if (permissions[tabKey] === true) {
          return true;
        }

        // Kiểm tra factory access cho các tab liên quan đến nhà máy
        if (this.isFactorySpecificTab(tabKey)) {
          return this.checkFactoryAccessForTab(tabKey, factoryAccess);
        }

        // Các tab khác - mặc định cho phép nếu không có restriction
        return true;
      })
    );
  }

  // Kiểm tra xem tab có liên quan đến nhà máy cụ thể không
  private isFactorySpecificTab(tabKey: string): boolean {
    const factoryTabs = [
      'inbound-asm1', 'inbound-asm2',
      'outbound-asm1', 'outbound-asm2',
      'materials-asm1', 'materials-asm2'
    ];
    return factoryTabs.includes(tabKey);
  }

  // Kiểm tra factory access cho tab cụ thể
  private checkFactoryAccessForTab(tabKey: string, factoryAccess: any): boolean {
    if (tabKey.includes('asm1')) {
      return factoryAccess.canAccessASM1;
    }
    if (tabKey.includes('asm2')) {
      return factoryAccess.canAccessASM2;
    }
    return false;
  }

  // Lấy danh sách tabs mà user có thể truy cập
  getAccessibleTabs(): Observable<string[]> {
    return this.tabPermissionService.getCurrentUserTabPermissions().pipe(
      map(permissions => {
        const accessibleTabs: string[] = [];
        
        Object.keys(permissions).forEach(tabKey => {
          if (permissions[tabKey] === true) {
            accessibleTabs.push(tabKey);
          }
        });
        
        return accessibleTabs;
      })
    );
  }

  // Kiểm tra user có quyền truy cập nhà máy nào
  getFactoryAccess(): Observable<any> {
    return this.factoryAccessService.getCurrentUserFactoryAccess();
  }
}
