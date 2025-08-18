import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import * as ExcelJS from 'exceljs';

@Component({
  selector: 'app-manage-inventory',
  templateUrl: './manage-inventory.component.html',
  styleUrls: ['./manage-inventory.component.scss']
})
export class ManageInventoryComponent implements OnInit {
  currentView: 'main' | 'rm1' | 'rm2' | 'fg1' | 'fg2' = 'main';
  showMoreDropdown = false;
  erpData: any[] = [];
  inventoryData: any[] = [];
  comparisonResult: any = {};

  constructor(private router: Router) { }

  ngOnInit(): void {
  }

  // Navigate to RM1 Inventory
  goToRM1(): void {
    this.currentView = 'rm1';
  }

  // Navigate to RM2 Inventory
  goToRM2(): void {
    this.router.navigate(['/materials-asm2']);
  }

  // Navigate to FG1 (Finished Goods 1)
  goToFG1(): void {
    this.router.navigate(['/fg']);
  }

  // Navigate to FG2 (Finished Goods 2)
  goToFG2(): void {
    this.router.navigate(['/fg']);
  }

  // Back to main view
  backToMain(): void {
    this.currentView = 'main';
    this.showMoreDropdown = false;
  }

  // Toggle more dropdown
  toggleMoreDropdown(): void {
    this.showMoreDropdown = !this.showMoreDropdown;
  }

  // Trigger ERP import
  triggerERPImport(): void {
    this.showMoreDropdown = false;
    // Trigger file input click
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  // Import ERP Inventory
  importERPInventory(event: any): void {
    const file = event.target.files[0];
    if (file) {
      // Simulate reading Excel file
      this.readERPFile(file);
    }
  }

  // Read ERP file
  private readERPFile(file: File): void {
    // Simulate file reading - in real app, use ExcelJS or similar library
    console.log('Reading ERP file:', file.name);
    
    // Mock ERP data với format mới: Nhà máy, Mã hàng, ERP tồn kho
    this.erpData = [
      { factory: 'ASM1', materialCode: 'RM001', quantity: 100 },
      { factory: 'ASM1', materialCode: 'RM002', quantity: 150 },
      { factory: 'ASM1', materialCode: 'RM003', quantity: 75 },
      { factory: 'ASM1', materialCode: 'RM004', quantity: 200 },
      { factory: 'RM005', quantity: 120 }
    ];
    
    // Tự động so sánh và tải về báo cáo
    this.autoGenerateAndDownloadReport();
  }

  // Tự động tạo và tải về báo cáo
  private autoGenerateAndDownloadReport(): void {
    // Mock inventory data (current system data)
    this.inventoryData = [
      { materialCode: 'RM001', quantity: 95, factory: 'ASM1' },
      { materialCode: 'RM002', quantity: 160, factory: 'ASM1' },
      { materialCode: 'RM003', quantity: 80, factory: 'ASM1' },
      { materialCode: 'RM006', quantity: 50, factory: 'ASM1' }
    ];

    // So sánh ERP vs Inventory
    this.comparisonResult = this.compareData();
    
    // Tự động tải về báo cáo Excel
    this.createExcelReport();
  }

  // Download ERP Template
  downloadERPTemplate(): void {
    this.showMoreDropdown = false;
    // Create and download Excel template
    this.createExcelTemplate();
  }

  // Create Excel template
  private async createExcelTemplate(): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('ERP Template');

    // Add headers
    worksheet.columns = [
      { header: 'Nhà máy', key: 'factory', width: 15 },
      { header: 'Mã hàng', key: 'materialCode', width: 20 },
      { header: 'ERP tồn kho', key: 'quantity', width: 15 }
    ];

    // Add sample data
    worksheet.addRow({ factory: 'ASM1', materialCode: 'RM001', quantity: 100 });
    worksheet.addRow({ factory: 'ASM1', materialCode: 'RM002', quantity: 150 });
    worksheet.addRow({ factory: 'ASM1', materialCode: 'RM003', quantity: 75 });

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add borders
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // Generate and download the file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ERP_Inventory_Template.xlsx';
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // Create Excel report
  private async createExcelReport(): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('ERP vs Inventory Report');

    // Add title
    worksheet.mergeCells('A1:D1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'BÁO CÁO SO SÁNH ERP vs INVENTORY - RM1';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center' };

    // Add date
    worksheet.mergeCells('A2:D2');
    const dateCell = worksheet.getCell('A2');
    dateCell.value = `Ngày tạo: ${new Date().toLocaleDateString('vi-VN')}`;
    dateCell.font = { italic: true };

    // Add summary section
    worksheet.addRow([]);
    worksheet.addRow(['TỔNG KẾT:']);
    worksheet.addRow(['Mã hàng có số tồn khác:', this.comparisonResult.quantityDifferences?.length || 0]);
    worksheet.addRow(['Mã hàng ERP có nhưng web không có:', this.comparisonResult.erpOnly?.length || 0]);

    // Add items with different quantities
    if (this.comparisonResult.quantityDifferences?.length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['🔴 MÃ HÀNG CÓ SỐ TỒN KHÁC VỚI ERP:']);
      worksheet.addRow(['Mã hàng', 'Nhà máy', 'Số lượng ERP', 'Số lượng Web', 'Chênh lệch']);
      
      this.comparisonResult.quantityDifferences.forEach((item: any) => {
        worksheet.addRow([
          item.materialCode,
          item.factory,
          item.erpQuantity,
          item.inventoryQuantity,
          item.difference
        ]);
      });
    }

