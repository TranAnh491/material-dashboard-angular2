import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { firstValueFrom } from 'rxjs';
import { NvlCatalogFullService } from './nvl-catalog-full.service';
import { WEIGH_REQUIRED_PREFIXES, catalogBagWeight, weighPercentOk } from './weigh-exempt-report';

/** Cùng collection / docId / công thức với Check lượng PXK ở Work Order Status. */
export const PXK_WEIGHT_CHECK_COLLECTION = 'pxk-weight-checks';
/** Hình bag lẻ đã cân (Outbound + tách tem lẻ). Job purgePxkWeightPhotosDaily xóa file > 6 tháng. */
export const PXK_WEIGHT_PHOTO_PREFIX = 'pxk-weight-photos';
const PHOTO_MAX_SIDE = 1280;

/** Kết quả cân bịch TL lúc tách tem lẻ (rm-tem-le-splits) — Outbound kế thừa khi scan tem TL. */
export interface TemLeTlWeigh {
  tlTag: string;
  tlQty: number;
  tlGw: number;
  gwBagFull: number;
  photoUrl: string;
  photoPath: string;
  by: string;
}

export interface PxkOddWeighSaveInput {
  factory: string;
  lsx: string;
  materialCode: string;
  po: string;
  maKho: string;
  /** Lượng xuất của mã + PO trên PXK */
  exportQty: number;
  standard: number;
  /** Lượng của bag lẻ vừa scan */
  bagQty: number;
  /** Trọng lượng chẵn cuộn (gram) — từ danh mục hoặc vừa nhập */
  weightFull: number;
  /** true = vừa nhập ở Outbound → cập nhật danh mục NVL */
  weightFullEntered: boolean;
  weightOdd: number;
  /** null = máy chọn "Không dùng camera" — chỉ ghi số gram. */
  photo: Blob | null;
  weighedBy: string;
}

export interface PxkOddWeighSaveResult {
  percent: number | null;
  ok: boolean | null;
  photoUrl: string;
}

@Injectable({ providedIn: 'root' })
export class PxkOddWeighService {
  constructor(
    private firestore: AngularFirestore,
    private storage: AngularFireStorage,
    private nvlCatalog: NvlCatalogFullService
  ) {}

  normLsx(s: string): string {
    const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
    if (!t) return '';
    const compact = t.replace(/[-.]/g, '/');
    if (/^(KZ|LH)LSX/.test(compact)) return compact;
    const m = compact.match(/(\d{4}\/\d+)/);
    return m ? m[1] : compact;
  }

  poKey(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  }

  docId(lsx: string, materialCode: string, po: string): string {
    const raw = `${this.normLsx(lsx)}|${materialCode.trim().toUpperCase()}|${this.poKey(po)}`;
    return encodeURIComponent(raw).replace(/%/g, '_');
  }

