import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface LayoutWarehouseSettingsDoc {
  ruleExcludedMaterialCodes?: string[];
  updatedAt?: Date;
  updatedBy?: string;
}

@Injectable({ providedIn: 'root' })
export class LayoutWarehouseSettingsService {
  private readonly collection = 'layout-warehouse-settings';

  constructor(private firestore: AngularFirestore) {}

  /** Chuẩn hoá mã loại trừ (7 ký tự đầu, giống rule check). */
  normalizeExcludedCode(code: string): string {
    return String(code || '').replace(/\s/g, '').toUpperCase().substring(0, 7);
  }

  parseExcludedCodesInput(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of String(text || '').split(/[\s,;]+/)) {
      const norm = this.normalizeExcludedCode(part);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
    }
    return out.sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }

  async loadRuleExclusions(factory: string): Promise<string[]> {
    const snap = await this.firestore.collection(this.collection).doc(factory).get().toPromise();
    if (!snap?.exists) return [];
    const data = snap.data() as LayoutWarehouseSettingsDoc;
    const raw = Array.isArray(data?.ruleExcludedMaterialCodes) ? data.ruleExcludedMaterialCodes : [];
    return this.parseExcludedCodesInput(raw.join(' '));
  }

  async saveRuleExclusions(factory: string, codes: string[], updatedBy: string): Promise<void> {
    const normalized = this.parseExcludedCodesInput(codes.join(' '));
    await this.firestore
      .collection(this.collection)
      .doc(factory)
      .set(
        {
          ruleExcludedMaterialCodes: normalized,
          updatedAt: new Date(),
          updatedBy: String(updatedBy || '').trim()
        },
        { merge: true }
      );
  }
}
