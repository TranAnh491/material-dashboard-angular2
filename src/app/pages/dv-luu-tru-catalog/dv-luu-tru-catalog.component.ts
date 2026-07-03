import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DvLuuTruCatalogService } from '../../services/dv-luu-tru-catalog.service';
import {
  DvLuuTruCatalogEntry,
  getStorageUnitOption,
  StorageUnitSize
} from '../../models/storage-unit.model';

@Component({
  selector: 'app-dv-luu-tru-catalog',
  templateUrl: './dv-luu-tru-catalog.component.html',
  styleUrls: ['./dv-luu-tru-catalog.component.scss']
})
export class DvLuuTruCatalogComponent implements OnInit {
  entries: DvLuuTruCatalogEntry[] = [];
  filteredEntries: DvLuuTruCatalogEntry[] = [];
  isLoading = false;
  factoryFilter = 'ALL';
  searchText = '';

  showPicker = false;
  editingEntry: DvLuuTruCatalogEntry | null = null;
  isSaving = false;

  constructor(
    private catalogService: DvLuuTruCatalogService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    const factory = String(this.route.snapshot.queryParamMap.get('factory') || '').toUpperCase();
    if (factory === 'ASM1' || factory === 'ASM2') {
      this.factoryFilter = factory;
    }
    void this.loadEntries();
  }

  async loadEntries(): Promise<void> {
    this.isLoading = true;
    try {
      this.entries = await this.catalogService.listEntries();
      this.applyFilters();
    } catch (e) {
      console.error(e);
      alert('Không tải được danh mục DV Lưu trữ.');
    } finally {
      this.isLoading = false;
    }
  }

  applyFilters(): void {
    const q = this.searchText.trim().toLowerCase();
    this.filteredEntries = this.entries.filter(entry => {
      if (this.factoryFilter !== 'ALL' && entry.factory !== this.factoryFilter) return false;
      if (!q) return true;
      return (
        entry.materialCode.toLowerCase().includes(q) ||
        (entry.batchNumber || '').toLowerCase().includes(q) ||
        entry.size.toLowerCase().includes(q)
      );
    });
  }

  onFactoryFilterChange(): void {
    this.applyFilters();
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  getSizeLabel(size: StorageUnitSize): string {
    const option = getStorageUnitOption(size);
    return option ? `${option.label} (${option.fractionLabel})` : size;
  }

  formatUpdatedAt(entry: DvLuuTruCatalogEntry): string {
    return entry.updatedAt ? entry.updatedAt.toLocaleString('vi-VN', { hour12: false }) : '—';
  }

  openEdit(entry: DvLuuTruCatalogEntry): void {
    this.editingEntry = entry;
    this.showPicker = true;
  }

  closePicker(): void {
    if (this.isSaving) return;
    this.showPicker = false;
    this.editingEntry = null;
  }

  async onPickerConfirmed(size: StorageUnitSize): Promise<void> {
    if (!this.editingEntry) return;
    this.isSaving = true;
    try {
      const materialCode = this.editingEntry.materialCode;
      await this.catalogService.assignStorageUnit(materialCode, size, this.editingEntry.factory);
      await this.loadEntries();
      this.closePicker();
    } catch (e) {
      console.error(e);
      alert('Không lưu được DV Lưu trữ.');
    } finally {
      this.isSaving = false;
    }
  }

  async deleteEntry(entry: DvLuuTruCatalogEntry): Promise<void> {
    if (!confirm(`Xóa DV Lưu trữ của mã NVL ${entry.materialCode}?`)) return;
    try {
      await this.catalogService.deleteEntry(entry.id);
      this.entries = this.entries.filter(e => e.id !== entry.id);
      this.applyFilters();
    } catch (e) {
      console.error(e);
      alert('Không xóa được bản ghi.');
    }
  }

  goBackInbound(): void {
    const path = this.factoryFilter === 'ASM2' ? '/inbound-asm2' : '/inbound-asm1';
    void this.router.navigate([path]);
  }
}
