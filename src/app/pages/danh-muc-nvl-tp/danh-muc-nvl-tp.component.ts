import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import * as XLSX from 'xlsx';
import { NvlCatalogFullService, NvlCatalogItem } from '../../services/nvl-catalog-full.service';
import { TpCatalogFullService, MergedCatalogItem, TpImportRow } from '../../services/tp-catalog-full.service';
import { CatalogDeleteOtpService, CatalogDeleteScope } from '../../services/catalog-delete-otp.service';
import { CartonPackingQtyService } from '../../services/carton-packing-qty.service';
import { FirebaseAuthService } from '../../services/firebase-auth.service';

type CatalogTab = 'nvl' | 'tp';

/**
 * Tab quản lý toàn bộ Danh mục NVL & TP — gộp từ 2 nơi trước đây:
 * - NVL: modal "Quản lý Standard Packing" trong Materials ASM1/ASM2 (collection `materials`).
 * - TP: modal "Danh mục TP & Mapping KH-TP" trong FG In (collection `fg-catalog` + `fg-customer-mapping`).
 * Materials ASM1/ASM2 và FG In vẫn tự đọc dữ liệu (read-only) để hiển thị trên bảng của chúng;
 * chỉnh sửa/thêm/xóa danh mục chỉ thực hiện ở đây.
 */
@Component({
  selector: 'app-danh-muc-nvl-tp',
  templateUrl: './danh-muc-nvl-tp.component.html',
  styleUrls: ['./danh-muc-nvl-tp.component.scss']
})
export class DanhMucNvlTpComponent implements OnInit {
  activeTab: CatalogTab = 'nvl';

  readonly pageSizeOptions = [10, 25, 50, 100];

  // ===== NVL state =====
  nvlItems: NvlCatalogItem[] = [];
  filteredNvlItems: NvlCatalogItem[] = [];
  pagedNvlItems: NvlCatalogItem[] = [];
  nvlSearchText = '';
  nvlColumnFilters = { materialCode: '', materialName: '', unit: '' };
  nvlPageSize = 25;
  nvlCurrentPage = 1;
  nvlLoadedAt: Date | null = null;
  isNvlLoading = false;
  isNvlImporting = false;
  showNvlAddForm = false;
  newNvlItem = { materialCode: '', materialName: '', unit: '', standardPacking: 0 };

  // ===== TP state =====
  tpItems: MergedCatalogItem[] = [];
  filteredTpItems: MergedCatalogItem[] = [];
  pagedTpItems: MergedCatalogItem[] = [];
  tpSearchText = '';
  tpColumnFilters = {
    materialCode: '',
    customerCode: '',
    productName: '',
    unit: '',
    description: '',
    cartonSize: '',
    grossWeight: '',
    netWeight: '',
    standard: ''
  };
  tpPageSize = 25;
  tpCurrentPage = 1;
  tpLoadedAt: Date | null = null;
  isTpLoading = false;
  isTpImporting = false;
  isTpCopyingCartonQty = false;
  showTpAddForm = false;
  tpLastImportAt: Date | null = null;
  tpLastImportDetail = '';
  newTpItem = {
    materialCode: '',
    standard: '',
    customerCode: '',
    description: '',
    productName: '',
    unit: '',
    cartonSize: '',
    grossWeight: '',
    netWeight: ''
  };

  // ===== Xóa toàn bộ danh mục (OTP qua Zalo → ASP0106) =====
  showDeleteAllDialog = false;
  deleteAllScope: CatalogDeleteScope = 'nvl';
  deleteAllStep: 'confirm' | 'otp' = 'confirm';
  deleteAllSending = false;
  deleteAllVerifying = false;
  deleteAllCode = '';

