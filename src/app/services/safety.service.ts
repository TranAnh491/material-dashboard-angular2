import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, from, firstValueFrom } from 'rxjs';
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
      scanDate: data.scanDate ? data.scanDate.toDate() : new Date(),
      materialCode: data.materialCode,
      materialName: data.materialName || '', // Tên hàng
      quantityASM1: data.quantityASM1 || 0,
      palletQuantityASM1: data.palletQuantityASM1 || 0, // Lượng pallet ASM1
      palletCountASM1: data.palletCountASM1 || 0, // Số pallet ASM1
      quantityASM2: data.quantityASM2 || 0,
      palletQuantityASM2: data.palletQuantityASM2 || 0, // Lượng pallet ASM2
      palletCountASM2: data.palletCountASM2 || 0, // Số pallet ASM2
      totalQuantity: data.totalQuantity || 0,
      totalPalletCount: data.totalPalletCount || 0, // Tổng số pallet
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
    
    // Tính toán số pallet và tổng số lượng
    const palletCountASM1 = material.palletQuantityASM1 > 0 ? Math.ceil((material.quantityASM1 || 0) / material.palletQuantityASM1) : 0;
    const palletCountASM2 = material.palletQuantityASM2 > 0 ? Math.ceil((material.quantityASM2 || 0) / material.palletQuantityASM2) : 0;
    const totalQuantity = (material.quantityASM1 || 0) + (material.quantityASM2 || 0);
    const totalPalletCount = palletCountASM1 + palletCountASM2;
    
    const newMaterial: SafetyMaterial = {
      ...material,
      id,
      palletCountASM1,
      palletCountASM2,
      totalQuantity,
      totalPalletCount,
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

  // Get safety materials by factory (no longer used, but kept for compatibility)
  getSafetyMaterialsByFactory(factory: string): Observable<SafetyMaterial[]> {
    // No longer filter by factory, return all materials
    return this.getSafetyMaterials();
  }

  // Initialize sample data
  async initializeSampleData(): Promise<void> {
    const today = new Date();
    const sampleData: Omit<SafetyMaterial, 'id'>[] = [
      {
        scanDate: today,
        materialCode: 'B018694',
        materialName: 'Vật liệu B018694',
        quantityASM1: 150,
        palletQuantityASM1: 50,
        palletCountASM1: 3,
        quantityASM2: 0,
        palletQuantityASM2: 0,
        palletCountASM2: 0,
        totalQuantity: 150,
        totalPalletCount: 3,
        safety: 0, // Sample safety level
        status: 'Active'
      },
      {
        scanDate: today,
        materialCode: 'R123456',
        materialName: 'Vật liệu R123456',
        quantityASM1: 200,
        palletQuantityASM1: 40,
        palletCountASM1: 5,
        quantityASM2: 0,
        palletQuantityASM2: 0,
        palletCountASM2: 0,
        totalQuantity: 200,
        totalPalletCount: 5,
        safety: 0, // Sample safety level
        status: 'Active'
      },
      {
        scanDate: today,
        materialCode: 'B789012',
        materialName: 'Vật liệu B789012',
        quantityASM1: 0,
        palletQuantityASM1: 0,
        palletCountASM1: 0,
        quantityASM2: 100,
        palletQuantityASM2: 25,
        palletCountASM2: 4,
        totalQuantity: 100,
        totalPalletCount: 4,
        safety: 0, // Sample safety level
        status: 'Pending'
      },
      {
        scanDate: today,
        materialCode: 'R345678',
        materialName: 'Vật liệu R345678',
        quantityASM1: 0,
        palletQuantityASM1: 0,
        palletCountASM1: 0,
        quantityASM2: 300,
        palletQuantityASM2: 60,
        palletCountASM2: 5,
        totalQuantity: 300,
        totalPalletCount: 5,
        safety: 0, // Sample safety level
        status: 'Active'
      },
      {
        scanDate: today,
        materialCode: 'B901234',
        materialName: 'Vật liệu B901234',
        quantityASM1: 125,
        palletQuantityASM1: 25,
        palletCountASM1: 5,
        quantityASM2: 125,
        palletQuantityASM2: 25,
        palletCountASM2: 5,
        totalQuantity: 250,
        totalPalletCount: 10,
        safety: 0, // Sample safety level
        status: 'Review'
      },
      {
        scanDate: today,
        materialCode: 'R567890',
        materialName: 'Vật liệu R567890',
        quantityASM1: 90,
        palletQuantityASM1: 30,
        palletCountASM1: 3,
        quantityASM2: 90,
        palletQuantityASM2: 30,
        palletCountASM2: 3,
        totalQuantity: 180,
        totalPalletCount: 6,
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

  // Migrate old data from factory-based structure to new structure
  async migrateOldData(): Promise<void> {
    console.log('🔄 Starting data migration...');
    
    try {
      // Get all materials from database
      const snapshot = await firstValueFrom(this.firestore.collection('safety').get());
      const materials = snapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as any)
      }));
      
      console.log(`📊 Found ${materials.length} materials to migrate`);
      
      // Group materials by materialCode
      const groupedMaterials = new Map<string, any[]>();
      
      materials.forEach(material => {
        const code = material.materialCode;
        if (!groupedMaterials.has(code)) {
          groupedMaterials.set(code, []);
        }
        groupedMaterials.get(code)!.push(material);
      });
      
      console.log(`📊 Grouped into ${groupedMaterials.size} unique material codes`);
      
      // Process each group
      for (const [materialCode, materialGroup] of groupedMaterials) {
        if (materialGroup.length === 1) {
          // Single material, just update structure
          const material = materialGroup[0];
          if (material.factory && !material.quantityASM1 && !material.quantityASM2) {
            // Old structure, migrate to new
            const updateData: any = {
              quantityASM1: material.factory === 'ASM1' ? (material.actualQuantity || 0) : 0,
              quantityASM2: material.factory === 'ASM2' ? (material.actualQuantity || 0) : 0,
              totalQuantity: material.actualQuantity || 0,
              updatedAt: new Date()
            };
            
            // Remove old fields
            delete updateData.factory;
            delete updateData.actualQuantity;
            
            await this.updateSafetyMaterial(material.id, updateData);
            console.log(`✅ Migrated single material: ${materialCode}`);
          }
        } else {
          // Multiple materials with same code, merge them
          console.log(`🔄 Merging ${materialGroup.length} materials for code: ${materialCode}`);
          
          let totalASM1 = 0;
          let totalASM2 = 0;
          let totalSafety = 0;
          let latestScanDate = new Date(0);
          let latestStatus = 'Active';
          
          // Calculate totals from all materials
          materialGroup.forEach(material => {
            if (material.factory === 'ASM1') {
              totalASM1 += material.actualQuantity || 0;
            } else if (material.factory === 'ASM2') {
              totalASM2 += material.actualQuantity || 0;
            }
            
            if (material.safety && material.safety > 0) {
              totalSafety = Math.max(totalSafety, material.safety);
            }
            
            const scanDate = material.scanDate ? new Date(material.scanDate) : new Date(0);
            if (scanDate > latestScanDate) {
              latestScanDate = scanDate;
              latestStatus = material.status || 'Active';
            }
          });
          
          // Create merged material
          const mergedMaterial: Omit<SafetyMaterial, 'id'> = {
            scanDate: latestScanDate,
            materialCode: materialCode,
            materialName: '', // Tên hàng - để trống, người dùng nhập sau
            quantityASM1: totalASM1,
            palletQuantityASM1: 0, // Lượng pallet ASM1 - để trống, người dùng nhập sau
            palletCountASM1: 0, // Số pallet ASM1 - tự tính
            quantityASM2: totalASM2,
            palletQuantityASM2: 0, // Lượng pallet ASM2 - để trống, người dùng nhập sau
            palletCountASM2: 0, // Số pallet ASM2 - tự tính
            totalQuantity: totalASM1 + totalASM2,
            totalPalletCount: 0, // Tổng số pallet - tự tính
            safety: totalSafety,
            status: latestStatus
          };
          
          // Delete all old materials
          for (const material of materialGroup) {
            await this.deleteSafetyMaterial(material.id);
          }
          
          // Add merged material
          await this.addSafetyMaterial(mergedMaterial);
          console.log(`✅ Merged ${materialGroup.length} materials into 1: ${materialCode}`);
        }
      }
      
      console.log('✅ Data migration completed successfully');
      
    } catch (error) {
      console.error('❌ Error during data migration:', error);
      throw error;
    }
  }
}
