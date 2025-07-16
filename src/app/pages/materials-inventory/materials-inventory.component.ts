import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as XLSX from 'xlsx';

export interface MaterialLifecycleData {
  no: number;                    // 1. No
  materialCode: string;          // 2. Mã vật tư
  materialName: string;          // 3. Tên vật tư
  unit: string;                  // 4. Đvt
  poNumber: string;              // 5. Số Po
  expiryDate: string;            // 6. Hạn sử dụng
  shelfLife: number;             // 7. Shelf life
  warehouseCode: string;         // 8. Mã Kho
  importDate: string;            // 9. Ngày nhập kho
  aging: number;                 // 10. Aging
  remainingStock: number;        // 11. Tồn cuối kỳ
  dateRemain: string;            // 12. Date remain
}

@Component({
  selector: 'app-materials-inventory',
  templateUrl: './materials-inventory.component.html',
  styleUrls: ['./materials-inventory.component.scss']
})
export class MaterialsInventoryComponent implements OnInit {
  @ViewChild('fileInput') fileInput!: ElementRef;
  
  // Data properties
  materialsData: MaterialLifecycleData[] = [];
  filteredMaterials: MaterialLifecycleData[] = [];
  
  // Loading state
  isLoading = false;
  
  // Search and filter
  searchTerm = '';
  sortBy = 'no';
  sortDirection: 'asc' | 'desc' = 'asc';
  
  // Table columns configuration
  displayedColumns = [
    'no', 'materialCode', 'materialName', 'unit', 'poNumber', 
    'expiryDate', 'shelfLife', 'warehouseCode', 'importDate', 
    'aging', 'remainingStock', 'dateRemain'
  ];
  
  columnLabels = {
    no: 'No',
    materialCode: 'Mã vật tư',
    materialName: 'Tên vật tư',
    unit: 'Đvt',
    poNumber: 'Số Po',
    expiryDate: 'Hạn sử dụng',
    shelfLife: 'Shelf life',
    warehouseCode: 'Mã Kho',
    importDate: 'Ngày nhập kho',
    aging: 'Aging',
    remainingStock: 'Tồn cuối kỳ',
    dateRemain: 'Date remain'
  };

  constructor(private snackBar: MatSnackBar) {}

  ngOnInit(): void {
    // Initialize component
  }

  // File import methods
  onFileSelect(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.importExcelFile(file);
    }
  }

  triggerFileInput(): void {
    this.fileInput.nativeElement.click();
  }

  importExcelFile(file: File): void {
    this.isLoading = true;
    
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first worksheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        this.processExcelData(jsonData);
        
        this.snackBar.open(
          `Imported ${this.materialsData.length} materials successfully`,
          'Close',
          {
            duration: 3000,
            panelClass: ['success-snackbar']
          }
        );
        
      } catch (error) {
        console.error('Error importing Excel file:', error);
        this.snackBar.open(
          'Error importing Excel file. Please check file format.',
          'Close',
          {
            duration: 5000,
            panelClass: ['error-snackbar']
          }
        );
      } finally {
        this.isLoading = false;
      }
    };
    
    reader.readAsArrayBuffer(file);
  }

  processExcelData(jsonData: any[]): void {
    // Skip header row (assuming first row contains headers)
    const dataRows = jsonData.slice(1);
    
    this.materialsData = dataRows.map((row: any[], index: number) => {
      return {
        no: index + 1,
        materialCode: row[0] || '',
        materialName: row[1] || '',
        unit: row[2] || '',
        poNumber: row[3] || '',
        expiryDate: this.formatDate(row[4]) || '',
        shelfLife: Number(row[5]) || 0,
        warehouseCode: row[6] || '',
        importDate: this.formatDate(row[7]) || '',
        aging: Number(row[8]) || 0,
        remainingStock: Number(row[9]) || 0,
        dateRemain: this.formatDate(row[10]) || ''
      };
    }).filter(item => item.materialCode); // Filter out empty rows
    
    this.filteredMaterials = [...this.materialsData];
  }

  formatDate(value: any): string {
    if (!value) return '';
    
    // Handle Excel date serial number
    if (typeof value === 'number') {
      const date = new Date((value - 25569) * 86400 * 1000);
      return date.toLocaleDateString('vi-VN');
    }
    
    // Handle string date
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('vi-VN');
      }
    }
    
    return value.toString();
  }

  // Search and filter methods
  applyFilter(): void {
    this.filteredMaterials = this.materialsData.filter(material =>
      material.materialCode.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      material.materialName.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      material.poNumber.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      material.warehouseCode.toLowerCase().includes(this.searchTerm.toLowerCase())
    );
  }

  sortData(column: string): void {
    if (this.sortBy === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = column;
      this.sortDirection = 'asc';
    }

    this.filteredMaterials.sort((a, b) => {
      const aValue = (a as any)[column];
      const bValue = (b as any)[column];
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return this.sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      const aStr = aValue?.toString().toLowerCase() || '';
      const bStr = bValue?.toString().toLowerCase() || '';
      
      if (this.sortDirection === 'asc') {
        return aStr.localeCompare(bStr);
      } else {
        return bStr.localeCompare(aStr);
      }
    });
  }

  // Export methods
  exportToExcel(): void {
    if (this.materialsData.length === 0) {
      this.snackBar.open('No data to export', 'Close', { duration: 3000 });
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(this.filteredMaterials);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Materials Lifecycle');
    
    XLSX.writeFile(workbook, `Materials_Lifecycle_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    this.snackBar.open('Data exported successfully', 'Close', { duration: 3000 });
  }

  clearData(): void {
    this.materialsData = [];
    this.filteredMaterials = [];
    this.searchTerm = '';
    
    this.snackBar.open('Data cleared successfully', 'Close', { duration: 3000 });
  }

  // Getters for statistics
  get totalMaterials(): number {
    return this.materialsData.length;
  }

  get totalStock(): number {
    return this.materialsData.reduce((sum, item) => sum + item.remainingStock, 0);
  }

  get avgShelfLife(): number {
    if (this.materialsData.length === 0) return 0;
    const total = this.materialsData.reduce((sum, item) => sum + item.shelfLife, 0);
    return total / this.materialsData.length;
  }

  get avgAging(): number {
    if (this.materialsData.length === 0) return 0;
    const total = this.materialsData.reduce((sum, item) => sum + item.aging, 0);
    return total / this.materialsData.length;
  }

  // Track by function for performance
  trackByMaterialCode(index: number, item: MaterialLifecycleData): string {
    return item.materialCode;
  }
}
