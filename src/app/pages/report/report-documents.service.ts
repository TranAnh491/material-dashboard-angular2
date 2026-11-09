import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import firebase from 'firebase/compat/app';
import { firstValueFrom } from 'rxjs';

/**
 * Lưu tài liệu (tab Report): file trên Storage `report-documents/{id}/{tên file}`,
 * danh sách ở Firestore `report-documents` — máy nào đăng nhập cũng tải / in / xóa được.
 */

export const REPORT_DOC_COLLECTION = 'report-documents';
export const REPORT_DOC_MAX_BYTES = 50 * 1024 * 1024;

export interface ReportDocument {
  id: string;
  name: string;
  size: number;
  contentType: string;
  storagePath: string;
  url: string;
  uploadedBy: string;
  uploadedAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class ReportDocumentsService {
  constructor(private firestore: AngularFirestore, private storage: AngularFireStorage) {}

  async list(): Promise<ReportDocument[]> {
    const snap = await this.firestore.firestore.collection(REPORT_DOC_COLLECTION)
      .orderBy('uploadedAt', 'desc').limit(500).get();
    return snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        name: String(x.name || ''),
        size: Number(x.size) || 0,
        contentType: String(x.contentType || ''),
        storagePath: String(x.storagePath || ''),
        url: String(x.url || ''),
        uploadedBy: String(x.uploadedBy || ''),
        uploadedAt: x.uploadedAt?.toDate ? x.uploadedAt.toDate() : null
      };
    });
  }

  /** Upload 1 file; onProgress nhận 0–100. */
  async upload(file: File, uploadedBy: string, onProgress?: (pct: number) => void): Promise<void> {
    const docRef = this.firestore.firestore.collection(REPORT_DOC_COLLECTION).doc();
    const safeName = file.name.replace(/[\\/#?\[\]*]/g, '_');
    const path = `${REPORT_DOC_COLLECTION}/${docRef.id}/${safeName}`;
    const task = this.storage.upload(path, file, { contentType: file.type || 'application/octet-stream' });
    const sub = task.percentageChanges().subscribe((p) => onProgress?.(Math.round(p || 0)));
    try {
      await task;
    } finally {
      sub.unsubscribe();
    }
    const url = await firstValueFrom(this.storage.ref(path).getDownloadURL());
    await docRef.set({
      name: file.name,
      size: file.size,
      contentType: file.type || '',
      storagePath: path,
      url,
      uploadedBy,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async remove(doc: ReportDocument): Promise<void> {
    if (doc.storagePath) {
      try {
        await firstValueFrom(this.storage.ref(doc.storagePath).delete());
      } catch (e: any) {
        // File đã mất trên Storage thì vẫn xóa dòng danh sách
        if (e?.code !== 'storage/object-not-found') throw e;
      }
    }
    await this.firestore.firestore.collection(REPORT_DOC_COLLECTION).doc(doc.id).delete();
  }

  /** Tải file về máy (blob → giữ đúng tên file). */
  async download(doc: ReportDocument): Promise<void> {
    let blob: Blob;
    try {
      const res = await fetch(doc.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    } catch {
      // Bucket chưa bật CORS → mở link trực tiếp (trình duyệt tự tải / xem)
      window.open(doc.url, '_blank', 'noopener');
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  }
}
