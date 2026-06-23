import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

/** Chỉ hiển thị lô nhập từ ngày này trở đi (15 Jun 2026). */
export const INBOUND_TBHD_CHECK_FROM_DATE = new Date(2026, 5, 15, 0, 0, 0, 0);

@Injectable({ providedIn: 'root' })
export class InboundTbhdCheckService {
  private readonly collectionName = 'inbound-tbhd-ack';

  constructor(private firestore: AngularFirestore) {}

  isOnOrAfterCheckFromDate(d: Date | null | undefined): boolean {
    if (!d || Number.isNaN(d.getTime())) return false;
    return d.getTime() >= INBOUND_TBHD_CHECK_FROM_DATE.getTime();
  }

  private docId(factory: string, batchNumber: string): string {
    const f = String(factory || '').trim().toUpperCase();
    const b = String(batchNumber || '').trim();
    return `${f}__${encodeURIComponent(b)}`;
  }

  async loadAcknowledgedSet(factory: string): Promise<Set<string>> {
    const f = String(factory || '').trim().toUpperCase();
    const set = new Set<string>();
    try {
      const snap = await this.firestore
        .collection(this.collectionName, ref => ref.where('factory', '==', f).where('acknowledged', '==', true))
        .get()
        .toPromise();
      snap?.forEach(doc => {
        const bn = String((doc.data() as Record<string, unknown>)['batchNumber'] ?? '').trim();
        if (bn) set.add(bn);
      });
    } catch (e) {
      console.warn('[InboundTbhdCheck] load failed', e);
    }
    return set;
  }

  async setAcknowledged(factory: string, batchNumber: string, acknowledged: boolean): Promise<void> {
    const f = String(factory || '').trim().toUpperCase();
    const bn = String(batchNumber || '').trim();
    if (!f || !bn) return;

    await this.firestore
      .collection(this.collectionName)
      .doc(this.docId(f, bn))
      .set(
        {
          factory: f,
          batchNumber: bn,
          acknowledged,
          acknowledgedAt: acknowledged ? firebase.firestore.FieldValue.serverTimestamp() : null
        },
        { merge: true }
      );
  }
}
