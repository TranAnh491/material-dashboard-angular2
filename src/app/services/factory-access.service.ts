import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface FactoryAccess {
  canAccessASM1: boolean;
  canAccessASM2: boolean;
  defaultFactory: string;
  availableFactories: string[];
}

@Injectable({
  providedIn: 'root'
})
export class FactoryAccessService {
  
  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth
  ) { }

  // Lấy thông tin quyền truy cập nhà máy của user hiện tại
  getCurrentUserFactoryAccess(): Observable<FactoryAccess> {
    return this.afAuth.authState.pipe(
      switchMap(user => {
        if (user) {
          return this.firestore
            .collection('users')
            .doc(user.uid)
            .valueChanges()
            .pipe(
              map((data: any) => {
                if (data && data.factory && data.factory.trim() !== '') {
                  return this.calculateFactoryAccess(data.factory, data.role);
                } else {
                  // Nếu không có factory setting, mặc định KHÔNG cho phép truy cập
                  // User cần được cấp quyền rõ ràng trong Settings
                  return {
                    canAccessASM1: false,
                    canAccessASM2: false,
                    defaultFactory: '',
                    availableFactories: []
                  };
                }
              })
            );
        } else {
          return of({
            canAccessASM1: false,
            canAccessASM2: false,
            defaultFactory: '',
            availableFactories: []
          });
        }
      })
    );
  }

  // Tính toán quyền truy cập nhà máy dựa trên factory setting
  private calculateFactoryAccess(factory: string, role?: string): FactoryAccess {
    // Admin và Quản lý có thể truy cập tất cả nhà máy
    if (role === 'Admin' || role === 'Quản lý') {
      return {
        canAccessASM1: true,
        canAccessASM2: true,
        defaultFactory: 'ASM1',
        availableFactories: ['ASM1', 'ASM2']
      };
    }

    // Users thường chỉ có thể truy cập nhà máy được chỉ định
    const factoryUpper = factory ? factory.toUpperCase().trim() : '';
    
    switch (factoryUpper) {
      case 'ASM1':
        return {
          canAccessASM1: true,
          canAccessASM2: false,
          defaultFactory: 'ASM1',
          availableFactories: ['ASM1']
        };
      case 'ASM2':
        return {
          canAccessASM1: false,
          canAccessASM2: true,
          defaultFactory: 'ASM2',
          availableFactories: ['ASM2']
        };
      case 'ALL':
        return {
          canAccessASM1: true,
          canAccessASM2: true,
          defaultFactory: 'ASM1',
          availableFactories: ['ASM1', 'ASM2']
        };
      case '':
      case null:
      case undefined:
      default:
        // Nếu không có factory setting hoặc factory rỗng, KHÔNG cho phép truy cập
        return {
          canAccessASM1: false,
          canAccessASM2: false,
          defaultFactory: '',
          availableFactories: []
        };
    }
  }

  // Kiểm tra user có thể truy cập nhà máy cụ thể không
  canAccessFactory(factory: string): Observable<boolean> {
    return this.getCurrentUserFactoryAccess().pipe(
      map(access => {
        const factoryUpper = factory.toUpperCase();
        if (factoryUpper === 'ASM1') {
          return access.canAccessASM1;
        } else if (factoryUpper === 'ASM2') {
          return access.canAccessASM2;
        }
        return false;
      })
    );
  }

  // Lấy nhà máy mặc định cho user
  getDefaultFactory(): Observable<string> {
    return this.getCurrentUserFactoryAccess().pipe(
      map(access => access.defaultFactory)
    );
  }

  // Lấy danh sách nhà máy có thể truy cập
  getAvailableFactories(): Observable<string[]> {
    return this.getCurrentUserFactoryAccess().pipe(
      map(access => access.availableFactories)
    );
  }

  // Kiểm tra xem user có quyền truy cập nhiều nhà máy không
  hasMultipleFactoryAccess(): Observable<boolean> {
    return this.getAvailableFactories().pipe(
      map(factories => factories.length > 1)
    );
  }

  // Kiểm tra user có thể chỉnh sửa dữ liệu của nhà máy cụ thể không
  canEditFactoryData(factory: string): Observable<boolean> {
    return this.getCurrentUserFactoryAccess().pipe(
      map(access => {
        const factoryUpper = factory.toUpperCase();
        
        // Admin và Quản lý có thể chỉnh sửa tất cả nhà máy
        if (access.availableFactories.length > 1) {
          return true;
        }
        
        // Users thường chỉ có thể chỉnh sửa nhà máy của họ
        return access.availableFactories.includes(factoryUpper);
      })
    );
  }

  // Kiểm tra user có thể xem dữ liệu của nhà máy cụ thể không
  canViewFactoryData(factory: string): Observable<boolean> {
    return this.getCurrentUserFactoryAccess().pipe(
      map(access => {
        const factoryUpper = factory.toUpperCase();
        return access.availableFactories.includes(factoryUpper);
      })
    );
  }

  // Lấy danh sách nhà máy mà user có thể chỉnh sửa
  getEditableFactories(): Observable<string[]> {
    return this.getCurrentUserFactoryAccess().pipe(
      map(access => access.availableFactories)
    );
  }

  // Lấy danh sách nhà máy mà user có thể xem
  getViewableFactories(): Observable<string[]> {
    return this.getCurrentUserFactoryAccess().pipe(
      map(access => access.availableFactories)
    );
  }
}
