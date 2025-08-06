import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';

export interface InboundMaterial {
  id?: string;
  importDate: Date;
  batchNumber: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  location: string;
  type: string;
  expiryDate: Date;
  qualityCheck: string;
  isReceived: boolean;
  notes: string;
  rollsOrBags: string;
  supplier: string;
  remarks: string;
  isCompleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-inbound-materials',
  templateUrl: './inbound-materials.component.html',
  styleUrls: ['./inbound-materials.component.scss']
})
export class InboundMaterialsComponent implements OnInit, OnDestroy {
  materials: InboundMaterial[] = [];
  
  private destroy$ = new Subject<void>();

  constructor() {}

  ngOnInit(): void {
    this.loadMockData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMockData(): void {
    // Mock data for demonstration
    this.materials = [
      {
        importDate: new Date('2024-01-15'),
        batchNumber: 'BATCH001',
        materialCode: 'MAT001',
        poNumber: 'PO2024001',
        quantity: 100,
        unit: 'kg',
        location: 'A1',
        type: 'Raw Material',
        expiryDate: new Date('2025-01-15'),
        qualityCheck: 'Passed',
        isReceived: true,
        notes: 'All items received in good condition',
        rollsOrBags: '10 rolls',
        supplier: 'Supplier A',
        remarks: 'Standard delivery',
        isCompleted: true
      },
      {
        importDate: new Date('2024-01-16'),
        batchNumber: 'BATCH002',
        materialCode: 'MAT002',
        poNumber: 'PO2024002',
        quantity: 50,
        unit: 'pcs',
        location: 'B2',
        type: 'Component',
        expiryDate: new Date('2024-12-31'),
        qualityCheck: 'Pending',
        isReceived: false,
        notes: 'Missing 2 items',
        rollsOrBags: '25 bags',
        supplier: 'Supplier B',
        remarks: 'Check quality before acceptance',
        isCompleted: false
      },
      {
        importDate: new Date('2024-01-17'),
        batchNumber: 'BATCH003',
        materialCode: 'MAT003',
        poNumber: 'PO2024003',
        quantity: 200,
        unit: 'm',
        location: 'C3',
        type: 'Fabric',
        expiryDate: new Date('2026-01-17'),
        qualityCheck: 'Passed',
        isReceived: true,
        notes: 'Quality check completed',
        rollsOrBags: '5 rolls',
        supplier: 'Supplier C',
        remarks: 'Premium quality material',
        isCompleted: true
      }
    ];
  }

  importFile(): void {
    console.log('Import file functionality');
    alert('Import file functionality will be implemented');
  }

  downloadTemplate(): void {
    console.log('Download template');
    
    // Create template data
    const templateData = [
      {
        'Ngày nhập': '15/01/2024',
        'Lô Hàng/ DNNK': 'BATCH001',
        'Mã hàng': 'MAT001',
        'Số P.O': 'PO2024001',
        'Lượng Nhập': 100,
        'Đơn vị': 'kg',
        'Vị trí': 'A1',
        'Loại hình': 'Raw Material',
        'HSD': '15/01/2025',
        'KK': 'Passed',
        'Đã nhận': 'Yes',
        'Ghi chú': 'All items received',
        'Số cuộn/ bịch': '10 rolls',
        'Nhà cung cấp': 'Supplier A',
        'Lưu ý': 'Standard delivery',
        'Rồi/Chưa': 'Rồi'
      }
    ];

    // Create workbook and worksheet
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    // Generate file and download
    XLSX.writeFile(wb, 'Inbound_Materials_Template.xlsx');
  }

  downloadReport(): void {
    console.log('Download report');
    
    // Create report data from current materials
    const reportData = this.materials.map(material => ({
      'Ngày nhập': this.formatDate(material.importDate),
      'Lô Hàng/ DNNK': material.batchNumber,
      'Mã hàng': material.materialCode,
      'Số P.O': material.poNumber,
      'Lượng Nhập': material.quantity,
      'Đơn vị': material.unit,
      'Vị trí': material.location,
      'Loại hình': material.type,
      'HSD': this.formatDate(material.expiryDate),
      'KK': material.qualityCheck,
      'Đã nhận': material.isReceived ? 'Yes' : 'No',
      'Ghi chú': material.notes,
      'Số cuộn/ bịch': material.rollsOrBags,
      'Nhà cung cấp': material.supplier,
      'Lưu ý': material.remarks,
      'Rồi/Chưa': material.isCompleted ? 'Rồi' : 'Chưa'
    }));

    // Create workbook and worksheet
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(reportData);

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Inbound Materials Report');

    // Generate file and download
    XLSX.writeFile(wb, `Inbound_Materials_Report_${this.formatDate(new Date())}.xlsx`);
  }

  updateReceivedStatus(material: InboundMaterial, isReceived: boolean): void {
    material.isReceived = isReceived;
    console.log(`Updated received status for ${material.materialCode}: ${isReceived}`);
    
    // Here you would typically save to Firebase
    // this.materialService.updateMaterial(material);
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }
}
