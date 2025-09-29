import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, map } from 'rxjs';

export interface FgInItem {
  id?: string;
  materialCode: string;
  batchNumber: string;
  lsx: string;
  lot: string;
  quantity: number;
  receivedDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({
  providedIn: 'root'
})
export class FgInService {

  constructor(private firestore: AngularFirestore) { }

  // Get total import quantity for a specific material, batch, lsx, lot
  getTotalImportQuantity(materialCode: string, batchNumber: string, lsx: string, lot: string): Observable<number> {
    return this.firestore.collection('fg-in', ref => 
      ref.where('materialCode', '==', materialCode)
         .where('batchNumber', '==', batchNumber)
         .where('lsx', '==', lsx)
         .where('lot', '==', lot)
    ).get().pipe(
      map(snapshot => {
        let total = 0;
        snapshot.docs.forEach(doc => {
          const data = doc.data() as FgInItem;
          total += data.quantity || 0;
        });
        return total;
      })
    );
  }

  // Get all import records for a material
  getImportRecords(materialCode: string): Observable<FgInItem[]> {
    return this.firestore.collection('fg-in', ref => 
      ref.where('materialCode', '==', materialCode)
    ).snapshotChanges().pipe(
      map(actions => actions.map(action => ({
        id: action.payload.doc.id,
        ...action.payload.doc.data() as FgInItem
      })))
    );
  }

  // Get all import records
  getAllImportRecords(): Observable<FgInItem[]> {
    return this.firestore.collection('fg-in').snapshotChanges().pipe(
      map(actions => actions.map(action => ({
        id: action.payload.doc.id,
        ...action.payload.doc.data() as FgInItem
      })))
    );
  }
}
