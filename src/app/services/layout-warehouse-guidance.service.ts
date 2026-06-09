import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

export interface LocationGuidanceDoc {
  location?: string;
  guidance?: string;
  updatedAt?: { toDate?: () => Date } | Date;
  updatedBy?: string;
}

@Injectable({ providedIn: 'root' })
export class LayoutWarehouseGuidanceService {
  private readonly rootCollection = 'layout-warehouse-guidance';

  constructor(private firestore: AngularFirestore) {}

  toDocId(location: string): string {
    return String(location || '').trim().replace(/\//g, '_');
  }

  watchGuidance(factory: string, location: string): Observable<LocationGuidanceDoc | null> {
    const id = this.toDocId(location);
    if (!id) return of(null);
    return this.firestore
      .collection(this.rootCollection)
      .doc(factory)
      .collection<LocationGuidanceDoc>('locations')
      .doc(id)
      .valueChanges()
      .pipe(map(data => data ?? null));
  }

  async saveGuidance(
    factory: string,
    location: string,
    guidance: string,
    updatedBy: string
  ): Promise<void> {
    const id = this.toDocId(location);
    const trimmedLoc = String(location || '').trim();
    await this.firestore
      .collection(this.rootCollection)
      .doc(factory)
      .collection('locations')
      .doc(id)
      .set(
        {
          location: trimmedLoc,
          guidance: String(guidance || '').trim(),
          updatedAt: new Date(),
          updatedBy
        },
        { merge: true }
      );
  }
}
