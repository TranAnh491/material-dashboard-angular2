import { Component, OnInit, OnDestroy } from '@angular/core';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';
import { WorkOrder, WorkOrderStatus, FactoryType } from '../../models/material-lifecycle.model';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit, OnDestroy {
  Object = Object;
  workOrders: WorkOrder[] = [];
  filteredWorkOrders: WorkOrder[] = [];
  
  // Factory selection
  selectedFactory: FactoryType = FactoryType.ASM1;
  factories = Object.values(FactoryType);
  
  // Filters
  searchTerm: string = '';
  statusFilter: WorkOrderStatus | 'all' = 'all';
  yearFilter: number = new Date().getFullYear();
  monthFilter: number = new Date().getMonth() + 1;
  
  // Summary data
  totalOrders: number = 0;
  pendingOrders: number = 0;
  inProgressOrders: number = 0;
  completedOrders: number = 0;
  
  // Form data for new work order
  newWorkOrder: Partial<WorkOrder> = {
    factory: FactoryType.ASM1,
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    orderNumber: '',
    productCode: '',
    productionOrder: '',
    quantity: 0,
    customer: '',
    deliveryDate: new Date(),
    productionLine: '',
    status: WorkOrderStatus.PENDING,
    createdBy: '',
    planReceivedDate: new Date(),
    notes: ''
  };
  
  // Import functionality
  isImporting: boolean = false;
  importProgress: number = 0;
  importResults: any = null;
  showImportDialog: boolean = false;
  
  isAddingWorkOrder: boolean = false;
  availableLines: string[] = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'];
  years: number[] = [];
  months = [
    { value: 1, name: 'January' },
    { value: 2, name: 'February' },
    { value: 3, name: 'March' },
    { value: 4, name: 'April' },
    { value: 5, name: 'May' },
    { value: 6, name: 'June' },
    { value: 7, name: 'July' },
    { value: 8, name: 'August' },
    { value: 9, name: 'September' },
    { value: 10, name: 'October' },
    { value: 11, name: 'November' },
    { value: 12, name: 'December' }
  ];
  
  private destroy$ = new Subject<void>();

  constructor(private materialService: MaterialLifecycleService) {
    // Generate years from current year - 2 to current year + 2
    const currentYear = new Date().getFullYear();
    for (let i = currentYear - 2; i <= currentYear + 2; i++) {
      this.years.push(i);
    }
  }

  ngOnInit(): void {
    this.loadWorkOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadWorkOrders(): void {
    this.materialService.getWorkOrdersByFactory(this.selectedFactory)
      .pipe(takeUntil(this.destroy$))
      .subscribe(workOrders => {
        this.workOrders = workOrders;
        this.applyFilters();
        this.calculateSummary();
      });
  }

  onFactoryChange(): void {
    this.newWorkOrder.factory = this.selectedFactory;
    this.loadWorkOrders();
  }

  applyFilters(): void {
    this.filteredWorkOrders = this.workOrders.filter(wo => {
      const matchesSearch = !this.searchTerm || 
        wo.orderNumber.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        wo.productCode.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        wo.productionOrder.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        wo.customer.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      const matchesStatus = this.statusFilter === 'all' || wo.status === this.statusFilter;
      const matchesYear = wo.year === this.yearFilter;
      const matchesMonth = wo.month === this.monthFilter;
      
      return matchesSearch && matchesStatus && matchesYear && matchesMonth;
    });
  }

  calculateSummary(): void {
    const filtered = this.filteredWorkOrders;
    this.totalOrders = filtered.length;
    this.pendingOrders = filtered.filter(wo => wo.status === WorkOrderStatus.PENDING).length;
    this.inProgressOrders = filtered.filter(wo => wo.status === WorkOrderStatus.IN_PROGRESS).length;
    this.completedOrders = filtered.filter(wo => wo.status === WorkOrderStatus.COMPLETED).length;
  }

  onSearchChange(): void {
    this.applyFilters();
    this.calculateSummary();
  }

  onStatusFilterChange(): void {
    this.applyFilters();
    this.calculateSummary();
  }

  onYearFilterChange(): void {
    this.applyFilters();
    this.calculateSummary();
  }

  onMonthFilterChange(): void {
    this.applyFilters();
    this.calculateSummary();
  }

  addNewWorkOrder(): void {
    if (this.isValidWorkOrder()) {
      // Generate order number if not provided
      if (!this.newWorkOrder.orderNumber) {
        this.newWorkOrder.orderNumber = this.generateOrderNumber();
      }

      const workOrder: WorkOrder = {
        ...this.newWorkOrder,
        factory: this.selectedFactory,
        createdDate: new Date(),
        lastUpdated: new Date()
      } as WorkOrder;

      this.materialService.addWorkOrder(workOrder)
        .then(() => {
          this.resetForm();
          this.isAddingWorkOrder = false;
        })
        .catch(error => {
          console.error('Error adding work order:', error);
        });
    }
  }

  private generateOrderNumber(): string {
    const year = this.newWorkOrder.year?.toString().slice(-2) || '24';
    const month = this.newWorkOrder.month?.toString().padStart(2, '0') || '01';
    const factory = this.selectedFactory;
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${factory}-${year}${month}-${random}`;
  }

  private isValidWorkOrder(): boolean {
    return !!(
      this.newWorkOrder.productCode &&
      this.newWorkOrder.productionOrder &&
      this.newWorkOrder.quantity && this.newWorkOrder.quantity > 0 &&
      this.newWorkOrder.customer &&
      this.newWorkOrder.deliveryDate &&
      this.newWorkOrder.productionLine &&
      this.newWorkOrder.createdBy &&
      this.newWorkOrder.planReceivedDate
    );
  }

  resetForm(): void {
    this.newWorkOrder = {
      factory: this.selectedFactory,
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      orderNumber: '',
      productCode: '',
      productionOrder: '',
      quantity: 0,
      customer: '',
      deliveryDate: new Date(),
      productionLine: '',
      status: WorkOrderStatus.PENDING,
      createdBy: '',
      planReceivedDate: new Date(),
      notes: ''
    };
  }

  updateWorkOrderStatus(workOrder: WorkOrder, newStatus: WorkOrderStatus): void {
    const updatedWorkOrder = { ...workOrder, status: newStatus, lastUpdated: new Date() };
    
    this.materialService.updateWorkOrder(workOrder.id!, updatedWorkOrder)
      .then(() => {
        // Update local array
        const index = this.workOrders.findIndex(wo => wo.id === workOrder.id);
        if (index !== -1) {
          this.workOrders[index] = { ...this.workOrders[index], ...updatedWorkOrder };
          this.applyFilters();
          this.calculateSummary();
        }
      })
      .catch(error => {
        console.error('Error updating work order status:', error);
      });
  }

  deleteWorkOrder(workOrder: WorkOrder): void {
    if (confirm(`Are you sure you want to delete Work Order ${workOrder.orderNumber}?`)) {
      this.materialService.deleteWorkOrder(workOrder.id!)
        .then(() => {
          // Remove from local array
          this.workOrders = this.workOrders.filter(wo => wo.id !== workOrder.id);
          this.applyFilters();
          this.calculateSummary();
        })
        .catch(error => {
          console.error('Error deleting work order:', error);
        });
    }
  }

  getStatusClass(status: WorkOrderStatus): string {
    switch (status) {
      case WorkOrderStatus.PENDING: return 'status-pending';
      case WorkOrderStatus.IN_PROGRESS: return 'status-in-progress';
      case WorkOrderStatus.ON_HOLD: return 'status-on-hold';
      case WorkOrderStatus.COMPLETED: return 'status-completed';
      case WorkOrderStatus.CANCELLED: return 'status-cancelled';
      case WorkOrderStatus.QUALITY_CHECK: return 'status-quality-check';
      default: return '';
    }
  }

  getPriorityClass(deliveryDate: Date): string {
    const today = new Date();
    const delivery = new Date(deliveryDate);
    const daysUntilDelivery = Math.ceil((delivery.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDelivery < 0) return 'priority-overdue';
    if (daysUntilDelivery <= 3) return 'priority-urgent';
    if (daysUntilDelivery <= 7) return 'priority-high';
    return 'priority-normal';
  }

  exportToCSV(): void {
    const headers = [
      'Factory', 'Year', 'Month', 'Order Number', 'Product Code', 'Production Order', 
      'Quantity', 'Customer', 'Delivery Date', 'Production Line', 'Status', 
      'Created By', 'Checked By', 'Plan Received Date', 'Notes'
    ];
    
    const csvContent = [
      headers.join(','),
      ...this.filteredWorkOrders.map(wo => [
        wo.factory,
        wo.year,
        wo.month,
        wo.orderNumber,
        wo.productCode,
        wo.productionOrder,
        wo.quantity,
        wo.customer,
        new Date(wo.deliveryDate).toLocaleDateString(),
        wo.productionLine,
        wo.status,
        wo.createdBy,
        wo.checkedBy || '',
        new Date(wo.planReceivedDate).toLocaleDateString(),
        wo.notes || ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-orders-${this.selectedFactory}-${this.yearFilter}-${this.monthFilter}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // Excel Import Functionality
  openImportDialog(): void {
    this.showImportDialog = true;
    this.importResults = null;
  }

  closeImportDialog(): void {
    this.showImportDialog = false;
    this.importResults = null;
    this.importProgress = 0;
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.importExcelFile(file);
    }
  }

  async importExcelFile(file: File): Promise<void> {
    this.isImporting = true;
    this.importProgress = 0;
    
    try {
      const data = await this.readExcelFile(file);
      const workOrders = this.parseExcelData(data);
      const results = await this.bulkInsertWorkOrders(workOrders);
      
      this.importResults = results;
      this.loadWorkOrders(); // Reload data after import
      
    } catch (error) {
      console.error('Import error:', error);
      this.importResults = {
        success: 0,
        failed: 1,
        errors: [{ row: 0, error: 'Failed to read file: ' + error }]
      };
    } finally {
      this.isImporting = false;
      this.importProgress = 100;
    }
  }

  private readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const workbook = XLSX.read(e.target.result, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject('Error reading file');
      reader.readAsBinaryString(file);
    });
  }

  private parseExcelData(data: any[]): Partial<WorkOrder>[] {
    if (data.length < 2) {
      throw new Error('Excel file must have headers and at least one data row');
    }

    const headers = data[0];
    const workOrders: Partial<WorkOrder>[] = [];

    // Expected headers (customize based on your Excel template)
    const expectedHeaders = [
      'Year', 'Month', 'Order Number', 'Product Code', 'Production Order',
      'Quantity', 'Customer', 'Delivery Date', 'Production Line',
      'Created By', 'Checked By', 'Plan Received Date', 'Notes'
    ];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length === 0 || !row[0]) continue; // Skip empty rows

      try {
        const workOrder: Partial<WorkOrder> = {
          factory: this.selectedFactory,
          year: parseInt(row[0]) || new Date().getFullYear(),
          month: parseInt(row[1]) || new Date().getMonth() + 1,
          orderNumber: row[2] || this.generateOrderNumber(),
          productCode: row[3],
          productionOrder: row[4],
          quantity: parseInt(row[5]) || 0,
          customer: row[6],
          deliveryDate: this.parseExcelDate(row[7]),
          productionLine: row[8],
          status: WorkOrderStatus.PENDING,
          createdBy: row[9],
          checkedBy: row[10] || '',
          planReceivedDate: this.parseExcelDate(row[11]),
          notes: row[12] || '',
          createdDate: new Date(),
          lastUpdated: new Date()
        };

        workOrders.push(workOrder);
      } catch (error) {
        console.error(`Error parsing row ${i}:`, error);
      }
    }

    return workOrders;
  }

  private parseExcelDate(dateValue: any): Date {
    if (!dateValue) return new Date();
    
    // If it's already a Date object
    if (dateValue instanceof Date) return dateValue;
    
    // If it's an Excel date number
    if (typeof dateValue === 'number') {
      return new Date((dateValue - 25569) * 86400 * 1000);
    }
    
    // If it's a string, try to parse it
    if (typeof dateValue === 'string') {
      const parsed = new Date(dateValue);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    }
    
    return new Date();
  }

  private async bulkInsertWorkOrders(workOrders: Partial<WorkOrder>[]): Promise<any> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    const total = workOrders.length;
    
    for (let i = 0; i < workOrders.length; i++) {
      try {
        await this.materialService.addWorkOrder(workOrders[i] as WorkOrder);
        results.success++;
        this.importProgress = Math.round(((i + 1) / total) * 100);
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: i + 2, // +2 because Excel rows start at 1 and we skip header
          data: workOrders[i],
          error: error
        });
      }
    }

    return results;
  }

  downloadTemplate(): void {
    const template = [
      ['Year', 'Month', 'Order Number', 'Product Code', 'Production Order', 'Quantity', 'Customer', 'Delivery Date', 'Production Line', 'Created By', 'Checked By', 'Plan Received Date', 'Notes'],
      [2024, 12, '', 'PROD001', 'PO-001', 100, 'Customer A', '2024-12-31', 'Line 1', 'John Doe', 'Jane Smith', '2024-12-01', 'Sample notes'],
      [2024, 12, '', 'PROD002', 'PO-002', 200, 'Customer B', '2024-12-30', 'Line 2', 'John Doe', '', '2024-12-01', '']
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Work Orders');
    
    XLSX.writeFile(workbook, `work-order-template-${this.selectedFactory}.xlsx`);
  }
}
