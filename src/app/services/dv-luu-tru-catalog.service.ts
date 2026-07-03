import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import {
  DvLuuTruCatalogEntry,
  getStorageUnitFraction,
  StorageUnitSize
} from '../models/storage-unit.model';

@Injectable({ providedIn: 'root' })
export class DvLuuTruCatalogService {
  readonly collectionName = 'dv-luu-tru-catalog';

  constructor(private firestore: AngularFirestore) {}

  buildDocId(factory: string, batchNumber: string): string {
    const f = String(factory || '').trim().toUpperCase() || 'ASM';
    const batch = String(batchNumber || '').trim();
    const safe = batch.replace(/[\/\\.#$\[\]]/g, '_').replace(/\s+/g, '_');
    return `${f}__${safe}`;
  }

  async getEntry(factory: string, batchNumber: string): Promise<DvLuuTruCatalogEntry | null> {
    const id = this.buildDocId(factory, batchNumber);
    const snap = await this.firestore.collection(this.collectionName).doc(id).get().toPromise();
    if (!snap?.exists) return null;
    return this.mapDoc(id, snap.data() as Record<string, unknown>);
  }

  async loadMapForBatches(factory: string, batchNumbers: string[]): Promise<Map<string, StorageUnitSize>> {
    const map = new Map<string, StorageUnitSize>();
    const unique = [...new Set(batchNumbers.map(b => String(b || '').trim()).filter(Boolean))];
    if (!unique.length) return map;

    await Promise.all(
      unique.map(async batchNumber => {
        const entry = await this.getEntry(factory, batchNumber);
        if (entry?.size) map.set(batchNumber, entry.size);
      })
    );
    return map;
  }

  async listEntries(factory?: string): Promise<DvLuuTruCatalogEntry[]> {
    const snap = await this.firestore
      .collection(this.collectionName, ref => ref.orderBy('updatedAt', 'desc').limit(500))
      .get()
      .toPromise();
    let entries = (snap?.docs || []).map(doc => this.mapDoc(doc.id, doc.data() as Record<string, unknown>));
    if (factory) {
      const f = factory.trim().toUpperCase();
      entries = entries.filter(e => e.factory === f);
    }
    return entries;
  }

  async saveEntry(factory: string, batchNumber: string, size: StorageUnitSize): Promise<DvLuuTruCatalogEntry> {
    const id = this.buildDocId(factory, batchNumber);
    const fraction = getStorageUnitFraction(size);
    const payload = {
      factory: String(factory || '').trim().toUpperCase(),
      batchNumber: String(batchNumber || '').trim(),
      size,
      fraction,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await this.firestore.collection(this.collectionName).doc(id).set(payload, { merge: true });
    return {
      id,
      factory: payload.factory,
      batchNumber: payload.batchNumber,
      size,
      fraction,
      updatedAt: new Date()
    };
  }

  async deleteEntry(id: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(id).delete();
  }

  async syncInboundMaterials(
    factory: string,
    batchNumber: string,
    size: StorageUnitSize,
    materialIds: string[]
  ): Promise<void> {
    const ids = [...new Set(materialIds.filter(Boolean))];
    if (!ids.length) return;

    const chunkSize = 400;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = this.firestore.firestore.batch();
      ids.slice(i, i + chunkSize).forEach(id => {
        batch.update(this.firestore.collection('inbound-materials').doc(id).ref, {
          storageUnitSize: size,
          updatedAt: new Date()
        });
      });
      await batch.commit();
    }
  }

  private mapDoc(id: string, data: Record<string, unknown>): DvLuuTruCatalogEntry {
    const size = String(data['size'] || '') as StorageUnitSize;
    return {
      id,
      factory: String(data['factory'] || ''),
      batchNumber: String(data['batchNumber'] || ''),
      size,
      fraction: Number(data['fraction'] ?? getStorageUnitFraction(size)),
      updatedAt: (data['updatedAt'] as firebase.firestore.Timestamp | undefined)?.toDate?.()
    };
  }
}
