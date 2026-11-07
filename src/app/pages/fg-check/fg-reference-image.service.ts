import { Injectable } from '@angular/core';
import { AngularFireStorage } from '@angular/fire/compat/storage';

export interface FgReferenceImage {
  code: string;
  url: string;
}

/**
 * Hình tham khảo theo Mã TP (mã đặc biệt cần xem khi check).
 * File trên Storage: `fg-reference-images/{MÃ TP}.jpg` — tên file chính là Mã TP.
 */
@Injectable({ providedIn: 'root' })
export class FgReferenceImageService {
  private static readonly FOLDER = 'fg-reference-images';
  private static readonly MAX_SIDE = 1280;
  private static readonly SAFE_CODE = /[^A-Z0-9_\-.()]/g;

  /** Cache url theo mã (null = đã hỏi, không có hình) để mỗi mã chỉ hỏi Storage 1 lần. */
  private urlCache = new Map<string, string | null>();

  constructor(private storage: AngularFireStorage) {}

  /** Chuẩn hoá Mã TP thành tên file: in hoa, bỏ ký tự lạ. */
  normalizeCode(raw: string): string {
    return String(raw || '').trim().toUpperCase().replace(FgReferenceImageService.SAFE_CODE, '');
  }

  /** Mã TP lấy từ tên file hình (bỏ đuôi .jpg/.png...). */
  codeFromFileName(fileName: string): string {
    return this.normalizeCode(String(fileName || '').replace(/\.[^.]+$/, ''));
  }

  private pathOf(code: string): string {
    return `${FgReferenceImageService.FOLDER}/${code}.jpg`;
  }

  /** Cached: undefined = chưa hỏi, null = không có hình, string = url. */
  cached(code: string): string | null | undefined {
    return this.urlCache.get(this.normalizeCode(code));
  }

  /** Lấy url hình của 1 mã (hỏi Storage đúng 1 lần cho mỗi mã). */
  async getUrl(rawCode: string): Promise<string | null> {
    const code = this.normalizeCode(rawCode);
    if (!code) return null;
    if (this.urlCache.has(code)) return this.urlCache.get(code) ?? null;
    try {
      const url = await this.storage.ref(this.pathOf(code)).getDownloadURL().toPromise();
      this.urlCache.set(code, url);
      return url;
    } catch {
      this.urlCache.set(code, null);
      return null;
    }
  }

  /** Danh sách toàn bộ hình (1 lượt listAll + lấy url từng hình). */
  async list(): Promise<FgReferenceImage[]> {
    const res = await this.storage.ref(FgReferenceImageService.FOLDER).listAll().toPromise();
    const items = res?.items || [];
    const out: FgReferenceImage[] = [];
    await Promise.all(items.map(async (it) => {
      const code = this.codeFromFileName(it.name);
      try {
        const url = await it.getDownloadURL();
        this.urlCache.set(code, url);
        out.push({ code, url });
      } catch { /* bỏ qua file lỗi */ }
    }));
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Thu nhỏ + đổi sang JPEG (tối đa 1280px) để nhẹ và cùng 1 đuôi .jpg. */
  private async toJpeg(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, FgReferenceImageService.MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không xử lý được hình');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không tạo được JPEG'))), 'image/jpeg', 0.85));
  }

  /** Tải hình lên với tên = Mã TP (ghi đè nếu đã có). */
  async upload(rawCode: string, file: File): Promise<FgReferenceImage> {
    const code = this.normalizeCode(rawCode);
    if (!code) throw new Error('Thiếu Mã TP');
    const blob = await this.toJpeg(file);
    const ref = this.storage.ref(this.pathOf(code));
    await this.storage.upload(this.pathOf(code), blob, { contentType: 'image/jpeg' });
    const url = await ref.getDownloadURL().toPromise();
    this.urlCache.set(code, url);
    return { code, url };
  }

  async remove(rawCode: string): Promise<void> {
    const code = this.normalizeCode(rawCode);
    if (!code) return;
    await this.storage.ref(this.pathOf(code)).delete().toPromise();
    this.urlCache.set(code, null);
  }
}
