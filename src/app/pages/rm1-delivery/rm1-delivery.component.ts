import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { MatDialog } from '@angular/material/dialog';
import {
  DeliveryScanFlowModalComponent,
  DeliveryScanFlowResult
} from '../../components/delivery-scan-flow-modal/delivery-scan-flow-modal.component';
import { FactorySelectDialogComponent } from '../../components/factory-select-dialog/factory-select-dialog.component';

export interface DeliveryRecord {
  id?: string;
  mode: 'giao-hang';
  employeeId: string;
  employeeName?: string;
  lsx: string;
  lineNhan?: string;
  receiverEmployeeId?: string;
  receiverEmployeeName?: string;
  pxkLines?: Array<{
    materialCode: string;
    poNumber: string;
    quantity: number;
    checkQuantity?: number;
  }>;
  timestamp: Date;
  createdAt?: Date;
}

@Component({
  selector: 'app-rm1-delivery',
  templateUrl: './rm1-delivery.component.html',
  styleUrls: ['./rm1-delivery.component.scss']
})
export class Rm1DeliveryComponent implements OnInit, OnDestroy {
  deliveryHistory: DeliveryRecord[] = [];
  searchResults: DeliveryRecord[] | null = null; // null = chưa search, [] = search xong
  isLoadingHistory = false;
  isSearching = false;
  searchLsx = '';

  /** Danh sách hiển thị: dùng searchResults khi đang search, ngược lại dùng deliveryHistory */
  get filteredHistory(): DeliveryRecord[] {
    return this.searchResults !== null ? this.searchResults : this.deliveryHistory;
  }

  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private router: Router,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Không load lịch sử mặc định — chỉ hiện khi user search
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Giao hàng ────────────────────────────────────────────
  selectGiaoHang(): void {
    const factoryDialogRef = this.dialog.open(FactorySelectDialogComponent, {
      width: 'auto',
      maxWidth: '95vw',
      disableClose: false,
      panelClass: 'factory-select-dialog'
    });
    factoryDialogRef.afterClosed().subscribe((factory: 'ASM1' | 'ASM2' | null) => {
      if (!factory) return;
      const deliveryDialogRef = this.dialog.open(DeliveryScanFlowModalComponent, {
        width: '95vw',
        maxWidth: '500px',
        maxHeight: '92vh',
        data: { factory },
        disableClose: false,
        autoFocus: false,
        panelClass: 'delivery-flow-dialog'
      });
      deliveryDialogRef.afterClosed().subscribe((result: DeliveryScanFlowResult) => {
        if (result?.success) {
          this.saveDelivery(result);
        }
      });
    });
  }

  private async saveDelivery(result: DeliveryScanFlowResult): Promise<void> {
    const lsx = (result.lsx || '').trim();
    if (!lsx) { alert('LSX không hợp lệ.'); return; }

    const newLines = (result.pxkLines || []).map(r => ({
      materialCode: r.materialCode,
      poNumber: r.poNumber,
      quantity: r.quantity,
      checkQuantity: r.checkQuantity
    }));

    const overItems = newLines.filter(l => (l.checkQuantity ?? 0) > (l.quantity ?? 0));
    if (overItems.length > 0) {
      const msg = overItems.map(l =>
        `${l.materialCode} / ${l.poNumber}: PXK=${l.quantity}, Giao=${l.checkQuantity ?? 0}`
      ).join('\n');
      if (!confirm(`⚠️ Cảnh báo: Lượng giao vượt PXK:\n\n${msg}\n\nBạn có chắc muốn lưu?`)) {
        return;
      }
    }

    try {
      // Tìm document hiện tại của LSX này
      const snap = await this.firestore.collection('rm1-delivery-records', ref =>
        ref.where('mode', '==', 'giao-hang').where('lsx', '==', lsx).limit(1)
      ).get().toPromise();

      const baseRecord = {
        mode: 'giao-hang',
        employeeId: result.employeeGiaoId || '',
        employeeName: result.employeeGiaoName || '',
        receiverEmployeeId: result.employeeNhanId || '',
        receiverEmployeeName: result.employeeNhanName || '',
        lsx,
        lineNhan: result.lineNhan || '',
        timestamp: new Date()
      };

      if (snap && !snap.empty) {
        // Upsert: giữ các dòng cũ không trùng, thay dòng cũ trùng materialCode+PO bằng dòng mới
        const existingDoc = snap.docs[0];
        const existingData = existingDoc.data() as any;
        const oldLines: any[] = existingData.pxkLines || [];

        // Key trùng = materialCode+PO có trong new scan
        const newKeys = new Set(newLines.map(l => `${l.materialCode}||${l.poNumber}`));
        // Giữ lại dòng cũ không có trong new scan
        const keptOldLines = oldLines.filter(l =>
          !newKeys.has(`${l.materialCode || ''}||${l.poNumber || ''}`)
        );
        const mergedLines = [...keptOldLines, ...newLines];

        await this.firestore.collection('rm1-delivery-records').doc(existingDoc.id).update({
          ...baseRecord,
          pxkLines: mergedLines
        });
      } else {
        // Tạo mới
        await this.firestore.collection('rm1-delivery-records').add({
          ...baseRecord,
          pxkLines: newLines,
          createdAt: new Date()
        });
      }

      alert('Đã lưu thành công.');
      // Nếu đang search đúng LSX này thì refresh kết quả
      if (this.searchLsx.trim() === lsx) {
        await this.onSearchLsx();
      }
    } catch (error) {
      console.error('Error saving delivery:', error);
      alert('Lỗi khi lưu: ' + (error as Error).message);
    }
  }

