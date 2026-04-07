import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom } from 'rxjs';

/** Dòng PXK cần cho tem xuất kho (mã + PO + lượng xuất). */
export interface PxkLineExport {
  materialCode: string;
  po: string;
  quantity: number;
  maKho?: string;
}

@Injectable({ providedIn: 'root' })
export class TemXuatKhoService {
  /** Không cộng lượng xuất từ các dòng PXK có mã kho này vào tính tem xuất kho. */
  private static readonly PXK_MA_KHO_EXCLUDE_FROM_TEM = new Set(['NVL_SX', 'NVL_KS']);

  constructor(private firestore: AngularFirestore) {}

  private isMaKhoExcludedFromTemExport(maKho: string | undefined | null): boolean {
    const u = String(maKho ?? '')
      .trim()
      .toUpperCase();
    return u !== '' && TemXuatKhoService.PXK_MA_KHO_EXCLUDE_FROM_TEM.has(u);
  }

  /**
   * Đọc `pxk-import-data` theo LSX (thử docId + query `lsx`), factory ASM1/ASM2.
   */
  async loadPxkLinesForLsx(factory: 'ASM1' | 'ASM2', lsxRaw: string): Promise<PxkLineExport[]> {
    const variants = this.buildLsxVariants(factory, lsxRaw);
    if (variants.length === 0) {
      return [];
    }

    for (const lsx of variants) {
      const docId = `${factory}_${lsx.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const snap = await this.firestore.collection('pxk-import-data').doc(docId).get().toPromise();
      const lines = this.parsePxkDocLines(snap?.exists ? snap.data() : null);
      if (lines.length > 0) {
        return lines;
      }
    }

    const FIRESTORE_IN = 10;
    for (let i = 0; i < variants.length; i += FIRESTORE_IN) {
      const chunk = variants.slice(i, i + FIRESTORE_IN);
      const qSnap = await firstValueFrom(
        this.firestore.collection('pxk-import-data', (ref) =>
          ref.where('factory', '==', factory).where('lsx', 'in', chunk)
        ).get()
      );
      for (const doc of qSnap.docs) {
        const lines = this.parsePxkDocLines(doc.data());
        if (lines.length > 0) {
          return lines;
        }
      }
    }

    return [];
  }

  private parsePxkDocLines(data: any): PxkLineExport[] {
    if (!data) {
      return [];
    }
    const rawLines = Array.isArray(data.lines) ? data.lines : [];
    const out: PxkLineExport[] = [];
    for (const ln of rawLines) {
      const materialCode = String(ln?.materialCode ?? '').trim();
      const po = String(ln?.po ?? (ln as any)?.poNumber ?? '').trim();
      const quantity = Number(ln?.quantity ?? 0);
      if (!materialCode || !Number.isFinite(quantity) || quantity <= 0) {
        continue;
      }
      const maKhoRaw = ln?.maKho != null ? String(ln.maKho).trim() : '';
      if (this.isMaKhoExcludedFromTemExport(maKhoRaw)) {
        continue;
      }
      out.push({
        materialCode,
        po,
        quantity,
        maKho: maKhoRaw || undefined
      });
    }
    return out;
  }

  private buildLsxVariants(factory: 'ASM1' | 'ASM2', raw: string): string[] {
    const out = new Set<string>();
    const t = raw.trim();
    if (!t) {
      return [];
    }
    out.add(t);
    const u = t.toUpperCase().replace(/\s/g, '');
    out.add(u);

    const rest = u.replace(/^KZLSX/i, '').replace(/^LHLSX/i, '');
    const mNum = /^(\d{4})[\/\-\.](\d{4})$/.exec(rest);
    if (mNum) {
      const num = `${mNum[1]}/${mNum[2]}`;
      if (factory === 'ASM1') {
        out.add(`KZLSX${num}`);
      } else {
        out.add(`LHLSX${num}`);
      }
    }

    if (/^\d{4}[\/\-\.]\d{4}$/.test(u)) {
      const num = u.replace(/[-.]/g, '/');
      if (factory === 'ASM1') {
        out.add(`KZLSX${num}`);
      } else {
        out.add(`LHLSX${num}`);
      }
    }

    return Array.from(out);
  }
}
