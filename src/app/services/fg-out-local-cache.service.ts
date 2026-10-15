import { Injectable } from '@angular/core';

/**
 * Bản sao dữ liệu FG Out (cửa sổ 30 ngày) lưu trong IndexedDB của trình duyệt.
 *
 * Học từ dự án SXXK: mở trang không đọc lại hàng nghìn document. Lần đầu tải đủ như cũ rồi lưu
 * lại; các lần sau hiện ngay từ bản sao, sau đó chỉ hỏi Firestore những dòng có updatedAt mới
 * hơn lần đồng bộ trước + các dòng đã xóa (tombstone fg-deleted-docs).
 *
 * IndexedDB lưu được Date nguyên vẹn (structured clone), nên lưu thẳng các dòng đã map.
 * Mọi lỗi (trình duyệt chặn, ẩn danh, hết chỗ) đều trả null / bỏ qua — trang tự tải đủ như cũ.
 */
export interface FgOutCacheSnapshot<T> {
  version: number;
  /** Mốc thời gian (ms, đồng hồ máy) lấy NGAY TRƯỚC khi truy vấn — lần sau lấy delta từ đây */
  syncedAt: number;
  items: T[];
}

@Injectable({ providedIn: 'root' })
export class FgOutLocalCacheService {
  /** Tăng khi đổi cấu trúc dòng lưu → bản sao cũ bị bỏ, tải đủ lại */
  static readonly VERSION = 1;
  private static readonly DB_NAME = 'airspeed-fg-out-cache';
  private static readonly STORE = 'kv';
  private static readonly KEY = 'window-30d';

  async read<T>(): Promise<FgOutCacheSnapshot<T> | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(FgOutLocalCacheService.STORE, 'readonly')
          .objectStore(FgOutLocalCacheService.STORE)
          .get(FgOutLocalCacheService.KEY);
        req.onsuccess = () => {
          db.close();
          const v = req.result as FgOutCacheSnapshot<T> | undefined;
          resolve(v && v.version === FgOutLocalCacheService.VERSION && Array.isArray(v.items) ? v : null);
        };
        req.onerror = () => { db.close(); resolve(null); };
      } catch {
        db.close();
        resolve(null);
      }
    });
  }

  async write<T>(syncedAt: number, items: T[]): Promise<void> {
    const db = await this.open();
    if (!db) return;
    const value: FgOutCacheSnapshot<T> = { version: FgOutLocalCacheService.VERSION, syncedAt, items };
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(FgOutLocalCacheService.STORE, 'readwrite');
        tx.objectStore(FgOutLocalCacheService.STORE).put(value, FgOutLocalCacheService.KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); resolve(); };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(FgOutLocalCacheService.STORE, 'readwrite');
        tx.objectStore(FgOutLocalCacheService.STORE).delete(FgOutLocalCacheService.KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  private open(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        const req = indexedDB.open(FgOutLocalCacheService.DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(FgOutLocalCacheService.STORE)) {
            db.createObjectStore(FgOutLocalCacheService.STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
}