    // Add ERP only items (có trong ERP nhưng không có trong web)
    if (this.comparisonResult.erpOnly?.length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['🟡 MÃ HÀNG ERP CÓ NHƯNG WEB KHÔNG CÓ:']);
      worksheet.addRow(['Mã hàng', 'Nhà máy', 'Số lượng ERP']);
      
      this.comparisonResult.erpOnly.forEach((item: any) => {
        worksheet.addRow([
          item.materialCode,
          item.factory || 'N/A',
          item.quantity
        ]);
      });
    }

    // Style the worksheet
    this.styleExcelWorksheet(worksheet);

    // Generate and download the file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ERP_Inventory_Comparison_Report.xlsx';
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // Style Excel worksheet
  private styleExcelWorksheet(worksheet: ExcelJS.Worksheet): void {
    // Style headers
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 2) {
        // Title and date rows
        row.eachCell((cell) => {
          cell.font = { bold: true };
        });
      } else if (row.values && Array.isArray(row.values) && row.values.length > 0) {
        // Check if this is a header row (contains emojis or specific text)
        const firstCellValue = row.getCell(1).value;
        if (typeof firstCellValue === 'string' && 
            (firstCellValue.includes('✅') || firstCellValue.includes('🔴') || firstCellValue.includes('🟡') || 
             firstCellValue === 'TỔNG KẾT:' || firstCellValue === 'Mã hàng')) {
          row.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE0E0E0' }
            };
          });
        }
      }
    });

    // Add borders to all cells
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      if (column.width && typeof column.width === 'number') {
        column.width = Math.max(column.width, 15);
      }
    });
  }

  // Compare ERP data with inventory data
  private compareData(): any {
    const result = {
      quantityDifferences: [], // Mã hàng có số tồn khác
      erpOnly: [] // Mã hàng ERP có nhưng web không có
    };

    // Tìm mã hàng có số tồn khác và mã hàng ERP có nhưng web không có
    this.erpData.forEach(erpItem => {
      const inventoryItem = this.inventoryData.find(inv => inv.materialCode === erpItem.materialCode);
      if (inventoryItem) {
        // Mã hàng có trong cả ERP và web, kiểm tra số lượng
        if (erpItem.quantity !== inventoryItem.quantity) {
          result.quantityDifferences.push({
            materialCode: erpItem.materialCode,
            erpQuantity: erpItem.quantity,
            inventoryQuantity: inventoryItem.quantity,
            difference: erpItem.quantity - inventoryItem.quantity,
            factory: erpItem.factory
          });
        }
      } else {
        // Mã hàng có trong ERP nhưng không có trong web
        result.erpOnly.push(erpItem);
      }
    });

    return result;
  }
}
