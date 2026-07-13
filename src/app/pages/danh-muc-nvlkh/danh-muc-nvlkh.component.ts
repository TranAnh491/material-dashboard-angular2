import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import * as XLSX from 'xlsx';
import { NvlkhCatalogService, NvlkhEntry } from '../../services/nvlkh-catalog.service';

@Component({
  selector: 'app-danh-muc-nvlkh',
  templateUrl: './danh-muc-nvlkh.component.html',
  styleUrls: ['./danh-muc-nvlkh.component.scss']
})
export class DanhMucNvlkhComponent implements OnInit {
  entries: NvlkhEntry[] = [];
  filteredEntries: NvlkhEntry[] = [];
  isLoading = false;
  isImporting = false;
  searchText = '';

  constructor(
    private catalogService: NvlkhCatalogService,
    private router: Router
  ) {}

  ngOnInit(): void {
    void this.loadEntries();
  }

  async loadEntries(): Promise<void> {
    this.isLoading = true;
    try {
      this.entries = await this.catalogService.listEntries();
      this.applyFilters();
    } catch (e) {
      console.error(e);
      alert('Không tải được Danh mục NVLKH.');
    } finally {
      this.isLoading = false;
    }
  }

  applyFilters(): void {
    const q = this.searchText.trim().toLowerCase();
    this.filteredEntries = this.entries.filter(entry => {
      if (!q) return true;
      return entry.materialCode.toLowerCase().includes(q) || entry.customer.toLowerCase().includes(q);
    });
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  formatUpdatedAt(entry: NvlkhEntry): string {
    return entry.updatedAt ? entry.updatedAt.toLocaleString('vi-VN', { hour12: false }) : '—';
  }

  async deleteEntry(entry: NvlkhEntry): Promise<void> {
    if (!confirm(`Xóa mã NVL ${entry.materialCode} khỏi Danh mục NVLKH?`)) return;
    try {
      await this.catalogService.deleteEntry(entry.id);
      this.entries = this.entries.filter(e => e.id !== entry.id);
      this.applyFilters();
    } catch (e) {
      console.error(e);
      alert('Không xóa được bản ghi.');
    }
  }

  /** Import Excel: cột A = Mã NVL, cột B = Khách hàng (dòng 1 = tiêu đề). */
  importFromExcel(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files?.[0];
      if (file) this.processImportFile(file);
    };
    input.click();
  }

  private processImportFile(file: File): void {
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const rows: Array<{ materialCode: string; customer: string }> = [];
        const seen = new Set<string>();
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length < 2) continue;
          const materialCode = String(row[0] ?? '').trim();
          const customer = String(row[1] ?? '').trim();
          if (!materialCode || !customer) continue;
          const key = materialCode.toUpperCase();
          if (seen.has(key)) {
            const idx = rows.findIndex(r => r.materialCode.toUpperCase() === key);
            if (idx >= 0) rows.splice(idx, 1);
          }
          seen.add(key);
          rows.push({ materialCode, customer });
        }

        if (!rows.length) {
          alert(
            'Không tìm thấy dữ liệu hợp lệ để import.\nVui lòng kiểm tra:\n- Dòng 1 là tiêu đề (Mã NVL, Khách hàng)\n- Từ dòng 2 trở đi: cột A = Mã NVL, cột B = Khách hàng'
          );
          return;
        }

        if (
          !confirm(
            `Import sẽ THAY THẾ TOÀN BỘ Danh mục NVLKH hiện tại bằng ${rows.length} mã trong file này.\nMã nào không có trong file sẽ bị XÓA khỏi danh mục.\n\nTiếp tục?`
          )
        ) {
          return;
        }

        this.isImporting = true;
        const count = await this.catalogService.importFromRows(rows);
        alert(`✅ Đã import ${count} mã NVL vào Danh mục NVLKH.`);
        await this.loadEntries();
      } catch (error) {
        console.error('Error processing NVLKH import file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      } finally {
        this.isImporting = false;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  downloadTemplate(): void {
    try {
      const templateData = [
        ['Mã NVL', 'Khách hàng'],
        ['B123456', 'Customer A'],
        ['B234567', 'Shared'],
        ['B345678', 'Customer B']
      ];
      const ws = XLSX.utils.aoa_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'NVLKH Template');
      XLSX.writeFile(wb, 'NVLKH_Template.xlsx');
    } catch (error) {
      console.error('Error creating NVLKH template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }
}
