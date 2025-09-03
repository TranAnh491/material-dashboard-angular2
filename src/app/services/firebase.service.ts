import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';

export interface FgInItem {
  id: string;
  batch: number;
  factory: string;
  no: number;
  ngayNhap: Date;
  maTP: string;
  rev: string;
  lsx: string;
  lot: string;
  luongNhap: number;
  packing: string;
  luongThung: number;
  thungLe: number;
  ghiChu: string;
  daNhan: boolean;
  khach: string;
  viTri: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FGInventoryItem {
  id: string;
  batch: number;
  factory: string;
  no: number;
  ngayNhap: Date;
  maTP: string;
  rev: string;
  lsx: string;
  lot: string;
  luongNhap: number;
  packing: string;
  luongThung: number;
  thungLe: number;
  ghiChu: string;
  khach: string;
  viTri: string;
  ngayNhapKho: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {

  constructor(private firestore: AngularFirestore) { }

  // ===== FG IN OPERATIONS =====
  
  // Get all FG In items
  getFgInItems(): Observable<FgInItem[]> {
    return this.firestore.collection<FgInItem>('fg-in', ref => 
      ref.orderBy('createdAt', 'desc')
    ).valueChanges();
  }

  // Add new FG In item
  addFgInItem(item: FgInItem): Promise<void> {
    const id = this.firestore.createId();
    const newItem = {
      ...item,
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return this.firestore.collection('fg-in').doc(id).set(newItem);
  }

  // Update FG In item
  updateFgInItem(item: FgInItem): Promise<void> {
    const updateData = {
      ...item,
      updatedAt: new Date()
    };
    return this.firestore.collection('fg-in').doc(item.id).update(updateData);
  }

  // Delete FG In item
  deleteFgInItem(id: string): Promise<void> {
    return this.firestore.collection('fg-in').doc(id).delete();
  }

  // ===== FG INVENTORY OPERATIONS =====
  
  // Get all FG Inventory items
  getFGInventoryItems(): Observable<FGInventoryItem[]> {
    return this.firestore.collection<FGInventoryItem>('fg-inventory', ref => 
      ref.orderBy('createdAt', 'desc')
    ).valueChanges();
  }

  // Add new FG Inventory item
  addFGInventoryItem(item: FGInventoryItem): Promise<void> {
    const id = this.firestore.createId();
    const newItem = {
      ...item,
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return this.firestore.collection('fg-inventory').doc(id).set(newItem);
  }

  // Update FG Inventory item
  updateFGInventoryItem(item: FGInventoryItem): Promise<void> {
    const updateData = {
      ...item,
      updatedAt: new Date()
    };
    return this.firestore.collection('fg-inventory').doc(item.id).update(updateData);
  }

  // Delete FG Inventory item
  deleteFGInventoryItem(id: string): Promise<void> {
    return this.firestore.collection('fg-inventory').doc(id).delete();
  }

  // ===== UTILITY METHODS =====
  
  // Check if item exists in FG Inventory
  async checkItemExistsInInventory(maTP: string, lot: string): Promise<boolean> {
    const snapshot = await this.firestore.collection('fg-inventory', ref => 
      ref.where('maTP', '==', maTP).where('lot', '==', lot)
    ).get().toPromise();
    
    return !snapshot.empty;
  }

  // Get item by ID
  getFgInItemById(id: string): Observable<FgInItem | undefined> {
    return this.firestore.collection('fg-in').doc(id).valueChanges() as Observable<FgInItem | undefined>;
  }

  // Get FG Inventory item by ID
  getFGInventoryItemById(id: string): Observable<FGInventoryItem | undefined> {
    return this.firestore.collection('fg-inventory').doc(id).valueChanges() as Observable<FGInventoryItem | undefined>;
  }
}
