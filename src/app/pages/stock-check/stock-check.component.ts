import { Component, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Router } from '@angular/router';
import { isAsm3OrWh3PrefixLocation } from '../layout-warehouse/layout-warehouse-location.util';

type KkFactory = 'ASM1' | 'ASM2' | 'ASM3';
type KkFilterMode = 'all' | 'checked' | 'unchecked';

interface StockCheckRow {
  id: string;
  factory: KkFactory;
  materialCode: string;
  materialName: string;
  poNumber: string;
  batchNumber: string;
  location: string;
  quantity: number;
  stock: number;
  unit: string;
  kkChecked: boolean;
  kkBy: string;
  kkAt: Date | null;
}

@Component({
  selector: 'app-stock-check',
  templateUrl: './stock-check.component.html',
  styleUrls: ['./stock-check.component.scss']
})
export class StockCheckComponent implements OnInit {
  readonly factories: KkFactory[] = ['ASM1', 'ASM2', 'ASM3'];

  selectedFactory: KkFactory = 'ASM1';
  rows: StockCheckRow[] = [];
  isLoading = false;
  isExporting = false;

  filterMode: KkFilterMode = 'all';
  searchCode = '';
  searchLocation = '';
  exportDate = new Date().toISOString().slice(0, 10);

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private router: Router
  ) {}

  ngOnInit(): void {}

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }

  setFactory(factory: KkFactory): void {
    if (this.isLoading || this.selectedFactory === factory) return;
    this.selectedFactory = factory;
    this.rows = [];
    this.filterMode = 'all';
    this.searchCode = '';
    this.searchLocation = '';
  }

  setFilterMode(mode: KkFilterMode): void {
    this.filterMode = mode;
  }

  get totalRows(): number {
    return this.rows.length;
  }

  get checkedRows(): number {
    return this.rows.filter((row) => row.kkChecked).length;
  }

  get uncheckedRows(): number {
    return this.rows.filter((row) => !row.kkChecked).length;
  }

  get progressPercent(): number {
    if (!this.totalRows) return 0;
    return Math.min(100, (this.checkedRows / this.totalRows) * 100);
  }

  get filteredRows(): StockCheckRow[] {
    let rows = this.rows;
    if (this.filterMode === 'checked') {
      rows = rows.filter((row) => row.kkChecked);
    } else if (this.filterMode === 'unchecked') {
      rows = rows.filter((row) => !row.kkChecked);
    }

    const codeQ = this.searchCode.trim().toUpperCase();
    const locQ = this.searchLocation.trim().toUpperCase();
    if (codeQ) rows = rows.filter((row) => row.materialCode.includes(codeQ));
    if (locQ) rows = rows.filter((row) => row.location.toUpperCase().includes(locQ));
    return rows;
  }

  async run(): Promise<void> {
    this.isLoading = true;
    try {
      const docs = await this.loadDocsForFactory(this.selectedFactory);
      this.rows = docs
        .map((doc) => {
          const data = doc.data() as any;
          return {
            id: String(doc.id || ''),
            factory: this.resolveFactoryFromDoc(data),
            materialCode: String(data.materialCode || '').trim().toUpperCase(),
            materialName: String(data.materialName || '').trim(),
            poNumber: String(data.poNumber || '').trim(),
            batchNumber: String(data.batchNumber || '').trim(),
            location: String(data.location || '').trim().toUpperCase(),
            quantity: Number(data.quantity) || 0,
            stock: this.calculateStockFromDoc(data),
            unit: String(data.unit || '').trim(),
            kkChecked: data.kkChecked === true,
            kkBy: String(data.kkBy || '').trim(),
            kkAt: this.normalizeTimestamp(data.kkAt)
          } as StockCheckRow;
        })
        .filter((row) => !!row.materialCode)
        .sort((a, b) => {
          if (a.kkChecked !== b.kkChecked) return a.kkChecked ? -1 : 1;
          return a.materialCode.localeCompare(b.materialCode) || a.location.localeCompare(b.location);
        });
    } catch (e) {
      console.error('❌ stock-check run:', e);
      alert('❌ Không tải được dữ liệu kiểm kê.');
    } finally {
      this.isLoading = false;
    }
  }

  async toggleKk(row: StockCheckRow): Promise<void> {
    const operator = await this.resolveKkOperatorId();
    if (!operator) return;

    const next = !row.kkChecked;
    const kkAt = new Date();
    const prevChecked = row.kkChecked;
    const prevBy = row.kkBy;
    const prevAt = row.kkAt;

    row.kkChecked = next;
    row.kkBy = operator;
    row.kkAt = kkAt;

    try {
      await this.firestore.collection('inventory-materials').doc(row.id).update({
        kkChecked: next,
        kkBy: operator,
        kkAt,
        updatedAt: new Date()
      });

      if (next) {
        await this.firestore.collection('inventory-kk-history').add({
          inventoryDocId: row.id,
          factory: row.factory,
          materialCode: row.materialCode,
          materialName: row.materialName,
          poNumber: row.poNumber,
          batchNumber: row.batchNumber,
          location: row.location,
          quantity: row.quantity,
          stock: row.stock,
          unit: row.unit,
          checkedBy: operator,
          checkedAt: kkAt,
          checkedDateKey: this.toDateKey(kkAt),
          createdAt: new Date()
        });
      }
    } catch (e) {
      console.error('❌ toggleKk stock-check:', e);
      row.kkChecked = prevChecked;
      row.kkBy = prevBy;
      row.kkAt = prevAt;
      alert('❌ Không lưu được trạng thái kiểm kê.');
    }
  }

  async exportCatalog(): Promise<void> {
    if (this.isExporting) return;
    const dateKey = String(this.exportDate || '').trim();
    if (!dateKey) {
      alert('Vui lòng chọn ngày kiểm kê.');
      return;
    }

    this.isExporting = true;
    try {
      const rows: Array<Record<string, unknown>> = [];
      const historySnapshot = await this.firestore
        .collection('inventory-kk-history', (ref) =>
          ref.where('factory', '==', this.selectedFactory).where('checkedDateKey', '==', dateKey).limit(10000)
        )
        .get()
        .toPromise();

      for (const doc of historySnapshot?.docs || []) {
        const data = doc.data() as any;
        rows.push({
          'Ngày kiểm': dateKey,
          'Nhà máy': String(data.factory || this.selectedFactory),
          'Mã hàng': String(data.materialCode || ''),
          'Tên hàng': String(data.materialName || ''),
          'PO': String(data.poNumber || ''),
          'Batch': String(data.batchNumber || ''),
          'Vị trí': String(data.location || ''),
          'Số lượng lúc kiểm': Number(data.quantity) || 0,
          'Tồn lúc kiểm': Number(data.stock) || 0,
          'ĐVT': String(data.unit || ''),
          'ID kiểm': String(data.checkedBy || ''),
          'Thời gian kiểm': this.formatDateTime(this.normalizeTimestamp(data.checkedAt)),
          'Inventory Doc ID': String(data.inventoryDocId || '')
        });
      }

      if (!rows.length) {
        const docs = await this.loadDocsForFactory(this.selectedFactory);
        for (const doc of docs) {
          const data = doc.data() as any;
          const kkAt = this.normalizeTimestamp(data.kkAt);
          if (data.kkChecked !== true || this.toDateKey(kkAt) !== dateKey) continue;
          rows.push({
            'Ngày kiểm': dateKey,
            'Nhà máy': this.resolveFactoryFromDoc(data),
            'Mã hàng': String(data.materialCode || '').trim().toUpperCase(),
            'Tên hàng': String(data.materialName || ''),
            'PO': String(data.poNumber || ''),
            'Batch': String(data.batchNumber || ''),
            'Vị trí': String(data.location || '').trim().toUpperCase(),
            'Số lượng lúc kiểm': Number(data.quantity) || 0,
            'Tồn lúc kiểm': this.calculateStockFromDoc(data),
            'ĐVT': String(data.unit || ''),
            'ID kiểm': String(data.kkBy || ''),
            'Thời gian kiểm': this.formatDateTime(kkAt),
            'Inventory Doc ID': String(doc.id || '')
          });
        }
      }

      if (!rows.length) {
        alert(`Không có dữ liệu danh mục KK cho ${this.selectedFactory} ngày ${dateKey}.`);
        return;
      }

      rows.sort((a, b) => String(a['Thời gian kiểm'] || '').localeCompare(String(b['Thời gian kiểm'] || '')));
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Danh muc KK');
      XLSX.writeFile(wb, `Stock_Check_KK_${this.selectedFactory}_${dateKey}.xlsx`);
    } catch (e) {
      console.error('❌ exportCatalog stock-check:', e);
      alert('❌ Không tải được danh mục KK.');
    } finally {
      this.isExporting = false;
    }
  }

  getKkTitle(row: StockCheckRow): string {
    const who = row.kkBy ? ` bởi ${row.kkBy}` : '';
    const when = row.kkAt ? ` lúc ${this.formatDateTime(row.kkAt)}` : '';
    return row.kkChecked ? `Đã kiểm kê${who}${when}` : 'Chưa kiểm kê';
  }

  formatDateTime(value: Date | null): string {
    if (!value) return '—';
    return value.toLocaleString('vi-VN');
  }

  private async loadDocsForFactory(factory: KkFactory): Promise<any[]> {
    if (factory === 'ASM3') {
      const [snapAsm3, snapAsm1, snapAsm2] = await Promise.all([
        this.firestore.collection('inventory-materials', (ref) => ref.where('factory', '==', 'ASM3').limit(10000)).get().toPromise(),
        this.firestore.collection('inventory-materials', (ref) => ref.where('factory', '==', 'ASM1').limit(10000)).get().toPromise(),
        this.firestore.collection('inventory-materials', (ref) => ref.where('factory', '==', 'ASM2').limit(10000)).get().toPromise()
      ]);
      const docs: any[] = [];
      const seen = new Set<string>();
      for (const snap of [snapAsm3, snapAsm1, snapAsm2]) {
        for (const doc of snap?.docs || []) {
          const data = doc.data() as any;
          const docFactory = String(data.factory || '').trim().toUpperCase();
          if (docFactory === 'ASM3' || isAsm3OrWh3PrefixLocation(String(data.location || ''))) {
            if (!seen.has(doc.id)) {
              seen.add(doc.id);
              docs.push(doc);
            }
          }
        }
      }
      return docs;
    }

    const snapshot = await this.firestore
      .collection('inventory-materials', (ref) => ref.where('factory', '==', factory).limit(10000))
      .get()
      .toPromise();
    return (snapshot?.docs || []).filter((doc) => !isAsm3OrWh3PrefixLocation(String((doc.data() as any).location || '')));
  }

  private resolveFactoryFromDoc(data: any): KkFactory {
    const location = String(data?.location || '');
    const rawFactory = String(data?.factory || '').trim().toUpperCase();
    if (rawFactory === 'ASM3' || isAsm3OrWh3PrefixLocation(location)) return 'ASM3';
    if (rawFactory === 'ASM2') return 'ASM2';
    return 'ASM1';
  }

  private calculateStockFromDoc(data: any): number {
    const openingStock = data?.openingStock != null ? Number(data.openingStock) : 0;
    const quantity = Number(data?.quantity) || 0;
    const exported = Number(data?.exported) || 0;
    const xt = Number(data?.xt) || 0;
    return openingStock + quantity - exported - xt;
  }

  private normalizeTimestamp(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const ts = value as { toDate?: () => Date; seconds?: number };
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    return null;
  }

  private toDateKey(value: Date | null | undefined): string {
    if (!value) return '';
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private async resolveKkOperatorId(): Promise<string | null> {
    const user = await this.afAuth.currentUser;
    const defaultCode = (() => {
      const email = String(user?.email || '').trim().toUpperCase().replace(/\s+/g, '');
      const m = email.match(/ASP\d{4}/);
      return m ? m[0] : '';
    })();

    const raw = window.prompt(
      'Quét mã nhân viên để kiểm kê.\nHệ thống chỉ lưu 7 ký tự đầu theo chuẩn ASP1234.',
      defaultCode || undefined
    );
    if (raw == null) return null;
    const normalized = String(raw).trim().toUpperCase().replace(/\s+/g, '');
    const shortCode = normalized.slice(0, 7);
    if (!/^ASP\d{4}$/.test(shortCode)) {
      alert('Mã nhân viên không đúng định dạng. Vui lòng scan theo chuẩn ASP + 4 số.');
      return null;
    }
    return shortCode;
  }
}
