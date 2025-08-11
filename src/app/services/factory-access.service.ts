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
                if (data && data.factory) {
                  return this.calculateFactoryAccess(data.factory);
                } else {
                  // Nếu không có factory setting, cho phép truy cập cả 2 nhà máy
                  return {
                    canAccessASM1: true,
                    canAccessASM2: true,
                    defaultFactory: 'ASM1',
                    availableFactories: ['ASM1', 'ASM2']
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
  private calculateFactoryAccess(factory: string): FactoryAccess {
    switch (factory.toUpperCase()) {
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
      default:
        // Nếu không có factory setting hoặc factory rỗng, cho phép truy cập cả 2
        return {
          canAccessASM1: true,
          canAccessASM2: true,
          defaultFactory: 'ASM1',
          availableFactories: ['ASM1', 'ASM2']
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
}
