import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

export interface UserPermission {
  uid: string;
  email: string;
  displayName?: string;
  hasDeletePermission: boolean;
  hasCompletePermission: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({
  providedIn: 'root'
})
export class UserPermissionService {

  constructor(private firestore: AngularFirestore) { }

  // Get all user permissions
  getUserPermissions(): Observable<UserPermission[]> {
    return this.firestore
      .collection('user-permissions')
      .valueChanges()
      .pipe(
        map((permissions: any[]) => 
          permissions.map(p => ({
            ...p,
            createdAt: p.createdAt?.toDate(),
            updatedAt: p.updatedAt?.toDate()
          }))
        )
      );
  }

  // Get permission for specific user
  getUserPermission(uid: string): Observable<UserPermission | null> {
    return this.firestore
      .collection('user-permissions')
      .doc(uid)
      .valueChanges()
      .pipe(
        map((permission: any) => 
          permission ? {
            ...permission,
            createdAt: permission.createdAt?.toDate(),
            updatedAt: permission.updatedAt?.toDate()
          } : null
        )
      );
  }

  // Create or update user permission
  async setUserPermission(uid: string, email: string, displayName: string, hasDeletePermission: boolean, hasCompletePermission: boolean = false): Promise<void> {
    const permission: UserPermission = {
      uid,
      email,
      displayName,
      hasDeletePermission,
      hasCompletePermission,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.firestore
      .collection('user-permissions')
      .doc(uid)
      .set(permission);
  }

  // Update permission only
  async updatePermission(uid: string, hasDeletePermission: boolean, hasCompletePermission: boolean = false): Promise<void> {
    await this.firestore
      .collection('user-permissions')
      .doc(uid)
      .update({
        hasDeletePermission,
        hasCompletePermission,
        updatedAt: new Date()
      });
  }

  // Delete user permission
  async deleteUserPermission(uid: string): Promise<void> {
    await this.firestore
      .collection('user-permissions')
      .doc(uid)
      .delete();
  }

  // Batch update multiple permissions
  async batchUpdatePermissions(permissions: { uid: string; hasDeletePermission: boolean; hasCompletePermission: boolean }[]): Promise<void> {
    const batch = this.firestore.firestore.batch();
    
    permissions.forEach(({ uid, hasDeletePermission, hasCompletePermission }) => {
      const docRef = this.firestore.collection('user-permissions').doc(uid).ref;
      batch.update(docRef, {
        hasDeletePermission,
        hasCompletePermission,
        updatedAt: new Date()
      });
    });

    await batch.commit();
  }

  // Check if user has delete permission
  async hasDeletePermission(uid: string): Promise<boolean> {
    try {
      const doc = await this.firestore
        .collection('user-permissions')
        .doc(uid)
        .ref
        .get();
      
      if (doc.exists) {
        const data = doc.data() as any;
        return data?.hasDeletePermission || false;
      }
      return false;
    } catch (error) {
      console.error('Error checking delete permission:', error);
      return false;
    }
  }

  // Check if user has complete permission
  async hasCompletePermission(uid: string): Promise<boolean> {
    try {
      const doc = await this.firestore
        .collection('user-permissions')
        .doc(uid)
        .ref
        .get();
      
      if (doc.exists) {
        const data = doc.data() as any;
        return data?.hasCompletePermission || false;
      }
      return false;
    } catch (error) {
      console.error('Error checking complete permission:', error);
      return false;
    }
  }
} 