  // ─── Xóa lịch sử theo LSX ────────────────────────────────
  async deleteLsxHistory(): Promise<void> {
    const lsx = window.prompt('Nhập mã LSX cần xóa lịch sử:');
    if (!lsx || !lsx.trim()) return;
    const lsxInput = lsx.trim();

    if (!window.confirm(`Xóa toàn bộ lịch sử giao hàng của LSX: ${lsxInput}?\nThao tác không thể hoàn tác.`)) return;

    try {
      const snap = await this.firestore.collection('rm1-delivery-records', ref =>
        ref.where('mode', '==', 'giao-hang').where('lsx', '==', lsxInput)
      ).get().toPromise();

      if (!snap || snap.empty) {
        alert(`Không tìm thấy bản ghi nào cho LSX: ${lsxInput}`);
        return;
      }

      const batch = this.firestore.firestore.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      alert(`Đã xóa ${snap.docs.length} bản ghi của LSX: ${lsxInput}`);
      this.loadDeliveryHistory();
    } catch (error) {
      alert('Lỗi khi xóa: ' + (error as Error).message);
    }
  }

  // ─── In chi tiết theo LSX ─────────────────────────────────
  async printByLsx(): Promise<void> {
    const lsx = window.prompt('Nhập mã LSX cần in chi tiết:');
    if (!lsx || !lsx.trim()) return;
    const lsxInput = lsx.trim();

    try {
      const snap = await this.firestore.collection('rm1-delivery-records', ref =>
        ref.where('lsx', '==', lsxInput)
      ).get().toPromise();

      if (!snap || snap.empty) {
        alert(`Không tìm thấy dữ liệu cho LSX: ${lsxInput}`);
        return;
      }

      const records = snap.docs
        .map(doc => {
          const d = doc.data() as any;
          return {
            lsx: d.lsx,
            employeeName: d.employeeName || d.employeeId || '—',
            receiverEmployeeName: d.receiverEmployeeName || d.receiverEmployeeId || '—',
            lineNhan: d.lineNhan || '—',
            timestamp: d.timestamp?.toDate() || new Date(),
            pxkLines: d.pxkLines || []
          };
        })
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      this.openPrintWindow(records, lsxInput);
    } catch (error) {
      alert('Lỗi khi tải dữ liệu in: ' + (error as Error).message);
    }
  }

