import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import {
  CustomerCodeEntry,
  getCustomerCodePrefix,
  normalizeCustomerName
} from '../pages/fg-inventory/fg-customer-code.util';

const COLLECTION = 'fg-customer-label-codes';

@Injectable({ providedIn: 'root' })
export class FgCustomerLabelCodeService {
  private entries: CustomerCodeEntry[] = [];
  private loaded = false;

  constructor(private firestore: AngularFirestore) {}

  getCatalog(): CustomerCodeEntry[] {
    return [...this.entries];
  }

  getCode(customer: string): string {
    const key = normalizeCustomerName(customer);
    return this.entries.find((e) => normalizeCustomerName(e.customer) === key)?.code || '';
  }

  /** Tải registry từ Firestore (một lần mỗi phiên). */
  async loadRegistry(): Promise<void> {
    if (this.loaded) return;
    const snap = await this.firestore.collection(COLLECTION).get().toPromise();
    this.entries = (snap?.docs || [])
      .map((doc) => {
        const d = doc.data() as any;
        return {
          customer: String(d.customer || '').trim(),
          prefix: String(d.prefix || '').trim(),
          code: String(d.code || '').trim(),
          seq: Number(d.seq) || 0
        } as CustomerCodeEntry;
      })
      .filter((e) => e.customer && e.code);
    this.loaded = true;
  }

  /**
   * Gán mã cho khách mới — mã cũ không đổi; số thứ tự theo prefix tiếp nối.
   */
  async syncCustomers(customerNames: string[]): Promise<CustomerCodeEntry[]> {
    await this.loadRegistry();

    const uniqueNames = [...new Set(customerNames.map((n) => String(n || '').trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'vi')
    );

    const byKey = new Map<string, CustomerCodeEntry>();
    for (const e of this.entries) {
      byKey.set(normalizeCustomerName(e.customer), e);
    }

    const prefixMax = new Map<string, number>();
    for (const e of this.entries) {
      prefixMax.set(e.prefix, Math.max(prefixMax.get(e.prefix) || 0, e.seq));
    }

    const batch = this.firestore.firestore.batch();
    let pending = 0;

    for (const customer of uniqueNames) {
      const key = normalizeCustomerName(customer);
      if (byKey.has(key)) continue;

      const prefix = getCustomerCodePrefix(customer);
      const seq = (prefixMax.get(prefix) || 0) + 1;
      prefixMax.set(prefix, seq);
      const code = `${prefix}${String(seq).padStart(2, '0')}`;
      const entry: CustomerCodeEntry = { customer, prefix, code, seq };
      byKey.set(key, entry);

      const docId = this.buildDocId(customer);
      const ref = this.firestore.collection(COLLECTION).doc(docId).ref;
      batch.set(ref, {
        customer,
        prefix,
        code,
        seq,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      pending += 1;
    }

    if (pending > 0) {
      await batch.commit();
    }

    this.entries = [...byKey.values()].sort(
      (a, b) => a.code.localeCompare(b.code) || a.customer.localeCompare(b.customer, 'vi')
    );
    return this.getCatalog();
  }

  private buildDocId(customer: string): string {
    const base = normalizeCustomerName(customer)
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100);
    return base || 'UNKNOWN';
  }
}
