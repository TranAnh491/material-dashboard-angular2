import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface UserPermission {
  id?: string;
  employeeId: string;
  password: string;
  hasDeletePermission: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({
  providedIn: 'root'
})
export class PermissionService {

  constructor(private firestore: AngularFirestore) { }

  async getAllUserPermissions(): Promise<UserPermission[]> {
    try {
      const snapshot = await this.firestore
        .collection('local-user-permissions')
        .ref
        .orderBy('employeeId', 'asc')
        .get();

      const permissions: UserPermission[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as any;
        permissions.push({
          id: doc.id,
          employeeId: data.employeeId,
          password: data.password,
          hasDeletePermission: data.hasDeletePermission || false,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date()
        });
      });

      return permissions;
    } catch (error) {
      console.error('Error fetching user permissions:', error);
      return [];
    }
  }

  async getUserPermission(employeeId: string): Promise<UserPermission | null> {
    try {
      const snapshot = await this.firestore
        .collection('local-user-permissions')
        .ref
        .where('employeeId', '==', employeeId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      const data = doc.data() as any;
      
      return {
        id: doc.id,
        employeeId: data.employeeId,
        password: data.password,
        hasDeletePermission: data.hasDeletePermission || false,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      };
    } catch (error) {
      console.error('Error fetching user permission:', error);
      return null;
    }
  }

  async saveUserPermission(permission: UserPermission): Promise<void> {
    try {
      const data = {
        employeeId: permission.employeeId,
        password: permission.password,
        hasDeletePermission: permission.hasDeletePermission,
        createdAt: permission.createdAt,
        updatedAt: permission.updatedAt
      };

      await this.firestore.collection('local-user-permissions').add(data);
    } catch (error) {
      console.error('Error saving user permission:', error);
      throw error;
    }
  }

  async updateUserPermission(permission: UserPermission): Promise<void> {
    if (!permission.id) {
      throw new Error('Permission ID is required for update');
    }

    try {
      const data = {
        password: permission.password,
        hasDeletePermission: permission.hasDeletePermission,
        updatedAt: permission.updatedAt
      };

      await this.firestore.collection('local-user-permissions').doc(permission.id).update(data);
    } catch (error) {
      console.error('Error updating user permission:', error);
      throw error;
    }
  }

  async deleteUserPermission(employeeId: string): Promise<void> {
    try {
      const snapshot = await this.firestore
        .collection('local-user-permissions')
        .ref
        .where('employeeId', '==', employeeId)
        .get();

      const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
    } catch (error) {
      console.error('Error deleting user permission:', error);
      throw error;
    }
  }

  async validateUserCredentials(employeeId: string, password: string): Promise<boolean> {
    try {
      const user = await this.getUserPermission(employeeId);
      return user !== null && user.password === password && user.hasDeletePermission;
    } catch (error) {
      console.error('Error validating user credentials:', error);
      return false;
    }
  }

  async checkDeletePermission(employeeId: string): Promise<boolean> {
    try {
      const user = await this.getUserPermission(employeeId);
      return user !== null && user.hasDeletePermission;
    } catch (error) {
      console.error('Error checking delete permission:', error);
      return false;
    }
  }
} 