  /** Mã thuộc Check lượng: đầu mã trong WEIGH_REQUIRED_PREFIXES hoặc mã thêm trong danh mục; không kho trống / NVL_SX / NVL_KS. */
  isCheckLine(materialCode: string, maKho: string | null | undefined, exempt: Set<string>, include: Set<string>): boolean {
    const kho = String(maKho || '').trim().toUpperCase();
    if (!kho || kho.includes('NVL_SX') || kho.includes('NVL_KS')) return false;
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code || exempt.has(code)) return false;
    if (include.has(code)) return true;
    if (code.startsWith('R') || code.startsWith('A')) return false;
    return WEIGH_REQUIRED_PREFIXES.some((p) => code.startsWith(p));
  }

  splitRollQty(exportQty: number, standard: number): { fullQty: number; oddQty: number } {
    const qty = Number(exportQty) || 0;
    const std = Number(standard) || 0;
    if (!(std > 0)) return { fullQty: 0, oddQty: qty };
    const rem = qty - Math.floor(qty / std) * std;
    return { fullQty: std, oddQty: Math.abs(rem) < 0.0001 ? 0 : Math.round(rem * 10000) / 10000 };
  }

  oddPercent(weightFull: number, weightOdd: number, standard: number, oddQty: number): number | null {
    if (!(weightFull > 0) || !(weightOdd > 0) || !(standard > 0) || !(oddQty > 0)) return null;
    const expected = (weightFull / standard) * oddQty;
    return expected > 0 ? (weightOdd / expected) * 100 : null;
  }

  isOk(percent: number): boolean {
    return weighPercentOk(percent);
  }

  async getSaved(lsx: string, materialCode: string, po: string): Promise<any | null> {
    const snap = await this.firestore.firestore.collection(PXK_WEIGHT_CHECK_COLLECTION).doc(this.docId(lsx, materialCode, po)).get();
    return snap.exists ? snap.data() : null;
  }

  async catalogUnitWeight(materialCode: string): Promise<number> {
    return catalogBagWeight(await this.nvlCatalog.getByCode(materialCode));
  }

  /** Upload hình (đã nén) dưới pxk-weight-photos/{nhà máy}/{yyyy-MM}/{folder}/{name}.jpg. */
  async uploadPhoto(factory: string, folder: string, name: string, photo: Blob): Promise<{ url: string; path: string }> {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const safe = (s: string) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');
    const path = `${PXK_WEIGHT_PHOTO_PREFIX}/${safe(factory)}/${month}/${safe(folder)}/${safe(name)}_${now.getTime()}.jpg`;
    await this.storage.upload(path, photo, { contentType: 'image/jpeg' });
    const url = await firstValueFrom(this.storage.ref(path).getDownloadURL());
    return { url, path };
  }

  /** Ghi Check lượng PXK từ kết quả cân TL lúc tách tem lẻ — không cân lại ở Outbound. */
  async saveFromSplit(input: {
    lsx: string; materialCode: string; po: string; maKho: string; exportQty: number; standard: number; tl: TemLeTlWeigh;
  }): Promise<{ percent: number | null; ok: boolean | null }> {
    const code = input.materialCode.trim().toUpperCase();
    const { fullQty, oddQty } = this.splitRollQty(input.exportQty, input.standard);
    const percent = this.oddPercent(input.tl.gwBagFull, input.tl.tlGw, input.standard, input.tl.tlQty);
    const ok = percent == null ? null : this.isOk(percent);
    const now = new Date();
    await this.firestore.firestore.collection(PXK_WEIGHT_CHECK_COLLECTION).doc(this.docId(input.lsx, code, input.po)).set({
      lsx: input.lsx,
      lsxNorm: this.normLsx(input.lsx),
      materialCode: code,
      maKho: input.maKho,
      po: input.po,
      poKey: this.poKey(input.po),
      exportQty: input.exportQty,
      standard: input.standard,
      fullQty,
      oddQty,
      weightFull: input.tl.gwBagFull,
      weightOdd: input.tl.tlGw,
      percent: percent == null ? null : Math.round(percent * 10) / 10,
      ok,
      oddBagQty: input.tl.tlQty,
      oddPhotoUrl: input.tl.photoUrl,
      oddPhotoPath: input.tl.photoPath,
      oddPhotoAt: now,
      oddWeighedBy: input.tl.by,
      oddWeighSource: 'tach-tem-le',
      oddSplitTag: input.tl.tlTag,
      updatedAt: now
    }, { merge: true });
    return { percent, ok };
  }

  /** Thu nhỏ ảnh (cạnh dài ≤ 1280px) → JPEG. */
  async compressPhoto(source: Blob | HTMLCanvasElement): Promise<Blob> {
    let canvas: HTMLCanvasElement;
    if (source instanceof HTMLCanvasElement) {
      canvas = source;
    } else {
      const url = URL.createObjectURL(source);
      try {
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const el = new Image();
          el.onload = () => res(el);
          el.onerror = () => rej(new Error('Không đọc được ảnh.'));
          el.src = url;
        });
        canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(canvas.width, canvas.height));
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    out.getContext('2d')?.drawImage(canvas, 0, 0, out.width, out.height);
    return new Promise<Blob>((res, rej) =>
      out.toBlob((b) => (b ? res(b) : rej(new Error('Không nén được ảnh.'))), 'image/jpeg', 0.8)
    );
  }

  async save(input: PxkOddWeighSaveInput): Promise<PxkOddWeighSaveResult> {
    const code = input.materialCode.trim().toUpperCase();
    const now = new Date();
    const { url: photoUrl, path } = input.photo
      ? await this.uploadPhoto(input.factory, this.normLsx(input.lsx), `${code}_${this.poKey(input.po)}`, input.photo)
      : { url: '', path: '' };

    const { fullQty, oddQty } = this.splitRollQty(input.exportQty, input.standard);
    const percent = oddQty > 0 ? this.oddPercent(input.weightFull, input.weightOdd, input.standard, input.bagQty) : null;
    const ok = percent == null ? null : this.isOk(percent);
    if (input.weightFullEntered) {
      await this.nvlCatalog.update(code, { gwBag: input.weightFull });
    }
    await this.firestore.firestore.collection(PXK_WEIGHT_CHECK_COLLECTION).doc(this.docId(input.lsx, code, input.po)).set({
      lsx: input.lsx,
      lsxNorm: this.normLsx(input.lsx),
      materialCode: code,
      maKho: input.maKho,
      po: input.po,
      poKey: this.poKey(input.po),
      exportQty: input.exportQty,
      standard: input.standard,
      fullQty,
      oddQty,
      weightFull: input.weightFull,
      weightOdd: oddQty > 0 ? input.weightOdd : null,
      percent: percent == null ? null : Math.round(percent * 10) / 10,
      ok,
      oddBagQty: input.bagQty,
      oddPhotoUrl: photoUrl,
      oddPhotoPath: path,
      oddPhotoAt: input.photo ? now : null,
      oddWeighedBy: input.weighedBy,
      oddWeighSource: input.photo ? 'outbound' : 'outbound-khong-camera',
      updatedAt: now
    }, { merge: true });
    return { percent, ok, photoUrl };
  }
}
