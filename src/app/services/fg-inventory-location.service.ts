import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, map } from 'rxjs';

export interface FGInventoryLocation {
  materialCode: string;
  batchNumber: string;
  lsx: string;
  lot: string;
  location: string;
}

@Injectable({
  providedIn: 'root'
})
export class FGInventoryLocationService {

  constructor(private firestore: AngularFirestore) { }

  // Get location for a specific material, batch, lsx, lot
  getLocation(materialCode: string, batchNumber: string, lsx: string, lot: string): Observable<string> {
    return this.firestore.collection('fg-inventory', ref => 
      ref.where('materialCode', '==', materialCode)
         .where('batchNumber', '==', batchNumber)
         .where('lsx', '==', lsx)
         .where('lot', '==', lot)
         .limit(1)
    ).get().pipe(
      map(snapshot => {
        if (!snapshot.empty) {
          const data = snapshot.docs[0].data() as any;
          return data.location || 'N/A';
        }
        return 'N/A';
      })
    );
  }

  // Get all locations for a material
  getLocationsForMaterial(materialCode: string): Observable<FGInventoryLocation[]> {
    return this.firestore.collection('fg-inventory', ref => 
      ref.where('materialCode', '==', materialCode)
    ).snapshotChanges().pipe(
      map(actions => actions.map(action => ({
        materialCode: action.payload.doc.data()['materialCode'],
        batchNumber: action.payload.doc.data()['batchNumber'],
        lsx: action.payload.doc.data()['lsx'],
        lot: action.payload.doc.data()['lot'],
        location: action.payload.doc.data()['location'] || 'N/A'
      })))
    );
  }
}