  private openPrintWindow(records: any[], lsx: string): void {
    const win = window.open('', '_blank', 'width=900,height=750');
    if (!win) { alert('Trình duyệt chặn popup. Vui lòng cho phép popup để in.'); return; }

    let rowsHtml = '';
    records.forEach((rec, idx) => {
      const lines = (rec.pxkLines || []) as any[];
      const linesHtml = lines.map((ln: any, i: number) => `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${ln.materialCode || ''}</td>
          <td>${ln.poNumber || ''}</td>
          <td style="text-align:center">${ln.quantity ?? ''}</td>
          <td style="text-align:center;font-weight:700">${ln.checkQuantity != null ? ln.checkQuantity : '—'}</td>
        </tr>`).join('');

      rowsHtml += `
        <div class="record">
          <div class="rec-head">
            <strong>Lần giao #${idx + 1}</strong>
            <span>${rec.timestamp.toLocaleString('vi-VN')}</span>
          </div>
          <div class="info-grid">
            <div class="ic"><div class="il">NV Giao</div><div class="iv">${rec.employeeName}</div></div>
            <div class="ic"><div class="il">NV Nhận</div><div class="iv">${rec.receiverEmployeeName}</div></div>
            <div class="ic"><div class="il">Line</div><div class="iv">${rec.lineNhan}</div></div>
            <div class="ic"><div class="il">LSX</div><div class="iv">${rec.lsx}</div></div>
          </div>
          <table>
            <thead>
              <tr><th>STT</th><th>Mã Nguyên Liệu</th><th>PO</th><th>Số lượng</th><th>Lượng Giao</th></tr>
            </thead>
            <tbody>${linesHtml || '<tr><td colspan="5" style="text-align:center;color:#999">Không có dữ liệu</td></tr>'}</tbody>
          </table>
        </div>`;
    });

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Giao hàng – LSX ${lsx}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 12mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background: #fff; }
    .no-print { background:#fffbe6; border:1px solid #e6c000; padding:8px 14px; margin-bottom:14px;
                border-radius:4px; display:flex; justify-content:space-between; align-items:center; }
    .no-print button { background:#0f172a; color:#fff; border:none; padding:7px 18px;
                       border-radius:4px; cursor:pointer; font-size:12px; }
    .page-hdr { text-align:center; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:14px; }
    .page-hdr h1 { font-size:16px; margin-bottom:4px; letter-spacing:1px; }
    .page-hdr p { font-size:11px; color:#444; }
    .record { border:1px solid #ccc; border-radius:4px; margin-bottom:14px; page-break-inside:avoid; overflow:hidden; }
    .rec-head { background:#f0f0f0; padding:5px 10px; display:flex; justify-content:space-between;
                align-items:center; font-size:11px; border-bottom:1px solid #ccc; }
    .info-grid { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid #ccc; }
    .ic { padding:5px 8px; border-right:1px solid #e0e0e0; }
    .ic:last-child { border-right:none; }
    .il { font-size:9px; color:#666; text-transform:uppercase; font-weight:700; letter-spacing:.3px; }
    .iv { font-size:11px; font-weight:700; color:#000; margin-top:2px; }
    table { width:100%; border-collapse:collapse; }
    thead th { background:#f8f8f8; padding:5px 8px; text-align:left; border:1px solid #ccc;
               font-size:10px; text-transform:uppercase; }
    tbody td { padding:4px 8px; border:1px solid #e0e0e0; font-size:11px; }
    tbody tr:nth-child(even) td { background:#fafafa; }
    .print-footer { margin-top:14px; font-size:9px; color:#999; text-align:right; }
    @media print { .no-print { display:none !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    <span>Nhấn <strong>Ctrl+P</strong> hoặc bấm nút để in theo khổ A4</span>
    <button onclick="window.print()">🖨 In ngay</button>
  </div>
  <div class="page-hdr">
    <h1>BÁO CÁO GIAO HÀNG</h1>
    <p>Lệnh Sản Xuất: <strong>${lsx}</strong> &nbsp;|&nbsp; Ngày in: ${new Date().toLocaleDateString('vi-VN')} &nbsp;|&nbsp; Tổng: ${records.length} lần giao</p>
  </div>
  ${rowsHtml}
  <div class="print-footer">In lúc: ${new Date().toLocaleString('vi-VN')}</div>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  // ─── Tải về theo tháng ────────────────────────────────────
  async downloadByMonth(): Promise<void> {
    const defaultMonth = this.currentMonthStr();
    const monthInput = window.prompt('Nhập tháng cần tải về (YYYY-MM):', defaultMonth);
    if (!monthInput || !monthInput.trim()) return;

    const match = monthInput.trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      alert('Định dạng không hợp lệ. Vui lòng nhập dạng YYYY-MM (VD: 2026-02)');
      return;
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const startDate = new Date(year, month, 1, 0, 0, 0);
    const endDate   = new Date(year, month + 1, 0, 23, 59, 59);

    try {
      // Chỉ dùng 1 điều kiện range để tránh cần composite index
      const snap = await this.firestore.collection('rm1-delivery-records', ref =>
        ref.where('timestamp', '>=', startDate)
          .where('timestamp', '<=', endDate)
      ).get().toPromise();

      if (!snap || snap.empty) {
        alert(`Không có dữ liệu giao hàng trong tháng ${monthInput.trim()}`);
        return;
      }

      const header = ['Thời gian', 'LSX', 'NV Giao', 'NV Nhận', 'Line', 'Mã Nguyên Liệu', 'PO', 'Số lượng', 'Lượng Giao'];
      const rows: string[][] = [header];

      const sortedDocs = [...(snap?.docs || [])].sort((a, b) => {
        const ta = (a.data() as any).timestamp?.toDate?.()?.getTime() ?? 0;
        const tb = (b.data() as any).timestamp?.toDate?.()?.getTime() ?? 0;
        return ta - tb;
      });

      sortedDocs.forEach(doc => {
        const d = doc.data() as any;
        const ts  = d.timestamp?.toDate()?.toLocaleString('vi-VN') || '';
        const lsx = d.lsx || '';
        const nv  = d.employeeName  || d.employeeId  || '';
        const rec = d.receiverEmployeeName || d.receiverEmployeeId || '';
        const ln  = d.lineNhan || '';
        const lines = Array.isArray(d.pxkLines) ? d.pxkLines : [];

        if (lines.length === 0) {
          rows.push([ts, lsx, nv, rec, ln, '', '', '', '']);
        } else {
          lines.forEach((line: any) => {
            rows.push([ts, lsx, nv, rec, ln,
              line.materialCode || '',
              line.poNumber || '',
              String(line.quantity ?? ''),
              String(line.checkQuantity ?? '')
            ]);
          });
        }
      });

      const bom = '\uFEFF';
      const csv = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ).join('\r\n');

      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `RM1-Delivery-${monthInput.trim()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(`Đã tải về ${snap.docs.length} bản ghi của tháng ${monthInput.trim()}`);
    } catch (error) {
      alert('Lỗi khi tải dữ liệu: ' + (error as Error).message);
    }
  }

  private currentMonthStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // ─── Load history (không dùng orderBy → tránh lỗi index Firestore) ───
  loadDeliveryHistory(): void {
    this.isLoadingHistory = true;
    this.firestore.collection('rm1-delivery-records', ref =>
      ref.where('mode', '==', 'giao-hang').limit(100)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.deliveryHistory = snapshot
          .map(doc => this.mapRecord(doc.payload.doc.id, doc.payload.doc.data() as any))
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        this.isLoadingHistory = false;
      },
      error: (err) => {
        console.error('loadDeliveryHistory error:', err);
        this.isLoadingHistory = false;
      }
    });
  }

  /** Query thẳng Firestore theo LSX khi search */
  async onSearchLsx(): Promise<void> {
    const q = this.searchLsx.trim();
    if (!q) {
      this.searchResults = null;
      return;
    }

    this.isSearching = true;
    try {
      // Tìm exact match trước
      const snap = await this.firestore.collection('rm1-delivery-records', ref =>
        ref.where('mode', '==', 'giao-hang').where('lsx', '==', q)
      ).get().toPromise();

      const results = (snap?.docs || [])
        .map(doc => this.mapRecord(doc.id, doc.data() as any))
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      this.searchResults = results;
    } catch (err) {
      console.error('Search error:', err);
      this.searchResults = [];
    } finally {
      this.isSearching = false;
    }
  }

  clearSearch(): void {
    this.searchLsx = '';
    this.searchResults = null;
  }

  private mapRecord(id: string, data: any): DeliveryRecord {
    return {
      id,
      mode: 'giao-hang',
      employeeId: data.employeeId || '',
      employeeName: data.employeeName || '',
      receiverEmployeeId: data.receiverEmployeeId || '',
      receiverEmployeeName: data.receiverEmployeeName || '',
      lsx: data.lsx || '',
      lineNhan: data.lineNhan || '',
      pxkLines: data.pxkLines || [],
      timestamp: data.timestamp?.toDate() || new Date(),
      createdAt: data.createdAt?.toDate()
    } as DeliveryRecord;
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  formatDate(date: Date): string {
    return date.toLocaleString('vi-VN');
  }
}
