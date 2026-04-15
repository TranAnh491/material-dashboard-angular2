import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export interface LabelReprintFlagDoc {
  factory: 'ASM1' | 'ASM2';
  materialCode: string;
  poNumber: string;
  /** IMD key dạng ddMMyyyy (từ importDate). */
  imdKey: string;
  reprintedAt: any;
  reprintedBy?: string;
  source?: string;
}

@Injectable({ providedIn: 'root' })
export class LabelReprintFlagService {
  private readonly COLLECTION = 'label-reprint-flags';

  constructor(private afs: AngularFirestore) {}

  private sanitizeKeyPart(v: string): string {
    // Firestore doc id cannot contain '/' and should be reasonably short/stable.
    // Keep only [A-Z0-9_-], replace others with '_'.
    return String(v ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 300);
  }

  normalizeMaterialCode(v: string): string {
    return this.sanitizeKeyPart(v);
  }

  normalizePo(v: string): string {
    // PO có thể chứa '/', '.', khoảng trắng...
    return this.sanitizeKeyPart(String(v ?? '').replace(/\s+/g, ''));
  }

  buildDocId(factory: 'ASM1' | 'ASM2', materialCode: string, poNumber: string, imdKey: string): string {
    const f = this.sanitizeKeyPart(factory);
    const m = this.normalizeMaterialCode(materialCode);
    const p = this.normalizePo(poNumber);
    const imd = this.sanitizeKeyPart(imdKey);
    return `${f}_${m}_${p}_${imd}`;
  }

  async getExistingFlagsByDocId(docIds: string[]): Promise<Set<string>> {
    const ids = Array.from(new Set(docIds.filter(Boolean)));
    if (ids.length === 0) return new Set<string>();

    const snaps = await Promise.all(
      ids.map((id) => this.afs.collection(this.COLLECTION).doc(id).get().toPromise())
    );
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      if (snaps[i]?.exists) {
        existing.add(ids[i]);
      }
    }
    return existing;
  }

  async markReprintedByDocId(
    items: Array<{
      docId: string;
      factory: 'ASM1' | 'ASM2';
      materialCode: string;
      poNumber: string;
      imdKey: string;
    }>,
    meta?: { reprintedBy?: string; source?: string }
  ): Promise<void> {
    const dedup = new Map<string, (typeof items)[number]>();
    for (const it of items) {
      const id = String(it?.docId ?? '').trim();
      if (!id) continue;
      if (!dedup.has(id)) dedup.set(id, it);
    }
    if (dedup.size === 0) return;

    const batch = this.afs.firestore.batch();
    const now = firebase.default.firestore.FieldValue.serverTimestamp();
    for (const [id, it] of dedup.entries()) {
      const ref = this.afs.collection(this.COLLECTION).doc(id).ref;
      batch.set(
        ref,
        {
          factory: it.factory,
          materialCode: this.normalizeMaterialCode(it.materialCode),
          poNumber: this.normalizePo(it.poNumber),
          imdKey: String(it.imdKey ?? '').trim(),
          reprintedAt: now,
          reprintedBy: meta?.reprintedBy || '',
          source: meta?.source || 'TEM_XUAT_KHO'
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

