import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import {
  DvLuuTruCatalogEntry,
  getStorageUnitFraction,
  normalizeStorageMaterialCode,
  StorageUnitSize
} from '../models/storage-unit.model';

@Injectable({ providedIn: 'root' })
export class DvLuuTruCatalogService {
  readonly collectionName = 'dv-luu-tru-catalog';

  constructor(private firestore: AngularFirestore) {}

  normalizeMaterialCode(code: string | null | undefined): string {
    return normalizeStorageMaterialCode(code);
  }

  /** Danh mục chung — doc id theo mã NVL (mọi PO / IMD / nhà máy). */
  buildDocId(materialCode: string): string {
    const code = this.normalizeMaterialCode(materialCode);
    const safe = code.replace(/[\/\\.#$\[\]]/g, '_').replace(/\s+/g, '_');
    return safe || '_empty';
  }

  async getEntry(materialCode: string): Promise<DvLuuTruCatalogEntry | null> {
    const code = this.normalizeMaterialCode(materialCode);
    if (!code) return null;

    const id = this.buildDocId(code);
    const snap = await this.firestore.collection(this.collectionName).doc(id).get().toPromise();
    if (snap?.exists) {
      return this.mapDoc(id, snap.data() as Record<string, unknown>);
    }
    return null;
  }

  async loadMapForMaterialCodes(materialCodes: string[]): Promise<Map<string, StorageUnitSize>> {
    const map = new Map<string, StorageUnitSize>();
    const unique = [
      ...new Set(materialCodes.map(c => this.normalizeMaterialCode(c)).filter(Boolean))
    ];
    if (!unique.length) return map;

    await Promise.all(
      unique.map(async materialCode => {
        const entry = await this.getEntry(materialCode);
        if (entry?.size) map.set(materialCode, entry.size);
      })
    );
    return map;
  }

  /** @deprecated Dùng loadMapForMaterialCodes */
  async loadMapForBatches(keys: string[]): Promise<Map<string, StorageUnitSize>> {
    return this.loadMapForMaterialCodes(keys);
  }

  async listEntries(): Promise<DvLuuTruCatalogEntry[]> {
    const snap = await this.firestore
      .collection(this.collectionName, ref => ref.orderBy('updatedAt', 'desc').limit(500))
      .get()
      .toPromise();
    const entries = (snap?.docs || []).map(doc => this.mapDoc(doc.id, doc.data() as Record<string, unknown>));
    const byMaterial = new Map<string, DvLuuTruCatalogEntry>();
    entries.forEach(entry => {
      const key = entry.materialCode || entry.batchNumber || '';
      if (!key) return;
      const existing = byMaterial.get(key);
      if (!existing || (entry.updatedAt?.getTime() || 0) > (existing.updatedAt?.getTime() || 0)) {
        byMaterial.set(key, entry);
      }
    });
    return [...byMaterial.values()].sort(
      (a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0)
    );
  }

  async saveEntry(
    materialCode: string,
    size: StorageUnitSize,
    sourceFactory?: string
  ): Promise<DvLuuTruCatalogEntry> {
    const code = this.normalizeMaterialCode(materialCode);
    const id = this.buildDocId(code);
    const fraction = getStorageUnitFraction(size);
    const factory = String(sourceFactory || '').trim().toUpperCase();
    const payload = {
      materialCode: code,
      size,
      fraction,
      factory,
      scope: 'global',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await this.firestore.collection(this.collectionName).doc(id).set(payload, { merge: true });
    return {
      id,
      factory,
      materialCode: code,
      size,
      fraction,
      updatedAt: new Date()
    };
  }

  async deleteEntry(id: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(id).delete();
  }

  async assignStorageUnit(
    materialCode: string,
    size: StorageUnitSize,
    sourceFactory?: string
  ): Promise<void> {
    await this.saveEntry(materialCode, size, sourceFactory);
    await this.syncStorageUnitByMaterialCode(materialCode, size);
  }

  /** Đồng bộ size sang inbound + inventory theo mã NVL (mọi PO, IMD, nhà máy). */
  async syncStorageUnitByMaterialCode(materialCode: string, size: StorageUnitSize): Promise<void> {
    const code = this.normalizeMaterialCode(materialCode);
    if (!code) return;

    const [inboundSnap, inventorySnap] = await Promise.all([
      this.firestore
        .collection('inbound-materials', ref => ref.where('materialCode', '==', code).limit(500))
        .get()
        .toPromise(),
      this.firestore
        .collection('inventory-materials', ref => ref.where('materialCode', '==', code).limit(500))
        .get()
        .toPromise()
    ]);

    let refs = [...(inboundSnap?.docs || []), ...(inventorySnap?.docs || [])].map(doc => doc.ref);

    if (!refs.length) {
      const [inboundSnap2, inventorySnap2] = await Promise.all([
        this.firestore
          .collection('inbound-materials', ref =>
            ref.where('materialCode', '==', String(materialCode || '').trim()).limit(500)
          )
          .get()
          .toPromise(),
        this.firestore
          .collection('inventory-materials', ref =>
            ref.where('materialCode', '==', String(materialCode || '').trim()).limit(500)
          )
          .get()
          .toPromise()
      ]);
      refs = [...(inboundSnap2?.docs || []), ...(inventorySnap2?.docs || [])].map(doc => doc.ref);
    }

    if (!refs.length) return;

    const chunkSize = 400;
    for (let i = 0; i < refs.length; i += chunkSize) {
      const batch = this.firestore.firestore.batch();
      refs.slice(i, i + chunkSize).forEach(ref => {
        batch.update(ref, {
          storageUnitSize: size,
          updatedAt: new Date()
        });
      });
      await batch.commit();
    }
  }

  /** @deprecated */
  async syncStorageUnitByBatch(_batchNumber: string, materialCodeOrSize: StorageUnitSize | string, size?: StorageUnitSize): Promise<void> {
    if (size) {
      await this.syncStorageUnitByMaterialCode(String(materialCodeOrSize), size);
    }
  }

  /** @deprecated */
  async syncInboundMaterials(
    _factory: string,
    materialCode: string,
    size: StorageUnitSize,
    _materialIds: string[]
  ): Promise<void> {
    await this.syncStorageUnitByMaterialCode(materialCode, size);
  }

  private mapDoc(id: string, data: Record<string, unknown>): DvLuuTruCatalogEntry {
    const size = String(data['size'] || '') as StorageUnitSize;
    const materialCode =
      this.normalizeMaterialCode(String(data['materialCode'] || '')) ||
      this.normalizeMaterialCode(String(data['batchNumber'] || ''));
    return {
      id,
      factory: String(data['factory'] || ''),
      materialCode,
      batchNumber: String(data['batchNumber'] || '') || undefined,
      size,
      fraction: Number(data['fraction'] ?? getStorageUnitFraction(size)),
      updatedAt: (data['updatedAt'] as firebase.firestore.Timestamp | undefined)?.toDate?.()
    };
  }
}
