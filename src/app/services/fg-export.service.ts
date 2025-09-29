import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, map } from 'rxjs';

export interface FgExportItem {
  id?: string;
  materialCode: string;
  batchNumber: string;
  lsx: string;
  lot: string;
  quantity: number;
  shipment: string;
  pushNo: string;
  approvedBy: string;
  approvedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({
  providedIn: 'root'
})
export class FgExportService {

  constructor(private firestore: AngularFirestore) { }

  // Get total export quantity for a specific material, batch, lsx, lot
  getTotalExportQuantity(materialCode: string, batchNumber: string, lsx: string, lot: string): Observable<number> {
    return this.firestore.collection('fg-export', ref => 
      ref.where('materialCode', '==', materialCode)
         .where('batchNumber', '==', batchNumber)
         .where('lsx', '==', lsx)
         .where('lot', '==', lot)
    ).get().pipe(
      map(snapshot => {
        let total = 0;
        snapshot.docs.forEach(doc => {
          const data = doc.data() as FgExportItem;
          total += data.quantity || 0;
        });
        return total;
      })
    );
  }

  // Get all export records for a material
  getExportRecords(materialCode: string): Observable<FgExportItem[]> {
    return this.firestore.collection('fg-export', ref => 
      ref.where('materialCode', '==', materialCode)
    ).snapshotChanges().pipe(
      map(actions => actions.map(action => ({
        id: action.payload.doc.id,
        ...action.payload.doc.data() as FgExportItem
      })))
    );
  }

  // Get export records by shipment
  getExportRecordsByShipment(shipment: string): Observable<FgExportItem[]> {
    return this.firestore.collection('fg-export', ref => 
      ref.where('shipment', '==', shipment)
    ).snapshotChanges().pipe(
      map(actions => actions.map(action => ({
        id: action.payload.doc.id,
        ...action.payload.doc.data() as FgExportItem
      })))
    );
  }

  // Get all export records
  getAllExportRecords(): Observable<FgExportItem[]> {
    return this.firestore.collection('fg-export').snapshotChanges().pipe(
      map(actions => actions.map(action => ({
        id: action.payload.doc.id,
        ...action.payload.doc.data() as FgExportItem
      })))
    );
  }
}
