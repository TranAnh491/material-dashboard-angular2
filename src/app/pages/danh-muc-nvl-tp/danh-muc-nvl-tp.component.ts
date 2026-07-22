import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import * as XLSX from 'xlsx';
import { NvlCatalogFullService, NvlCatalogItem, OutboundQtyStats } from '../../services/nvl-catalog-full.service';
import { TpCatalogFullService, MergedCatalogItem, TpImportRow } from '../../services/tp-catalog-full.service';
import { CatalogDeleteOtpService, CatalogDeleteScope } from '../../services/catalog-delete-otp.service';
import { CartonPackingQtyService } from '../../services/carton-packing-qty.service';
import { NvlkhCatalogService } from '../../services/nvlkh-catalog.service';
import { DvLuuTruCatalogService } from '../../services/dv-luu-tru-catalog.service';
import { StorageUnitSize, getStorageUnitOption } from '../../models/storage-unit.model';
import { FirebaseAuthService } from '../../services/firebase-auth.service';

type CatalogTab = 'nvl' | 'tp';

/** Dòng hiển thị NVL — gộp thêm Khách hàng (NVLKH) và DV Lưu trữ (dữ liệu riêng, gộp vào tab này để sửa cùng chỗ). */
interface NvlCatalogRow extends NvlCatalogItem {
  customer: string;
  storageUnitSize: StorageUnitSize | '';
}