  constructor(
    private nvlService: NvlCatalogFullService,
    private tpService: TpCatalogFullService,
    private catalogDeleteOtp: CatalogDeleteOtpService,
    private cartonPackingQtyService: CartonPackingQtyService,
    private authService: FirebaseAuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'tp' || tab === 'nvl') this.activeTab = tab;
    void this.loadNvl();
    void this.loadTp();
  }

  setTab(tab: CatalogTab): void {
    this.activeTab = tab;
  }

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }

  toggleNvlAddForm(): void {
    this.showNvlAddForm = !this.showNvlAddForm;
  }

  toggleTpAddForm(): void {
    this.showTpAddForm = !this.showTpAddForm;
  }

  // ===== NVL =====

  async loadNvl(forceRefresh = false): Promise<void> {
    this.isNvlLoading = true;
    try {
      this.nvlItems = await this.nvlService.listAll(forceRefresh);
      this.nvlLoadedAt = new Date();
      this.applyNvlFilters();
    } catch (e: any) {
      console.error(e);
      alert('Không tải được Danh mục NVL.\n' + (e?.message || e));
    } finally {
      this.isNvlLoading = false;
    }
  }

  applyNvlFilters(): void {
    const q = this.nvlSearchText.trim().toLowerCase();
    const cf = this.nvlColumnFilters;
    this.filteredNvlItems = this.nvlItems.filter(item => {
      if (q && !(item.materialCode.toLowerCase().includes(q) || item.materialName.toLowerCase().includes(q))) return false;
      if (cf.materialCode && !item.materialCode.toLowerCase().includes(cf.materialCode.toLowerCase())) return false;
      if (cf.materialName && !item.materialName.toLowerCase().includes(cf.materialName.toLowerCase())) return false;
      if (cf.unit && !item.unit.toLowerCase().includes(cf.unit.toLowerCase())) return false;
      return true;
    });
    this.nvlCurrentPage = 1;
    this.updateNvlPaging();
  }

  onNvlSearchChange(): void {
    this.applyNvlFilters();
  }

  clearNvlSearch(): void {
    this.nvlSearchText = '';
    this.applyNvlFilters();
  }

  updateNvlPaging(): void {
    const start = (this.nvlCurrentPage - 1) * this.nvlPageSize;
    this.pagedNvlItems = this.filteredNvlItems.slice(start, start + this.nvlPageSize);
  }

  get nvlTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredNvlItems.length / this.nvlPageSize));
  }

  setNvlPage(page: number): void {
    this.nvlCurrentPage = Math.min(Math.max(1, page), this.nvlTotalPages);
    this.updateNvlPaging();
  }

  onNvlPageSizeChange(): void {
    this.nvlCurrentPage = 1;
    this.updateNvlPaging();
  }

  nvlPageNumbers(): Array<number | '...'> {
    return this.buildPageNumbers(this.nvlCurrentPage, this.nvlTotalPages);
  }

  async addNvlItem(): Promise<void> {
    const code = this.newNvlItem.materialCode.trim();
    if (!code) {
      alert('Vui lòng nhập Mã NVL');
      return;
    }
    try {
      await this.nvlService.addNew(this.newNvlItem);
      this.newNvlItem = { materialCode: '', materialName: '', unit: '', standardPacking: 0 };
      await this.loadNvl();
      alert(`✅ Đã thêm mã NVL "${code}"`);
    } catch (e: any) {
      alert('❌ ' + (e?.message || e));
    }
  }

  async updateNvlItem(item: NvlCatalogItem): Promise<void> {
    if (item.standardPackingLocked) {
      alert('⚠️ Mã này đang Lock — không thể sửa. Tắt Lock trước.');
      await this.loadNvl();
      return;
    }
    try {
      await this.nvlService.update(item.materialCode, {
        materialName: item.materialName,
        unit: item.unit,
        standardPacking: item.standardPacking
      });
    } catch (e: any) {
      alert('❌ Lỗi khi cập nhật: ' + (e?.message || e));
      await this.loadNvl();
    }
  }

  async toggleNvlLock(item: NvlCatalogItem): Promise<void> {
    const next = !item.standardPackingLocked;
    try {
      await this.nvlService.setLocked(item.materialCode, next);
      item.standardPackingLocked = next;
    } catch (e) {
      console.error(e);
      alert('❌ Không lưu được trạng thái Lock.');
    }
  }

  async deleteNvlItem(item: NvlCatalogItem): Promise<void> {
    if (!confirm(`Xóa mã NVL "${item.materialCode}" khỏi danh mục?`)) return;
    try {
      await this.nvlService.deleteItem(item.materialCode);
      this.nvlItems = this.nvlItems.filter(i => i.materialCode !== item.materialCode);
      this.applyNvlFilters();
    } catch (e) {
      console.error(e);
      alert('❌ Không xóa được bản ghi.');
    }
  }

  importNvlFromExcel(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = (event: any) => {
      const file = event.target.files?.[0];
      if (file) void this.processNvlImportFile(file);
    };
    input.click();
  }

  private async processNvlImportFile(file: File): Promise<void> {
    this.isNvlImporting = true;
    try {
      const rows = await this.readExcelRows(file);
      const parsed = rows
        .map((row: any) => ({
          materialCode: String(row['Mã hàng'] || row['Mã NVL'] || row['materialCode'] || '').trim(),
          standardPacking: parseFloat(row['Standard Packing'] || row['standardPacking'] || '0') || 0
        }))
        .filter(r => r.materialCode);

      if (!parsed.length) {
        alert('Không tìm thấy dòng hợp lệ (cần cột "Mã hàng" và "Standard Packing").');
        return;
      }
      const result = await this.nvlService.importStandardPackingFromRows(parsed);
      alert(
        `✅ Import xong!\n✏️ Ghi đè: ${result.updated}\n⏭️ Bỏ qua (không có trong danh mục hoặc đang Lock): ${result.skipped}\n📄 Tổng mã trong file: ${result.uniqueInFile}`
      );
      await this.loadNvl();
    } catch (e: any) {
      console.error(e);
      alert('Lỗi khi đọc file: ' + (e?.message || e));
    } finally {
      this.isNvlImporting = false;
    }
  }

  downloadNvlTemplate(): void {
    const templateData = [
      { 'Mã hàng': 'B123456', 'Standard Packing': 100 },
      { 'Mã hàng': 'B234567', 'Standard Packing': 200 }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'NVL Template');
    XLSX.writeFile(wb, 'NVL_StandardPacking_Template.xlsx');
  }

  exportNvlCurrent(): void {
    const rows = this.filteredNvlItems.map(i => ({
      'Mã hàng': i.materialCode,
      Tên: i.materialName,
      ĐVT: i.unit,
      'Standard Packing': i.standardPacking
    }));
    if (!rows.length) {
      alert('Không có dữ liệu để tải');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh muc NVL');
    XLSX.writeFile(wb, `Danh_Muc_NVL_${this.timestamp()}.xlsx`);
  }

  // ===== TP =====

  async loadTp(forceRefresh = false): Promise<void> {
    this.isTpLoading = true;
    try {
      this.tpItems = await this.tpService.loadMerged(forceRefresh);
      const cartonQtyMap = await this.cartonPackingQtyService.loadAllAsMap(forceRefresh);
      this.tpItems.forEach(item => {
        item.cartonPackingQty = cartonQtyMap.get(item.materialCode.toUpperCase()) || undefined;
      });
      this.tpLoadedAt = new Date();
      this.applyTpFilters();
      const meta = await this.tpService.loadLastImportMeta();
      this.tpLastImportAt = meta?.lastImportAt || null;
      this.tpLastImportDetail = meta
        ? [meta.fileName, meta.addedCount || meta.updatedCount ? `thêm ${meta.addedCount}, ghi đè ${meta.updatedCount}` : '']
            .filter(Boolean)
            .join(' · ')
        : '';
    } catch (e: any) {
      console.error(e);
      alert('Không tải được Danh mục TP.\n' + (e?.message || e));
    } finally {
      this.isTpLoading = false;
    }
  }

  applyTpFilters(): void {
    const q = this.tpSearchText.trim().toUpperCase();
    const cf = this.tpColumnFilters;
    const contains = (value: string, needle: string) => value.toUpperCase().includes(needle.toUpperCase());
    this.filteredTpItems = this.tpItems.filter(item => {
      if (
        q &&
        ![item.materialCode, item.customerCode, item.description, item.productName]
          .filter(Boolean)
          .join(' ')
          .toUpperCase()
          .includes(q)
      ) {
        return false;
      }
      if (cf.materialCode && !contains(item.materialCode, cf.materialCode)) return false;
      if (cf.customerCode && !contains(item.customerCode, cf.customerCode)) return false;
      if (cf.productName && !contains(item.productName, cf.productName)) return false;
      if (cf.unit && !contains(item.unit, cf.unit)) return false;
      if (cf.description && !contains(item.description, cf.description)) return false;
      if (cf.cartonSize && !contains(item.cartonSize, cf.cartonSize)) return false;
      if (cf.grossWeight && !contains(item.grossWeight, cf.grossWeight)) return false;
      if (cf.netWeight && !contains(item.netWeight, cf.netWeight)) return false;
      if (cf.standard && !contains(item.standard, cf.standard)) return false;
      return true;
    });
    this.tpCurrentPage = 1;
    this.updateTpPaging();
  }

  onTpSearchChange(): void {
    this.applyTpFilters();
  }

  clearTpSearch(): void {
    this.tpSearchText = '';
    this.applyTpFilters();
  }

  updateTpPaging(): void {
    const start = (this.tpCurrentPage - 1) * this.tpPageSize;
    this.pagedTpItems = this.filteredTpItems.slice(start, start + this.tpPageSize);
  }

  get tpTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredTpItems.length / this.tpPageSize));
  }

  setTpPage(page: number): void {
    this.tpCurrentPage = Math.min(Math.max(1, page), this.tpTotalPages);
    this.updateTpPaging();
  }

  onTpPageSizeChange(): void {
    this.tpCurrentPage = 1;
    this.updateTpPaging();
  }

  tpPageNumbers(): Array<number | '...'> {
    return this.buildPageNumbers(this.tpCurrentPage, this.tpTotalPages);
  }

  private buildPageNumbers(current: number, total: number): Array<number | '...'> {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: Array<number | '...'> = [1];
    if (current > 3) pages.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  async addTpItem(): Promise<void> {
    const mc = this.newTpItem.materialCode.trim();
    const cc = this.newTpItem.customerCode.trim();
    if (!mc && !cc) {
      alert('Vui lòng nhập ít nhất Mã TP hoặc Mã KH');
      return;
    }
    const exists = this.tpItems.some(
      i => i.materialCode.toUpperCase() === mc.toUpperCase() && i.customerCode.toUpperCase() === cc.toUpperCase()
    );
    if (exists) {
      alert(`❌ Cặp Mã TP "${mc}" + Mã KH "${cc}" đã tồn tại`);
      return;
    }
    try {
      await this.tpService.addItem(this.newTpItem);
      this.newTpItem = {
        materialCode: '',
        standard: '',
        customerCode: '',
        description: '',
        productName: '',
        unit: '',
        cartonSize: '',
        grossWeight: '',
        netWeight: ''
      };
      await this.loadTp();
      alert('✅ Đã thêm vào danh mục');
    } catch (e: any) {
      alert('❌ ' + (e?.message || e));
    }
  }

  async updateTpItem(item: MergedCatalogItem): Promise<void> {
    try {
      await this.tpService.updateItem(item);
    } catch (e: any) {
      alert('❌ Lỗi khi cập nhật: ' + (e?.message || e));
      await this.loadTp();
    }
  }

  /** Sửa Lượng Đóng Thùng — danh mục riêng của Kho, không thuộc fg-catalog. */
  async updateTpCartonPackingQty(item: MergedCatalogItem): Promise<void> {
    try {
      await this.cartonPackingQtyService.upsert(item.materialCode, item.cartonPackingQty || 0);
    } catch (e: any) {
      alert('❌ Lỗi khi lưu Lượng Đóng Thùng: ' + (e?.message || e));
      await this.loadTp();
    }
  }

  /** Bước 1: copy toàn bộ SL SP/thùng hiện có sang Lượng Đóng Thùng (ghi đè). */
  async copyCartonPackingQtyFromStandard(): Promise<void> {
    const withStandard = this.tpItems.filter(i => parseFloat(i.standard) > 0).length;
    if (withStandard === 0) {
      alert('Không có dòng nào có SL SP/thùng > 0 để copy.');
      return;
    }
    if (
      !confirm(
        `Copy SL SP/thùng sang Lượng Đóng Thùng cho ${withStandard} mã.\n\nSẽ GHI ĐÈ Lượng Đóng Thùng hiện có (nếu có). Tiếp tục?`
      )
    ) {
      return;
    }
    this.isTpCopyingCartonQty = true;
    try {
      const count = await this.cartonPackingQtyService.copyAllFromStandard(
        this.tpItems.map(i => ({ materialCode: i.materialCode, standard: i.standard }))
      );
      await this.loadTp(true);
      alert(`✅ Đã copy Lượng Đóng Thùng cho ${count} mã.`);
    } catch (e: any) {
      alert('❌ Lỗi khi copy: ' + (e?.message || e));
    } finally {
      this.isTpCopyingCartonQty = false;
    }
  }

  async deleteTpItem(item: MergedCatalogItem): Promise<void> {
    if (!confirm(`Xác nhận xóa Mã TP "${item.materialCode}" / Mã KH "${item.customerCode}"?`)) return;
    try {
      await this.tpService.deleteItem(item);
      await this.loadTp();
    } catch (e) {
      console.error(e);
      alert('❌ Lỗi khi xóa');
    }
  }

  importTpFromExcel(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = (event: any) => {
      const file = event.target.files?.[0];
      if (file) void this.processTpImportFile(file);
    };
    input.click();
  }

  /**
   * Import = THAY THẾ TOÀN BỘ Danh mục TP hiện tại bằng dữ liệu trong file (chỉ giữ các cột dưới đây,
   * bỏ hết các cột khác trong file gốc). Trùng Mã S.Phẩm KH (Mã KH) → ưu tiên giữ dòng có "Ngày tạo
   * bản vẽ" mới nhất; nếu không có ngày (hoặc bằng nhau) thì giữ dòng nằm cuối file (hành vi cũ).
   */
  private async processTpImportFile(file: File): Promise<void> {
    this.isTpImporting = true;
    try {
      const rows = await this.readExcelRows(file);
      const parsed: TpImportRow[] = rows
        .map((row: any) => ({
          materialCode: String(row['Mã vật tư'] || '').trim(),
          customerCode: String(row['Mã S.Phẩm KH'] || '').trim(),
          productName: String(row['Tên vật tư'] || '').trim(),
          unit: String(row['Đvt'] || '').trim(),
          description: String(row['Khách hàng'] || '').trim(),
          cartonSize: String(row['K.Thước thùng (cm)'] || '').trim(),
          grossWeight: String(row['Gross Weight'] || '').trim(),
          netWeight: String(row['Net Weight'] || '').trim(),
          standard: String(row['SL SP trên thùng'] || '').trim(),
          drawingDate: this.parseExcelDate(row['Ngày tạo bản vẽ'])
        }))
        .filter(r => r.materialCode || r.customerCode);

      if (!parsed.length) {
        alert('❌ Không có dòng hợp lệ (cần ít nhất Mã vật tư hoặc Mã S.Phẩm KH)');
        return;
      }
      if (
        !confirm(
          `Import sẽ XÓA TOÀN BỘ Danh mục TP hiện tại (${this.tpItems.length} dòng) và thay bằng ${parsed.length} dòng trong file này.\n` +
            `Mã S.Phẩm KH trùng nhau sẽ ưu tiên giữ dòng có Ngày tạo bản vẽ mới nhất.\n\nHành động không thể hoàn tác. Tiếp tục?`
        )
      ) {
        return;
      }
      const result = await this.tpService.replaceAllFromRows(parsed, file.name);
      alert(`✅ Import hoàn tất! Danh mục TP hiện có ${result.count} dòng.`);
      await this.loadTp(true);
    } catch (e: any) {
      alert('❌ Lỗi đọc file: ' + (e?.message || e));
    } finally {
      this.isTpImporting = false;
    }
  }

  async deleteTpItemsWithoutCustomerCode(): Promise<void> {
    const count = this.tpItems.filter(i => !i.customerCode.trim()).length;
    if (count === 0) {
      alert('Không có dòng nào thiếu Mã KH.');
      return;
    }
    if (!confirm(`Xác nhận xóa ${count} dòng không có Mã KH khỏi Danh mục TP?\n\nHành động này không thể hoàn tác.`)) return;
    try {
      const deleted = await this.tpService.deleteItemsWithoutCustomerCode(this.tpItems);
      await this.loadTp(true);
      alert(`✅ Đã xóa ${deleted} dòng không có Mã KH.`);
    } catch (e: any) {
      alert('❌ Lỗi khi xóa: ' + (e?.message || e));
    }
  }

  downloadTpTemplate(): void {
    const templateData = [
      {
        'Mã vật tư': 'FG001',
        'Mã S.Phẩm KH': 'CUST001',
        'Tên vật tư': 'Sản phẩm A',
        Đvt: 'PCS',
        'Khách hàng': 'Khách hàng A',
        'K.Thước thùng (cm)': '40x30x20',
        'Gross Weight': '5.2',
        'Net Weight': '5.0',
        'SL SP trên thùng': '100'
      },
      {
        'Mã vật tư': 'FG002',
        'Mã S.Phẩm KH': 'CUST002',
        'Tên vật tư': 'Sản phẩm B',
        Đvt: 'PCS',
        'Khách hàng': 'Khách hàng B',
        'K.Thước thùng (cm)': '35x25x18',
        'Gross Weight': '4.1',
        'Net Weight': '4.0',
        'SL SP trên thùng': '200'
      }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_DanhMuc_Template.xlsx');
  }

  downloadTpCurrent(): void {
    const rows = this.filteredTpItems.map(item => ({
      'Mã vật tư': item.materialCode,
      'Mã S.Phẩm KH': item.customerCode,
      'Tên vật tư': item.productName,
      Đvt: item.unit,
      'Khách hàng': item.description,
      'K.Thước thùng (cm)': item.cartonSize,
      'Gross Weight': item.grossWeight,
      'Net Weight': item.netWeight,
      'SL SP trên thùng': item.standard
    }));
    if (!rows.length) {
      alert('❌ Không có dữ liệu để tải');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh muc');
    XLSX.writeFile(wb, `FG_DanhMuc_${this.timestamp()}.xlsx`);
  }

  formatUpdatedAt(date: Date | null | undefined): string {
    return date ? date.toLocaleString('vi-VN', { hour12: false }) : '—';
  }

  private timestamp(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(
      now.getHours()
    ).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  }

  private readExcelRows(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          resolve(XLSX.utils.sheet_to_json(worksheet));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /** Đọc "Ngày tạo bản vẽ" — chấp nhận cả ô định dạng ngày Excel (số serial), text dd/mm/yyyy, hoặc Date. */
  private parseExcelDate(raw: unknown): Date | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    if (typeof raw === 'number') {
      const utcMs = (raw - 25569) * 86400 * 1000;
      const d = new Date(utcMs);
      return isNaN(d.getTime()) ? null : d;
    }
    const s = String(raw).trim();
    if (!s) return null;
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }
    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // ===== Xóa toàn bộ danh mục (OTP qua Zalo → ASP0106) =====

  private get deleteAllScopeLabel(): string {
    return this.deleteAllScope === 'tp' ? 'Danh mục TP & Mapping KH' : 'Danh mục NVL';
  }

  openDeleteAllDialog(scope: CatalogDeleteScope): void {
    this.deleteAllScope = scope;
    this.deleteAllStep = 'confirm';
    this.deleteAllCode = '';
    this.showDeleteAllDialog = true;
  }

  closeDeleteAllDialog(): void {
    this.showDeleteAllDialog = false;
    this.deleteAllStep = 'confirm';
    this.deleteAllCode = '';
  }

  private async currentEmployeeId(): Promise<string> {
    try {
      const user = await firstValueFrom(this.authService.currentUser);
      return user?.employeeId || '';
    } catch {
      return '';
    }
  }

  async sendDeleteAllOtp(): Promise<void> {
    this.deleteAllSending = true;
    try {
      const requestedBy = await this.currentEmployeeId();
      await this.catalogDeleteOtp.requestOtp(this.deleteAllScope, requestedBy);
      this.deleteAllStep = 'otp';
    } catch (e: any) {
      alert('❌ Không gửi được mã xác nhận: ' + (e?.message || e));
    } finally {
      this.deleteAllSending = false;
    }
  }

  async confirmDeleteAll(): Promise<void> {
    const code = this.deleteAllCode.trim();
    if (!/^\d{4}$/.test(code)) {
      alert('Mã xác nhận phải gồm 4 chữ số.');
      return;
    }
    this.deleteAllVerifying = true;
    try {
      const ok = await this.catalogDeleteOtp.verifyOtp(this.deleteAllScope, code);
      if (!ok) {
        alert('❌ Mã xác nhận không đúng.');
        return;
      }
      if (this.deleteAllScope === 'nvl') {
        const count = await this.nvlService.deleteAll();
        await this.loadNvl(true);
        alert(`✅ Đã xóa ${count} mã khỏi ${this.deleteAllScopeLabel}.`);
      } else {
        const count = await this.tpService.deleteAll();
        await this.loadTp(true);
        alert(`✅ Đã xóa ${count} dòng khỏi ${this.deleteAllScopeLabel}.`);
      }
      this.closeDeleteAllDialog();
    } catch (e: any) {
      alert('❌ Lỗi khi xóa: ' + (e?.message || e));
    } finally {
      this.deleteAllVerifying = false;
    }
  }
}
