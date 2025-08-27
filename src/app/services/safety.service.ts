import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { SafetyMaterial } from '../pages/safety/safety.component';

@Injectable({
  providedIn: 'root'
})
export class SafetyService {

  constructor(private firestore: AngularFirestore) { }

  // Helper method to convert Firestore data to SafetyMaterial
  private convertFirestoreData(data: any, id: string): SafetyMaterial {
    return {
      id,
      factory: data.factory,
      scanDate: data.scanDate ? data.scanDate.toDate() : new Date(),
      materialCode: data.materialCode,
      actualQuantity: data.actualQuantity || 0,
      safety: data.safety && data.safety > 0 ? data.safety : 0, // Only use safety if > 0, otherwise 0
      status: data.status || 'Active',
      createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
      updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date()
    };
  }

  // Get all safety materials
  getSafetyMaterials(): Observable<SafetyMaterial[]> {
    return this.firestore.collection('safety').snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as any;
        const id = a.payload.doc.id;
        return this.convertFirestoreData(data, id);
      }))
    );
  }

  // Get safety material by ID
  getSafetyMaterial(id: string): Observable<SafetyMaterial | undefined> {
    return this.firestore.doc<SafetyMaterial>(`safety/${id}`).valueChanges();
  }

  // Add new safety material
  addSafetyMaterial(material: Omit<SafetyMaterial, 'id'>): Promise<void> {
    const id = this.firestore.createId();
    const newMaterial: SafetyMaterial = {
      ...material,
      id,
      safety: material.safety && material.safety > 0 ? material.safety : 0, // Ensure safety is 0 if not positive
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return this.firestore.doc(`safety/${id}`).set(newMaterial);
  }

  // Update safety material
  updateSafetyMaterial(id: string, material: Partial<SafetyMaterial>): Promise<void> {
    const updateData = {
      ...material,
      updatedAt: new Date()
    };
    
    console.log(`🔄 Updating safety material ${id}:`, updateData);
    
    return this.firestore.doc(`safety/${id}`).update(updateData)
      .then(() => {
        console.log(`✅ Successfully updated safety material ${id}`);
      })
      .catch((error) => {
        console.error(`❌ Error updating safety material ${id}:`, error);
        throw error;
      });
  }

  // Delete safety material
  deleteSafetyMaterial(id: string): Promise<void> {
    return this.firestore.doc(`safety/${id}`).delete();
  }

  // Search safety materials
  searchSafetyMaterials(query: string): Observable<SafetyMaterial[]> {
    return this.firestore.collection('safety', ref => 
      ref.where('materialCode', '>=', query)
         .where('materialCode', '<=', query + '\uf8ff')
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as any;
        const id = a.payload.doc.id;
        return this.convertFirestoreData(data, id);
      }))
    );
  }

  // Get safety materials by factory
  getSafetyMaterialsByFactory(factory: string): Observable<SafetyMaterial[]> {
    if (factory === 'ALL') {
      return this.getSafetyMaterials();
    }
    
    return this.firestore.collection('safety', ref => 
      ref.where('factory', '==', factory)
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as any;
        const id = a.payload.doc.id;
        return this.convertFirestoreData(data, id);
      }))
    );
  }

  // Initialize sample data
  async initializeSampleData(): Promise<void> {
    const today = new Date();
    const sampleData: Omit<SafetyMaterial, 'id'>[] = [
      {
        factory: 'ASM1',
        scanDate: today,
        materialCode: 'B018694',
        actualQuantity: 150,
        safety: 0, // Sample safety level
        status: 'Active'
      },
      {
        factory: 'ASM1',
        scanDate: today,
        materialCode: 'R123456',
        actualQuantity: 200,
        safety: 0, // Sample safety level
        status: 'Active'
      },
      {
        factory: 'ASM2',
        scanDate: today,
        materialCode: 'B789012',
        actualQuantity: 100,
        safety: 0, // Sample safety level
        status: 'Pending'
      },
      {
        factory: 'ASM2',
        scanDate: today,
        materialCode: 'R345678',
        actualQuantity: 300,
        safety: 0, // Sample safety level
        status: 'Active'
      },
      {
        factory: 'FGS',
        scanDate: today,
        materialCode: 'B901234',
        actualQuantity: 250,
        safety: 0, // Sample safety level
        status: 'Review'
      },
      {
        factory: 'FGS',
        scanDate: today,
        materialCode: 'R567890',
        actualQuantity: 180,
        safety: 0, // Sample safety level
        status: 'Active'
      }
    ];

    try {
      for (const material of sampleData) {
        await this.addSafetyMaterial(material);
      }
      console.log('Sample safety data initialized successfully');
    } catch (error) {
      console.error('Error initializing sample safety data:', error);
    }
  }
}