/** 1 dòng đề xuất sửa Standard Packing, suy ra từ lịch sử Outbound. */
interface SpAuditSuggestion {
  materialCode: string;
  materialName: string;
  currentSp: number;
  suggestedSp: number | null;
  sampleCount: number;
  totalScans: number;
  reason: 'missing' | 'decimal';
  locked: boolean;
}

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
  /** Chưa bấm chọn tab nào thì không hiển thị gì (và không tải dữ liệu). */
  activeTab: CatalogTab | null = null;

  readonly pageSizeOptions = [10, 25, 50, 100];

  // ===== NVL state =====
  nvlItems: NvlCatalogRow[] = [];
  filteredNvlItems: NvlCatalogRow[] = [];
  pagedNvlItems: NvlCatalogRow[] = [];
  nvlSearchText = '';
  nvlColumnFilters = { materialCode: '', materialName: '', unit: '', customer: '' };
  nvlPageSize = 25;
  nvlCurrentPage = 1;
  nvlLoadedAt: Date | null = null;
  isNvlLoading = false;
  isNvlImporting = false;
  isNvlKhImporting = false;
  isNvlDeduping = false;
  nvlOnlyWithStock = false;
  isNvlStockFilterLoading = false;
  private nvlCodesWithStock: Set<string> | null = null;
  showNvlAddForm = false;
  editingNvlCode: string | null = null;
  nvlEditDraft: Partial<NvlCatalogRow> | null = null;
  newNvlItem = { materialCode: '', materialName: '', unit: '', standardPacking: 0 };

  // ===== DV Lưu trữ (gộp từ Danh mục DV Lưu trữ) =====
  showStorageUnitPicker = false;
  storageUnitPickerMaterialCode = '';
  isSavingStorageUnit = false;

  // ===== Rà soát Standard Packing từ lịch sử Outbound =====
  isSpAuditRunning = false;
  showSpAuditPanel = false;
  spAuditSuggestions: SpAuditSuggestion[] = [];

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
    private nvlkhCatalog: NvlkhCatalogService,
    private dvLuuTruCatalog: DvLuuTruCatalogService,
    private authService: FirebaseAuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    this.setTab(tab === 'tp' ? 'tp' : 'nvl');
  }

  /** Chỉ tải dữ liệu của tab được chọn, và chỉ tải lần đầu tiên bấm vào — giảm lượt đọc. */
  setTab(tab: CatalogTab): void {
    this.activeTab = tab;
    if (tab === 'nvl' && !this.nvlLoadedAt) void this.loadNvl();
    if (tab === 'tp' && !this.tpLoadedAt) void this.loadTp();
  }

  goToMenu(): void {
    void this.router.navigate(['/menu']);
  }

  toggleNvlAddForm(): void {
    this.showNvlAddForm = !this.showNvlAddForm;
    if (this.showNvlAddForm) this.cancelEditNvl();
  }

  toggleTpAddForm(): void {
    this.showTpAddForm = !this.showTpAddForm;
  }

  isNvlEditing(row: NvlCatalogRow): boolean {
    return this.editingNvlCode === row.materialCode;
  }

  startEditNvl(row: NvlCatalogRow): void {
    this.editingNvlCode = row.materialCode;
    this.nvlEditDraft = {
      materialName: row.materialName,
      unit: row.unit,
      standardPacking: row.standardPacking,
      customer: row.customer
    };
    this.showNvlAddForm = false;
  }

  cancelEditNvl(): void {
    this.editingNvlCode = null;
    this.nvlEditDraft = null;
  }

  async saveEditNvl(row: NvlCatalogRow): Promise<void> {
    if (!this.nvlEditDraft) return;
    row.materialName = String(this.nvlEditDraft.materialName ?? row.materialName).trim();
    row.unit = String(this.nvlEditDraft.unit ?? row.unit).trim();
    row.standardPacking = Number(this.nvlEditDraft.standardPacking ?? row.standardPacking) || 0;
    row.customer = String(this.nvlEditDraft.customer ?? row.customer).trim();
    await this.updateNvlItem(row);
    await this.updateNvlKh(row);
    this.cancelEditNvl();
  }

  getCustomerTags(customer: string): string[] {
    return String(customer || '')
      .split(/[,;|/]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  isSharedCustomerTag(label: string): boolean {
    const v = label.trim().toLowerCase();
    return v === 'shared' || v === 'dùng chung' || v === 'dung chung';
  }

  // ===== NVL =====

  async loadNvl(forceRefresh = false): Promise<void> {
    this.isNvlLoading = true;
    try {
      const [items, customerMap, storageUnitMap] = await Promise.all([
        this.nvlService.listAll(forceRefresh),
        this.nvlkhCatalog.loadAllAsMap(forceRefresh),
        this.dvLuuTruCatalog.loadAllAsMap(forceRefresh)
      ]);
      this.nvlItems = items.map(i => ({
        ...i,
        customer: customerMap.get(i.materialCode) || '',
        storageUnitSize: storageUnitMap.get(this.dvLuuTruCatalog.normalizeMaterialCode(i.materialCode)) || ''
      }));
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
      if (q && !(
        item.materialCode.toLowerCase().includes(q) ||
        item.materialName.toLowerCase().includes(q) ||
        item.customer.toLowerCase().includes(q)
      )) return false;
      if (cf.materialCode && !item.materialCode.toLowerCase().includes(cf.materialCode.toLowerCase())) return false;
      if (cf.materialName && !item.materialName.toLowerCase().includes(cf.materialName.toLowerCase())) return false;
      if (cf.unit && !item.unit.toLowerCase().includes(cf.unit.toLowerCase())) return false;
      if (cf.customer && !item.customer.toLowerCase().includes(cf.customer.toLowerCase())) return false;
      if (this.nvlOnlyWithStock && this.nvlCodesWithStock && !this.nvlCodesWithStock.has(item.materialCode)) return false;
      return true;
    });
    this.nvlCurrentPage = 1;
    this.updateNvlPaging();
  }

  /** Bật/tắt chỉ hiển thị mã đang có tồn kho (ASM1 + ASM2) — chỉ đọc Firestore ở lần bật đầu tiên. */
  async toggleNvlOnlyWithStock(): Promise<void> {
    this.nvlOnlyWithStock = !this.nvlOnlyWithStock;
    if (this.nvlOnlyWithStock && !this.nvlCodesWithStock) {
      this.isNvlStockFilterLoading = true;
      try {
        this.nvlCodesWithStock = await this.nvlService.loadCodesWithStock();
      } catch (e) {
        console.error(e);
        alert('❌ Không tải được dữ liệu tồn kho để lọc.');
        this.nvlOnlyWithStock = false;
      } finally {
        this.isNvlStockFilterLoading = false;
      }
    }
    this.applyNvlFilters();
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
      const editedBy = await this.currentEmployeeId();
      await this.nvlService.addNew(this.newNvlItem, editedBy);
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
      const editedBy = await this.currentEmployeeId();
      await this.nvlService.update(
        item.materialCode,
        {
          materialName: item.materialName,
          unit: item.unit,
          standardPacking: item.standardPacking
        },
        editedBy
      );
      if (editedBy) item.lastEditedBy = editedBy;
    } catch (e: any) {
      alert('❌ Lỗi khi cập nhật: ' + (e?.message || e));
      await this.loadNvl();
    }
  }

  /** Sửa Khách hàng (Danh mục NVLKH) trực tiếp trên dòng NVL — để trống để xóa khỏi danh mục NVLKH. */
  async updateNvlKh(row: NvlCatalogRow): Promise<void> {
    try {
      await this.nvlkhCatalog.setCustomer(row.materialCode, row.customer);
    } catch (e: any) {
      alert('❌ Lỗi khi cập nhật Khách hàng: ' + (e?.message || e));
      await this.loadNvl();
    }
  }

  /** Nhãn DV Lưu trữ (VD "M (4/10)") — rỗng nếu mã chưa gán. */
  getStorageUnitLabel(size: StorageUnitSize | ''): string {
    if (!size) return '';
    const option = getStorageUnitOption(size);
    return option ? `${option.label} (${option.fractionLabel})` : size;
  }

  onStorageUnitCellClick(row: NvlCatalogRow): void {
    this.storageUnitPickerMaterialCode = row.materialCode;
    this.showStorageUnitPicker = true;
  }

  closeStorageUnitPicker(): void {
    if (this.isSavingStorageUnit) return;
    this.showStorageUnitPicker = false;
    this.storageUnitPickerMaterialCode = '';
  }

  /** Lưu DV Lưu trữ — đồng thời đồng bộ luôn sang Inbound/Inventory theo mã (mọi PO/IMD/nhà máy). */
  async onStorageUnitConfirmed(size: StorageUnitSize): Promise<void> {
    const materialCode = this.storageUnitPickerMaterialCode;
    if (!materialCode) return;
    this.isSavingStorageUnit = true;
    try {
      await this.dvLuuTruCatalog.assignStorageUnit(materialCode, size);
      const row = this.nvlItems.find(i => i.materialCode === materialCode);
      if (row) row.storageUnitSize = size;
      this.closeStorageUnitPicker();
    } catch (e: any) {
      console.error(e);
      alert('❌ Không lưu được DV Lưu trữ.');
    } finally {
      this.isSavingStorageUnit = false;
    }
  }

  async toggleNvlLock(item: NvlCatalogItem): Promise<void> {
    const next = !item.standardPackingLocked;
    try {
      const editedBy = await this.currentEmployeeId();
      await this.nvlService.setLocked(item.materialCode, next, editedBy);
      item.standardPackingLocked = next;
      if (editedBy) item.lastEditedBy = editedBy;
    } catch (e) {
      console.error(e);
      alert('❌ Không lưu được trạng thái Lock.');
    }
  }

  async toggleNvlAllowExportByCarton(item: NvlCatalogItem): Promise<void> {
    const next = !item.allowExportByCarton;
    try {
      const editedBy = await this.currentEmployeeId();
      await this.nvlService.setAllowExportByCarton(item.materialCode, next, editedBy);
      item.allowExportByCarton = next;
      if (editedBy) item.lastEditedBy = editedBy;
    } catch (e) {
      console.error(e);
      alert('❌ Không lưu được trạng thái Xuất thùng.');
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

  /** Mỗi mã NVL chỉ tồn tại 1 dòng — quét và gộp các mã bị trùng (dữ liệu cũ), giữ lại đúng 1 dòng/mã. */
  async dedupeNvlDuplicates(): Promise<void> {
    if (!confirm('Quét toàn bộ Danh mục NVL và gộp các mã bị trùng (mỗi mã chỉ giữ lại 1 dòng)?\nKhông thể hoàn tác.')) return;
    this.isNvlDeduping = true;
    try {
      const result = await this.nvlService.dedupeDuplicates();
      if (result.dedupedCodes === 0) {
        alert('✅ Không có mã nào bị trùng.');
      } else {
        alert(`✅ Đã gộp ${result.dedupedCodes} mã bị trùng (xóa ${result.deletedDocs} bản ghi thừa).`);
      }
      await this.loadNvl(true);
    } catch (e: any) {
      console.error(e);
      alert('❌ Lỗi khi xóa trùng lặp: ' + (e?.message || e));
    } finally {
      this.isNvlDeduping = false;
    }
  }

  /**
   * Rà soát Standard Packing: mã đang thiếu (0) hoặc nghi sai (số thập phân, VD 0.1) — so với
   * giá trị "quantity" xuất hiện nhiều nhất trong lịch sử Outbound (tem đầy quét đủ = đúng SP).
   * Đọc toàn bộ outbound-materials 2 nhà máy — chỉ chạy khi bấm nút, không tự động.
   */
  async auditStandardPackingFromOutbound(): Promise<void> {
    if (
      !confirm(
        'Quét toàn bộ lịch sử Outbound (ASM1 + ASM2) để đề xuất Standard Packing cho các mã đang thiếu hoặc nghi sai (số thập phân)?\nCó thể mất một lúc và tốn khá nhiều lượt đọc Firestore. Tiếp tục?'
      )
    ) {
      return;
    }
    this.isSpAuditRunning = true;
    this.showSpAuditPanel = true;
    this.spAuditSuggestions = [];
    try {
      const stats = await this.nvlService.auditStandardPackingFromOutbound();
      const suggestions: SpAuditSuggestion[] = [];
      for (const row of this.nvlItems) {
        const sp = Number(row.standardPacking) || 0;
        const isMissing = !sp;
        const isDecimal = sp > 0 && !Number.isInteger(sp);
        if (!isMissing && !isDecimal) continue;
        const s: OutboundQtyStats | undefined = stats.get(row.materialCode);
        suggestions.push({
          materialCode: row.materialCode,
          materialName: row.materialName,
          currentSp: sp,
          suggestedSp: s?.suggestedStandardPacking ?? null,
          sampleCount: s?.sampleCount ?? 0,
          totalScans: s?.totalScans ?? 0,
          reason: isMissing ? 'missing' : 'decimal',
          locked: row.standardPackingLocked
        });
      }
      suggestions.sort((a, b) => {
        const aHas = a.suggestedSp != null ? 1 : 0;
        const bHas = b.suggestedSp != null ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return b.totalScans - a.totalScans;
      });
      this.spAuditSuggestions = suggestions;
    } catch (e: any) {
      console.error(e);
      alert('❌ Lỗi khi rà soát: ' + (e?.message || e));
    } finally {
      this.isSpAuditRunning = false;
    }
  }

  closeSpAuditPanel(): void {
    if (this.isSpAuditRunning) return;
    this.showSpAuditPanel = false;
  }

  async applySpAuditSuggestion(s: SpAuditSuggestion): Promise<void> {
    if (s.locked || s.suggestedSp == null) return;
    try {
      await this.nvlService.update(s.materialCode, { standardPacking: s.suggestedSp });
      const row = this.nvlItems.find(i => i.materialCode === s.materialCode);
      if (row) row.standardPacking = s.suggestedSp;
      this.spAuditSuggestions = this.spAuditSuggestions.filter(x => x.materialCode !== s.materialCode);
      this.applyNvlFilters();
    } catch (e: any) {
      alert('❌ Lỗi khi áp dụng: ' + (e?.message || e));
    }
  }

  async applyAllSpAuditSuggestions(): Promise<void> {
    const applicable = this.spAuditSuggestions.filter(s => !s.locked && s.suggestedSp != null);
    if (!applicable.length) return;
    if (!confirm(`Áp dụng Standard Packing đề xuất cho ${applicable.length} mã?`)) return;
    let ok = 0;
    for (const s of applicable) {
      try {
        await this.nvlService.update(s.materialCode, { standardPacking: s.suggestedSp! });
        const row = this.nvlItems.find(i => i.materialCode === s.materialCode);
        if (row) row.standardPacking = s.suggestedSp!;
        ok++;
      } catch (e) {
        console.error('applyAllSpAuditSuggestions failed for', s.materialCode, e);
      }
    }
    this.spAuditSuggestions = this.spAuditSuggestions.filter(s => s.locked || s.suggestedSp == null);
    this.applyNvlFilters();
    alert(`✅ Đã áp dụng ${ok}/${applicable.length} mã.`);
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

  /** Cột A = Mã, Cột D = Tên, Cột E = DVT. Dữ liệu bắt đầu từ dòng 5 (bỏ qua 4 dòng đầu). */
  private async processNvlImportFile(file: File): Promise<void> {
    this.isNvlImporting = true;
    try {
      const rows = await this.readExcelRowsAsArray(file);
      const parsed = rows
        .slice(4)
        .map((row: any[]) => ({
          materialCode: String(row?.[0] ?? '').trim(),
          materialName: String(row?.[3] ?? '').trim(),
          unit: String(row?.[4] ?? '').trim()
        }))
        .filter(r => r.materialCode);

      if (!parsed.length) {
        alert('Không tìm thấy dòng hợp lệ (Cột A = Mã, Cột D = Tên, Cột E = DVT, dữ liệu từ dòng 5).');
        return;
      }
      const result = await this.nvlService.importCatalogFromRows(parsed);
      alert(
        `✅ Import xong!\n➕ Thêm mã mới: ${result.added}\n✏️ Cập nhật Tên/ĐVT: ${result.updated}\n⏭️ Bỏ qua (dòng thiếu Tên/ĐVT của mã đã có): ${result.skipped}\n📄 Tổng mã trong file: ${result.uniqueInFile}\n\nStandard Packing / Lock / Xuất thùng không bị ảnh hưởng.`
      );
      await this.loadNvl();
    } catch (e: any) {
      console.error(e);
      alert('Lỗi khi đọc file: ' + (e?.message || e));
    } finally {
      this.isNvlImporting = false;
    }
  }

  /** Cột A = Mã, Cột D = Tên, Cột E = DVT. Dữ liệu bắt đầu từ dòng 5 (khớp đúng format import). */
  downloadNvlTemplate(): void {
    const rows: any[][] = [
      [],
      [],
      [],
      ['Mã', '', '', 'Tên', 'DVT'],
      ['B123456', '', '', 'Tên nguyên vật liệu A', 'PCS'],
      ['B234567', '', '', 'Tên nguyên vật liệu B', 'KG']
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'NVL Template');
    XLSX.writeFile(wb, 'NVL_Template.xlsx');
  }

  exportNvlCurrent(): void {
    const rows = this.filteredNvlItems.map(i => ({
      'Mã hàng': i.materialCode,
      Tên: i.materialName,
      ĐVT: i.unit,
      'Khách hàng': i.customer,
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

  importNvlKhFromExcel(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files?.[0];
      if (file) void this.processNvlKhImportFile(file);
    };
    input.click();
  }

  private async processNvlKhImportFile(file: File): Promise<void> {
    try {
      const rows = await this.readExcelRows(file);
      const parsed: Array<{ materialCode: string; customer: string }> = [];
      const seen = new Set<string>();
      for (const row of rows as any[]) {
        const materialCode = String(row['Mã NVL'] || row['Mã hàng'] || row['materialCode'] || '').trim();
        const customer = String(row['Khách hàng'] || row['customer'] || '').trim();
        if (!materialCode || !customer) continue;
        const key = materialCode.toUpperCase();
        if (seen.has(key)) {
          const idx = parsed.findIndex(r => r.materialCode.toUpperCase() === key);
          if (idx >= 0) parsed.splice(idx, 1);
        }
        seen.add(key);
        parsed.push({ materialCode, customer });
      }

      if (!parsed.length) {
        alert('Không tìm thấy dòng hợp lệ (cần cột "Mã NVL" và "Khách hàng").');
        return;
      }
      if (
        !confirm(
          `Import sẽ THAY THẾ TOÀN BỘ Khách hàng theo mã (Danh mục NVLKH) bằng ${parsed.length} mã trong file này.\nMã nào không có trong file sẽ bị xóa Khách hàng.\n\nTiếp tục?`
        )
      ) {
        return;
      }

      this.isNvlKhImporting = true;
      const count = await this.nvlkhCatalog.importFromRows(parsed);
      alert(`✅ Đã import ${count} mã Khách hàng.`);
      await this.loadNvl();
    } catch (e: any) {
      console.error(e);
      alert('Lỗi khi đọc file: ' + (e?.message || e));
    } finally {
      this.isNvlKhImporting = false;
    }
  }

  downloadNvlKhTemplate(): void {
    const templateData = [
      { 'Mã NVL': 'B123456', 'Khách hàng': 'Customer A' },
      { 'Mã NVL': 'B234567', 'Khách hàng': 'Shared' }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'NVLKH Template');
    XLSX.writeFile(wb, 'NVLKH_Template.xlsx');
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
      const editedBy = await this.currentEmployeeId();
      await this.tpService.addItem(this.newTpItem, editedBy);
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
      const editedBy = await this.currentEmployeeId();
      await this.tpService.updateItem(item, editedBy);
      if (editedBy) item.lastEditedBy = editedBy;
    } catch (e: any) {
      alert('❌ Lỗi khi cập nhật: ' + (e?.message || e));
      await this.loadTp();
    }
  }

  /** Mã TP có SL SP/thùng VÀ Lượng Đóng Thùng đều đã có giá trị nhưng KHÁC nhau — không tính trường hợp Lượng Đóng Thùng đang trống (đó là "chưa điền", không phải "lệch"). */
  get tpMismatchItems(): MergedCatalogItem[] {
    return this.tpItems.filter(i => {
      const std = parseFloat(i.standard) || 0;
      const carton = i.cartonPackingQty || 0;
      return std > 0 && carton > 0 && std !== carton;
    });
  }

  get tpMismatchCount(): number {
    return this.tpMismatchItems.length;
  }

  showTpMismatchPanel = false;

  openTpMismatchPanel(): void {
    this.showTpMismatchPanel = true;
  }

  closeTpMismatchPanel(): void {
    this.showTpMismatchPanel = false;
  }

  /** Bấm 1 dòng trong danh sách mã lệch → lọc bảng chính về đúng mã đó để sửa. */
  jumpToTpMismatchRow(item: MergedCatalogItem): void {
    this.tpColumnFilters.materialCode = item.materialCode;
    this.applyTpFilters();
    this.closeTpMismatchPanel();
  }

  /** Sửa Lượng Đóng Thùng — danh mục riêng của Kho, không thuộc fg-catalog. Vẫn ghi lastEditedBy lên dòng fg-catalog để cột ID phản ánh đúng người sửa gần nhất. */
  async updateTpCartonPackingQty(item: MergedCatalogItem): Promise<void> {
    try {
      const editedBy = await this.currentEmployeeId();
      await this.cartonPackingQtyService.upsert(item.materialCode, item.cartonPackingQty || 0);
      if (editedBy) {
        await this.tpService.touchLastEditedBy(item.catalogId, editedBy);
        item.lastEditedBy = editedBy;
      }
    } catch (e: any) {
      alert('❌ Lỗi khi lưu Lượng Đóng Thùng: ' + (e?.message || e));
      await this.loadTp();
    }
  }

  /** Copy SL SP/thùng sang Lượng Đóng Thùng — CHỈ cho mã đang có Lượng Đóng Thùng = 0/trống. Không đụng mã đã có giá trị (kể cả khi khác SL SP/thùng). */
  async copyCartonPackingQtyFromStandard(): Promise<void> {
    const fillable = this.tpItems.filter(i => !i.cartonPackingQty && parseFloat(i.standard) > 0);
    if (fillable.length === 0) {
      alert('Không có mã nào cần copy (Lượng Đóng Thùng đang trống + có SL SP/thùng > 0).');
      return;
    }
    if (
      !confirm(
        `Copy SL SP/thùng sang Lượng Đóng Thùng cho ${fillable.length} mã đang trống.\n\nKhông đụng tới mã đã có Lượng Đóng Thùng (kể cả khi khác SL SP/thùng). Tiếp tục?`
      )
    ) {
      return;
    }
    this.isTpCopyingCartonQty = true;
    try {
      const count = await this.cartonPackingQtyService.copyAllFromStandard(
        fillable.map(i => ({ materialCode: i.materialCode, standard: i.standard }))
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
   * Import = THAY THẾ TOÀN BỘ Danh mục TP hiện tại bằng dữ liệu trong file. Đọc và lưu TOÀN BỘ cột
   * có trong file (không chỉ lọc theo danh sách cột cố định như trước) — mỗi cột gốc trong Excel trở
   * thành 1 field trong Firestore, các field đã có UI riêng (materialCode, customerCode, standard...)
   * vẫn được chuẩn hoá đè lên trên. Trùng Mã S.Phẩm KH (Mã KH) → ưu tiên giữ dòng có "Ngày tạo bản
   * vẽ" mới nhất; nếu không có ngày (hoặc bằng nhau) thì giữ dòng nằm cuối file (hành vi cũ).
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
          drawingDate: this.parseExcelDate(row['Ngày tạo bản vẽ']),
          raw: row
        }))
        .filter(r => r.materialCode || r.customerCode);

      if (!parsed.length) {
        alert('❌ Không có dòng hợp lệ (cần ít nhất Mã vật tư hoặc Mã S.Phẩm KH)');
        return;
      }
      if (
        !confirm(
          `Import sẽ XÓA TOÀN BỘ Danh mục TP hiện tại (${this.tpItems.length} dòng) và thay bằng ${parsed.length} dòng trong file này.\n` +
            `Ghi tất cả dòng (1 Mã KH có nhiều Mã vật tư vẫn giữ hết); chỉ dòng trùng cả Mã vật tư + Mã KH mới gộp, ưu tiên Ngày tạo bản vẽ mới nhất.\n\nHành động không thể hoàn tác. Tiếp tục?`
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

  /** Đọc theo vị trí cột (không theo tên header) — mỗi dòng là mảng giá trị theo cột A, B, C... */
  private readExcelRowsAsArray(file: File): Promise<any[][]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          resolve(XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]);
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
