import { Component, OnInit, OnDestroy } from '@angular/core';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';
import { WorkOrder, WorkOrderStatus } from '../../models/material-lifecycle.model';
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
  

  
  // Filters
  searchTerm: string = '';
  statusFilter: WorkOrderStatus | 'all' = 'all';
  yearFilter: number = new Date().getFullYear();
  monthFilter: number = new Date().getMonth() + 1;
  
  // Summary data
  totalOrders: number = 0;
  waitingOrders: number = 0;
  kittingOrders: number = 0;
  readyOrders: number = 0;
  doneOrders: number = 0;
  delayOrders: number = 0;
  
  // Form data for new work order
  newWorkOrder: Partial<WorkOrder> = {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    orderNumber: '',
    productCode: '',
    productionOrder: '',
    quantity: 0,
    customer: '',
    deliveryDate: new Date(),
    productionLine: '',
    status: WorkOrderStatus.WAITING,
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
  availablePersons: string[] = ['Tuấn', 'Hưng', 'Tú', 'Phúc', 'Tình', 'Vũ', 'Toàn'];
  years: number[] = [];
  
  // Selection functionality for bulk operations
  selectedWorkOrders: WorkOrder[] = [];
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
    console.log('🚀 WorkOrderStatusComponent initialized');
    console.log('📅 Initial filters:', {
      year: this.yearFilter,
      month: this.monthFilter,
      status: this.statusFilter
    });
    
    this.loadWorkOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadWorkOrders(): void {
    console.log('🔄 Loading work orders from database...');
    
    this.materialService.getWorkOrders()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (workOrders) => {
          console.log(`📊 Loaded ${workOrders.length} work orders from database:`, workOrders);
          this.workOrders = workOrders;
          
          // Auto-assign sequential numbers based on delivery date within each month
          this.assignSequentialNumbers();
          
          // Debug: Check current filters
          console.log('🔍 Current filters:', {
            yearFilter: this.yearFilter,
            monthFilter: this.monthFilter,
            statusFilter: this.statusFilter,
            searchTerm: this.searchTerm
          });
          
          this.applyFilters();
          this.calculateSummary();
          
          console.log(`✅ After filtering: ${this.filteredWorkOrders.length} work orders displayed`);
          
          // Auto-adjust filters if no data is shown but data exists
          if (this.filteredWorkOrders.length === 0 && this.workOrders.length > 0) {
            console.log('⚠️ No work orders match current filters, but data exists. Checking if we should adjust filters...');
            this.handleEmptyFilterResults();
          }
        },
        error: (error) => {
          console.error('❌ Error loading work orders:', error);
          alert(`⚠️ Error loading work orders: ${error.message || error}\n\nPlease check your internet connection and try refreshing the page.`);
        }
      });
  }

  // Auto-assign sequential numbers based on delivery date within each month
  private assignSequentialNumbers(): void {
    console.log('🔢 Assigning sequential numbers based on delivery date...');
    
    // Group work orders by year and month from delivery date
    const groups: { [key: string]: WorkOrder[] } = {};
    
    this.workOrders.forEach(wo => {
      if (wo.deliveryDate) {
        // Ensure deliveryDate is a proper Date object
        const deliveryDate = wo.deliveryDate instanceof Date ? wo.deliveryDate : new Date(wo.deliveryDate);
        
        // Validate date
        if (isNaN(deliveryDate.getTime())) {
          console.warn('Invalid delivery date for work order:', wo.id, wo.deliveryDate);
          return;
        }
        
        const year = deliveryDate.getFullYear();
        const month = deliveryDate.getMonth() + 1; // 1-based month
        const key = `${year}-${month.toString().padStart(2, '0')}`;
        
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(wo);
        
        console.log(`🏷️ Work Order ${wo.productCode} -> Group ${key}, Delivery: ${deliveryDate.toLocaleDateString('vi-VN')}`);
      } else {
        console.warn('Work order missing delivery date:', wo.id, wo.productCode);
      }
    });
    
    // Sort each group by delivery date and assign sequential numbers
    Object.keys(groups).sort().forEach(key => {
      const workOrdersInMonth = groups[key];
      
      console.log(`📅 Processing group ${key} with ${workOrdersInMonth.length} work orders:`);
      
      // Debug: log before sorting
      workOrdersInMonth.forEach((wo, i) => {
        const deliveryDate = wo.deliveryDate instanceof Date ? wo.deliveryDate : new Date(wo.deliveryDate!);
        console.log(`  Before sort [${i}]: ${wo.productCode} - ${deliveryDate.toLocaleDateString('vi-VN')} (${deliveryDate.getTime()})`);
      });
      
      // Sort by delivery date (earliest first)
      workOrdersInMonth.sort((a, b) => {
        const dateA = a.deliveryDate instanceof Date ? a.deliveryDate : new Date(a.deliveryDate!);
        const dateB = b.deliveryDate instanceof Date ? b.deliveryDate : new Date(b.deliveryDate!);
        
        const timeA = dateA.getTime();
        const timeB = dateB.getTime();
        
        // Additional debug for sorting comparison
        console.log(`    Comparing: ${a.productCode} (${dateA.toLocaleDateString('vi-VN')}, ${timeA}) vs ${b.productCode} (${dateB.toLocaleDateString('vi-VN')}, ${timeB}) = ${timeA - timeB}`);
        
        return timeA - timeB;
      });
      
      // Debug: log after sorting
      console.log(`  After sort:`);
      workOrdersInMonth.forEach((wo, i) => {
        const deliveryDate = wo.deliveryDate instanceof Date ? wo.deliveryDate : new Date(wo.deliveryDate!);
        console.log(`    [${i}]: ${wo.productCode} - ${deliveryDate.toLocaleDateString('vi-VN')}`);
      });
      
      // Assign sequential numbers starting from 1
      workOrdersInMonth.forEach((wo, index) => {
        const newOrderNumber = (index + 1).toString();
        console.log(`  🔢 Assigning No.${newOrderNumber} to ${wo.productCode} (${wo.deliveryDate instanceof Date ? wo.deliveryDate.toLocaleDateString('vi-VN') : wo.deliveryDate})`);
        wo.orderNumber = newOrderNumber;
      });
      
      console.log(`📅 ${key}: Assigned numbers 1-${workOrdersInMonth.length} to ${workOrdersInMonth.length} work orders`);
    });
    
    console.log('✅ Sequential number assignment completed');
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
    
    // Sort filtered results by order number (numeric sort)
    this.filteredWorkOrders.sort((a, b) => {
      const numA = parseInt(a.orderNumber) || 0;
      const numB = parseInt(b.orderNumber) || 0;
      return numA - numB;
    });
    
    console.log(`🔍 Filter applied: ${this.filteredWorkOrders.length}/${this.workOrders.length} work orders match filters`);
    console.log(`📋 Filtered work orders sorted by No:`, this.filteredWorkOrders.map(wo => `${wo.orderNumber}: ${wo.productCode}`));
  }

  calculateSummary(): void {
    const filtered = this.filteredWorkOrders;
    this.totalOrders = filtered.length;
    this.waitingOrders = filtered.filter(wo => wo.status === WorkOrderStatus.WAITING).length;
    this.kittingOrders = filtered.filter(wo => wo.status === WorkOrderStatus.KITTING).length;
    this.readyOrders = filtered.filter(wo => wo.status === WorkOrderStatus.READY).length;
    this.doneOrders = filtered.filter(wo => wo.status === WorkOrderStatus.DONE).length;
    this.delayOrders = filtered.filter(wo => wo.status === WorkOrderStatus.DELAY).length;
  }

  onSearchChange(): void {
    this.clearSelection();
    this.applyFilters();
    this.calculateSummary();
  }

  onStatusFilterChange(): void {
    this.clearSelection();
    this.applyFilters();
    this.calculateSummary();
  }

  onYearFilterChange(): void {
    this.clearSelection();
    this.applyFilters();
    this.calculateSummary();
  }

  onMonthFilterChange(): void {
    this.clearSelection();
    this.applyFilters();
    this.calculateSummary();
  }

  // Debug method to show all work orders regardless of filters
  showAllWorkOrders(): void {
    console.log('🔍 Showing all work orders (ignoring filters)');
    this.filteredWorkOrders = [...this.workOrders];
    this.calculateSummary();
    console.log(`📊 Displaying all ${this.filteredWorkOrders.length} work orders`);
    
    if (this.workOrders.length > 0) {
      // Show summary of years/months in data
      const years = [...new Set(this.workOrders.map(wo => wo.year))].sort();
      const months = [...new Set(this.workOrders.map(wo => wo.month))].sort();
      
      alert(`📊 Hiển thị tất cả ${this.workOrders.length} work orders\n\n` +
        `Dữ liệu có trong các năm: ${years.join(', ')}\n` +
        `Dữ liệu có trong các tháng: ${months.join(', ')}\n\n` +
        `Bạn có thể dùng filter để lọc theo năm/tháng cụ thể.`);
    } else {
      alert('❌ Không có work order nào trong database.\nDữ liệu có thể chưa được lưu hoặc có lỗi kết nối.');
    }
  }

  addNewWorkOrder(): void {
    if (this.isValidWorkOrder()) {
      // Generate order number if not provided
      if (!this.newWorkOrder.orderNumber) {
        this.newWorkOrder.orderNumber = this.generateOrderNumber();
      }

      const workOrder: WorkOrder = {
        ...this.newWorkOrder,
        createdDate: new Date(),
        lastUpdated: new Date()
      } as WorkOrder;

      this.materialService.addWorkOrder(workOrder)
        .then((docRef) => {
          console.log('✅ Work order added successfully:', docRef.id);
          this.resetForm();
          this.isAddingWorkOrder = false;
          
          // Immediate refresh to show new work order
          setTimeout(() => {
            this.loadWorkOrders();
          }, 500);
        })
        .catch(error => {
          console.error('❌ Error adding work order:', error);
          alert(`❌ Error adding work order: ${error.message || error}\n\nPlease try again.`);
        });
    }
  }

  private generateOrderNumber(): string {
    const year = this.newWorkOrder.year?.toString().slice(-2) || '24';
    const month = this.newWorkOrder.month?.toString().padStart(2, '0') || '01';
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `WO-${year}${month}-${random}`;
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
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      orderNumber: '',
      productCode: '',
      productionOrder: '',
      quantity: 0,
      customer: '',
      deliveryDate: new Date(),
          productionLine: '',
    status: WorkOrderStatus.WAITING,
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

  updateWorkOrder(workOrder: WorkOrder, field: string, value: any): void {
    const updatedWorkOrder = { ...workOrder, [field]: value, lastUpdated: new Date() };
    
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
        console.error('Error updating work order:', error);
      });
  }

  deleteWorkOrder(workOrder: WorkOrder): void {
    // Enhanced confirmation dialog with more details
    const confirmMessage = `⚠️ DELETE WORK ORDER CONFIRMATION ⚠️

Work Order Details:
• Order Number: ${workOrder.orderNumber}
• Product Code: ${workOrder.productCode}
• Production Order: ${workOrder.productionOrder}
• Customer: ${workOrder.customer}
• Quantity: ${workOrder.quantity}
• Status: ${workOrder.status}

⚠️ WARNING: This action cannot be undone!

Are you absolutely sure you want to delete this work order?`;

    if (confirm(confirmMessage)) {
      // Show loading state
      const originalButtonText = event?.target instanceof HTMLElement ? (event.target.closest('button')?.innerHTML || '') : '';
      const deleteButton = event?.target instanceof HTMLElement ? event.target.closest('button') : null;
      
      if (deleteButton) {
        deleteButton.innerHTML = '<mat-icon>hourglass_empty</mat-icon>';
        deleteButton.setAttribute('disabled', 'true');
      }

      this.materialService.deleteWorkOrder(workOrder.id!)
        .then(() => {
          // Remove from local array
          this.workOrders = this.workOrders.filter(wo => wo.id !== workOrder.id);
          this.applyFilters();
          this.calculateSummary();
          
          // Show success message
          alert(`✅ Work Order ${workOrder.orderNumber} has been deleted successfully.`);
        })
        .catch(error => {
          console.error('Error deleting work order:', error);
          
          // Show error message
          alert(`❌ Error: Failed to delete Work Order ${workOrder.orderNumber}. Please try again.
          
Error details: ${error.message || 'Unknown error occurred'}`);
        })
        .finally(() => {
          // Restore button state
          if (deleteButton && originalButtonText) {
            deleteButton.innerHTML = originalButtonText;
            deleteButton.removeAttribute('disabled');
          }
        });
    }
  }

  // Add bulk delete functionality for multiple work orders
  deleteMultipleWorkOrders(workOrders: WorkOrder[]): void {
    if (workOrders.length === 0) {
      alert('⚠️ No work orders selected for deletion.');
      return;
    }

    const confirmMessage = `⚠️ BULK DELETE CONFIRMATION ⚠️

You are about to delete ${workOrders.length} work orders:

${workOrders.map(wo => `• ${wo.orderNumber} - ${wo.productCode} (${wo.customer})`).join('\n')}

⚠️ WARNING: This action cannot be undone!

Are you absolutely sure you want to delete these ${workOrders.length} work orders?`;

    if (confirm(confirmMessage)) {
      const deletePromises = workOrders.map(wo => this.materialService.deleteWorkOrder(wo.id!));
      
      Promise.allSettled(deletePromises)
        .then(results => {
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          
          // Update local data
          const deletedIds = workOrders.map(wo => wo.id);
          this.workOrders = this.workOrders.filter(wo => !deletedIds.includes(wo.id));
          this.applyFilters();
          this.calculateSummary();
          
          // Show results
          if (failed === 0) {
            alert(`✅ Successfully deleted all ${successful} work orders.`);
          } else {
            alert(`⚠️ Bulk delete completed:
• Successfully deleted: ${successful} work orders
• Failed to delete: ${failed} work orders

Please check the console for error details.`);
          }
        })
        .catch(error => {
          console.error('Bulk delete error:', error);
          alert(`❌ Error during bulk delete operation. Please try again.`);
        });
    }
  }

  getStatusClass(status: WorkOrderStatus): string {
    switch (status) {
      case WorkOrderStatus.WAITING: return 'status-waiting';
      case WorkOrderStatus.KITTING: return 'status-kitting';
      case WorkOrderStatus.READY: return 'status-ready';
      case WorkOrderStatus.DONE: return 'status-done';
      case WorkOrderStatus.DELAY: return 'status-delay';
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
      'Year', 'Month', 'Order Number', 'Product Code', 'Production Order', 
      'Quantity', 'Customer', 'Delivery Date', 'Production Line', 'Status', 
      'Created By', 'Checked By', 'Plan Received Date', 'Notes'
    ];
    
    const csvContent = [
      headers.join(','),
      ...this.filteredWorkOrders.map(wo => [
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
    a.download = `work-orders-${this.yearFilter}-${this.monthFilter}.csv`;
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
      console.log('📁 File selected:', file.name, 'Type:', file.type, 'Size:', file.size);
      
      // Basic file validation
      if (!file.name.match(/\.(xlsx?|csv)$/i)) {
        alert('❌ Please select a valid Excel file (.xlsx, .xls) or CSV file');
        return;
      }
      
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        alert('❌ File size too large. Please use a file smaller than 10MB');
        return;
      }
      
      this.importExcelFile(file);
    } else {
      console.log('No file selected');
    }
  }

  async importExcelFile(file: File): Promise<void> {
    this.isImporting = true;
    this.importProgress = 0;
    
    console.log('Starting Excel import process for file:', file.name, 'Size:', file.size, 'bytes');
    
    try {
      // Step 1: Read Excel file
      console.log('Step 1: Reading Excel file...');
      this.importProgress = 10;
      const data = await this.readExcelFile(file);
      console.log('Excel file read successfully, rows:', data.length);
      
      // Debug: Log first few rows to understand structure
      if (data.length > 0) {
        console.log('Excel headers:', data[0]);
        if (data.length > 1) {
          console.log('First data row:', data[1]);
        }
        if (data.length > 2) {
          console.log('Second data row:', data[2]);
        }
      }
      
      // Step 2: Parse data with timeout protection
      console.log('Step 2: Parsing Excel data...');
      this.importProgress = 20;
      
      const workOrders = await this.parseExcelDataWithTimeout(data);
      console.log(`✅ Parsed ${workOrders.length} valid work orders`);
      
      if (workOrders.length === 0) {
        throw new Error('No valid work orders found in the Excel file');
      }
      
      // Step 3: Bulk insert
      console.log('Step 3: Starting bulk insert...');
      this.importProgress = 30;
      const results = await this.bulkInsertWorkOrders(workOrders);
      
      // Step 4: Complete
      console.log('Step 4: Import completed');
      this.importResults = results;
      // Progress will be set to 100% by bulkInsertWorkOrders
      
      // Show detailed results message
      let message = '';
      if (results.success > 0 && results.failed === 0) {
        message = `🎉 Import hoàn thành thành công!\n\n` +
          `✅ Đã import thành công: ${results.success} work orders\n\n` +
          `Đang tải lại dữ liệu...`;
      } else if (results.success > 0 && results.failed > 0) {
        message = `⚠️ Import hoàn thành với một số lỗi:\n\n` +
          `✅ Thành công: ${results.success} work orders\n` +
          `❌ Thất bại: ${results.failed} work orders\n\n` +
          `Kiểm tra chi tiết lỗi trong popup import.\n\n` +
          `Đang tải lại dữ liệu...`;
      } else {
        message = `❌ Import thất bại hoàn toàn!\n\n` +
          `Không có work order nào được import thành công.\n` +
          `Vui lòng kiểm tra format file Excel và thử lại.`;
      }
      
      alert(message);
      
      // Always reload data to show any successful imports
      if (results.success > 0) {
        // Wait a bit for Firestore to sync then reload
        setTimeout(() => {
          this.loadWorkOrders(); // This will automatically call assignSequentialNumbers
        }, 1000);
      }
      
    } catch (error) {
      console.error('Import error:', error);
      const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
      
      this.importResults = {
        success: 0,
        failed: 1,
        errors: [{ 
          row: 0, 
          error: `Import failed: ${errorMessage}`,
          data: null 
        }]
      };
      
      // Show error message to user
      alert(`❌ Import failed:\n\n${errorMessage}\n\nPlease check the file format and try again.`);
      
    } finally {
      this.isImporting = false;
      this.importProgress = 100;
      console.log('Import process fully completed - UI updated');
      
      // Force UI update
      setTimeout(() => {
        this.importProgress = 100;
      }, 100);
    }
  }

  // Wrapper for parseExcelData with timeout protection
  private async parseExcelDataWithTimeout(data: any[]): Promise<Partial<WorkOrder>[]> {
    return new Promise((resolve, reject) => {
      // Set timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        reject(new Error('Excel parsing timeout after 30 seconds. File may be too large or complex.'));
      }, 30000);
      
      try {
        console.log('🔄 Starting Excel data parsing...');
        const result = this.parseExcelData(data);
        console.log('✅ Excel parsing completed successfully');
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        console.error('❌ Excel parsing failed:', error);
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  private readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          console.log('Reading Excel workbook...');
          
          // Read with array buffer for better compatibility
          const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          
          console.log('Workbook sheets:', workbook.SheetNames);
          
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error('No sheets found in Excel file');
          }
          
          const sheetName = workbook.SheetNames[0];
          console.log('Using sheet:', sheetName);
          
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet) {
            throw new Error(`Sheet "${sheetName}" not found`);
          }
          
          // Convert with header as first row and include empty cells
          const data = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1,
            defval: '', // Default value for empty cells
            blankrows: false // Skip completely empty rows
          });
          
          console.log('Extracted data rows:', data.length);
          resolve(data);
        } catch (error) {
          console.error('Error reading Excel file:', error);
          reject(`Failed to read Excel file: ${error.message || error}`);
        }
      };
      
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject('Error reading file: File may be corrupted or invalid format');
      };
      
      // Use readAsArrayBuffer for better compatibility
      reader.readAsArrayBuffer(file);
    });
  }

  private parseExcelData(data: any[]): Partial<WorkOrder>[] {
    if (data.length < 2) {
      throw new Error('Excel file must have headers and at least one data row');
    }

    const headers = data[0];
    const workOrders: Partial<WorkOrder>[] = [];
    const errors: string[] = [];

    console.log('Excel headers:', headers);
    console.log('Total rows to process:', data.length - 1);

    // Expected headers (simplified import - only essential fields, No will be auto-generated)
    const expectedHeaders = [
      'P/N', 'Work Order', 'Quantity', 'Customer', 'Delivery Date', 'Line', 'Plan Received'
    ];

    // Show date format reminder
    console.log('📅 Expected date format: DD/MM/YYYY (e.g., 31/12/2024)');
    console.log('🔢 Note: No column will be auto-generated based on delivery date sequence');

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // Skip completely empty rows
      if (!row || row.length === 0 || row.every(cell => !cell || cell === '')) {
        console.log(`Skipping empty row ${i}`);
        continue;
      }

      try {
        console.log(`Processing row ${i}:`, row);

        // Validate required fields with more lenient checking (updated indices since No column removed)
        if (!row[0] || row[0].toString().trim() === '') { // P/N is required
          errors.push(`Row ${i + 1}: Product Code (P/N) is required`);
          continue;
        }
        if (!row[1] || row[1].toString().trim() === '') { // Work Order is required
          errors.push(`Row ${i + 1}: Work Order is required`);
          continue;
        }
        
        // More lenient quantity check
        const quantityValue = row[2];
        const quantity = parseInt(quantityValue);
        if (!quantityValue || isNaN(quantity) || quantity <= 0) { // Quantity is required and must be positive number
          errors.push(`Row ${i + 1}: Valid positive quantity is required (got: ${quantityValue})`);
          continue;
        }
        
        if (!row[3] || row[3].toString().trim() === '') { // Customer is required
          errors.push(`Row ${i + 1}: Customer is required`);
          continue;
        }
        if (!row[5] || row[5].toString().trim() === '') { // Line is required
          errors.push(`Row ${i + 1}: Production Line is required`);
          continue;
        }

        const workOrder: Partial<WorkOrder> = {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          orderNumber: '', // Will be auto-assigned based on delivery date sequence
          productCode: row[0].toString().trim(), // P/N
          productionOrder: row[1].toString().trim(), // Work Order
          quantity: quantity, // Use the validated quantity
          customer: row[3].toString().trim(), // Customer
          deliveryDate: undefined, // Sẽ gán bên dưới
          productionLine: row[5].toString().trim(), // Line
          status: WorkOrderStatus.WAITING,
          createdBy: 'Excel Import', // Set import source
          checkedBy: '', // Will be set on web
          planReceivedDate: undefined, // Sẽ gán bên dưới
          notes: 'Imported from Excel', // Set import note
          createdDate: new Date(),
          lastUpdated: new Date()
        };

        // Parse and log Delivery Date
        const deliveryRaw = row[4];
        const deliveryParsed = this.parseExcelDate(deliveryRaw);
        if (!deliveryParsed || isNaN(deliveryParsed.getTime())) {
          console.warn(`Row ${i + 1}: Delivery Date parse failed! Raw value:`, deliveryRaw, 'Parsed:', deliveryParsed);
        } else {
          console.log(`Row ${i + 1}: Delivery Date OK. Raw:`, deliveryRaw, 'Parsed:', deliveryParsed);
        }
        workOrder.deliveryDate = deliveryParsed;

        // Parse and log Plan Received Date
        const planRaw = row[6];
        const planParsed = this.parseExcelDate(planRaw);
        if (!planParsed || isNaN(planParsed.getTime())) {
          console.warn(`Row ${i + 1}: Plan Received Date parse failed! Raw value:`, planRaw, 'Parsed:', planParsed);
        } else {
          console.log(`Row ${i + 1}: Plan Received Date OK. Raw:`, planRaw, 'Parsed:', planParsed);
        }
        workOrder.planReceivedDate = planParsed;

        console.log(`Successfully parsed work order:`, workOrder);
        workOrders.push(workOrder);
      } catch (error) {
        const errorMsg = `Row ${i + 1}: ${error?.message || error?.toString() || 'Unknown parsing error'}`;
        console.error(errorMsg, error);
        errors.push(errorMsg);
        // Continue processing other rows even if this one fails
      }
    }

    console.log(`✅ Parsed ${workOrders.length} work orders from ${data.length - 1} rows`);
    
    if (errors.length > 0) {
      console.warn('⚠️ Parsing errors found:', errors);
      console.warn(`🔢 ${errors.length} rows had issues and were skipped`);
      console.warn(`📅 Remember: Date format should be DD/MM/YYYY (e.g., 31/12/2024)`);
      
      // Store errors for later display instead of blocking with alert
      this.importResults = this.importResults || { success: 0, failed: 0, errors: [] };
      this.importResults.parseErrors = errors;
    }

    if (workOrders.length === 0) {
      throw new Error(`No valid work orders found in Excel file. Found ${errors.length} parsing errors. Please check the data format and column headers.`);
    }

    return workOrders;
  }

  private parseExcelDate(dateValue: any): Date {
    try {
      if (!dateValue) {
        console.log('Empty date value, using current date');
        return new Date();
      }
      
      console.log('Parsing date value:', dateValue, 'Type:', typeof dateValue);
    
    // If it's already a Date object
      if (dateValue instanceof Date) {
        if (isNaN(dateValue.getTime())) {
          console.warn('Invalid Date object, using current date');
          return new Date();
        }
        console.log('Already a Date object:', dateValue);
        return dateValue;
      }
      
      // If it's an Excel date number (days since 1900-01-01)
      if (typeof dateValue === 'number' && dateValue > 1) {
        try {
          const excelDate = new Date((dateValue - 25569) * 86400 * 1000);
          if (isNaN(excelDate.getTime())) {
            throw new Error('Invalid Excel date calculation');
          }
          console.log('Parsed Excel number date:', dateValue, '->', excelDate);
          return excelDate;
        } catch (error) {
          console.error('Error parsing Excel date number:', error);
          return new Date();
        }
    }
    
    // If it's a string, try to parse it
    if (typeof dateValue === 'string') {
        const trimmedValue = dateValue.trim();
        if (!trimmedValue) {
          return new Date();
        }
        
        // Try different date formats
        let parsed: Date;
        
        try {
          // Priority Format: DD/MM/YYYY (Vietnamese standard)
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmedValue)) {
            const parts = trimmedValue.split('/');
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);
            
            // Validate day and month ranges
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
              // Create date in DD/MM/YYYY format
              parsed = new Date(year, month - 1, day); // month is 0-indexed in JS Date
              if (!isNaN(parsed.getTime())) {
                console.log('Parsed DD/MM/YYYY date:', trimmedValue, '->', parsed);
                return parsed;
              }
            }
            console.warn('Invalid DD/MM/YYYY date range:', trimmedValue);
          }
          // Format: YYYY-MM-DD
          else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
            parsed = new Date(trimmedValue + 'T00:00:00');
            if (!isNaN(parsed.getTime())) {
              console.log('Parsed YYYY-MM-DD date:', trimmedValue, '->', parsed);
              return parsed;
            }
          }
          // Format: DD-MM-YYYY
          else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmedValue)) {
            const parts = trimmedValue.split('-');
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);
            
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
              parsed = new Date(year, month - 1, day);
              if (!isNaN(parsed.getTime())) {
                console.log('Parsed DD-MM-YYYY date:', trimmedValue, '->', parsed);
                return parsed;
              }
            }
            console.warn('Invalid DD-MM-YYYY date range:', trimmedValue);
          }
          
          // Fallback to default Date parsing
          parsed = new Date(trimmedValue);
          if (!isNaN(parsed.getTime())) {
            console.log('Parsed with default parser:', trimmedValue, '->', parsed);
            return parsed;
          }
          
        } catch (parseError) {
          console.error('Error parsing date string:', parseError);
        }
      }
      
      console.log('Unable to parse date, using current date');
      return new Date();
      
    } catch (error) {
      console.error('Unexpected error in parseExcelDate:', error);
    return new Date();
    }
  }

  private async bulkInsertWorkOrders(workOrders: Partial<WorkOrder>[]): Promise<any> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    const total = workOrders.length;
    console.log(`🚀 Starting bulk insert of ${total} work orders...`);
    console.log('📊 Sample work order data:', workOrders[0]);
    
    // Progress range: 30% - 95% (reserve 5% for final steps)
    const progressStart = 30;
    const progressEnd = 95;
    const progressRange = progressEnd - progressStart;
    
    // Process in smaller batches to avoid overwhelming Firestore
    const batchSize = 3; // Reduce batch size for better debugging
    
    for (let batchStart = 0; batchStart < total; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, total);
      const batch = workOrders.slice(batchStart, batchEnd);
      const batchNumber = Math.floor(batchStart/batchSize) + 1;
      const totalBatches = Math.ceil(total / batchSize);
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches}: items ${batchStart + 1}-${batchEnd}`);
    
      // Process batch items sequentially for better error tracking
      for (let i = 0; i < batch.length; i++) {
        const workOrderData = batch[i];
        const globalIndex = batchStart + i;
        
        try {
          console.log(`🔄 Processing work order ${globalIndex + 1}/${total}:`, workOrderData);
          
          // Additional validation before insert
          const workOrder = workOrderData as WorkOrder;
          
          // Validate required fields with detailed logging
          if (!workOrder.productCode || !workOrder.productionOrder || !workOrder.customer) {
            const missingFields = [];
            if (!workOrder.productCode) missingFields.push('productCode');
            if (!workOrder.productionOrder) missingFields.push('productionOrder'); 
            if (!workOrder.customer) missingFields.push('customer');
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
          }
          
          // Ensure all required fields have valid values with logging
          if (!workOrder.orderNumber) {
            workOrder.orderNumber = this.generateOrderNumber();
            console.log(`🏷️ Generated order number: ${workOrder.orderNumber}`);
          }
          if (!workOrder.deliveryDate) {
            workOrder.deliveryDate = new Date();
            console.log(`📅 Set default delivery date: ${workOrder.deliveryDate}`);
          }
          if (!workOrder.planReceivedDate) {
            workOrder.planReceivedDate = new Date();
            console.log(`📅 Set default plan received date: ${workOrder.planReceivedDate}`);
          }
          
                     // Add default values if missing
           if (!workOrder.status) workOrder.status = WorkOrderStatus.WAITING;
           if (!workOrder.productionLine) workOrder.productionLine = 'Line 1';
          if (!workOrder.year) workOrder.year = new Date().getFullYear();
          if (!workOrder.month) workOrder.month = new Date().getMonth() + 1;
          
          console.log(`📤 Sending to Firebase:`, JSON.stringify(workOrder, null, 2));
          
          // Try with retry mechanism
          let saveSuccess = false;
          let lastError;
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log(`🔄 Firebase save attempt ${attempt}/3 for work order ${globalIndex + 1}`);
              
              const result = await this.materialService.addWorkOrder(workOrder);
              console.log(`✅ Firebase save successful on attempt ${attempt}:`, result);
              saveSuccess = true;
              break;
              
            } catch (saveError) {
              console.error(`❌ Firebase save attempt ${attempt} failed:`, saveError);
              lastError = saveError;
              
              if (attempt < 3) {
                console.log(`⏳ Waiting 1 second before retry...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }
          
          if (!saveSuccess) {
            throw lastError || new Error('Failed to save after 3 attempts');
          }
          
        results.success++;
          console.log(`✅ Successfully saved work order ${globalIndex + 1}: ${workOrder.orderNumber} (Total success: ${results.success})`);
          
      } catch (error) {
          console.error(`❌ Failed to process work order ${globalIndex + 1}:`, error);
          console.error('📋 Failed work order data:', workOrderData);
          console.error('🔍 Error details:', {
            message: error?.message,
            stack: error?.stack,
            name: error?.name
          });
          
        results.failed++;
        results.errors.push({
            row: globalIndex + 2, // +2 for Excel row numbering
            data: workOrderData,
            error: `${error?.message || error?.toString() || 'Unknown error'} (Attempts: 3)`
          });
        }
        
        // Update progress
        const completed = results.success + results.failed;
        const progressPercent = (completed / total) * progressRange + progressStart;
        this.importProgress = Math.round(progressPercent);
        console.log(`📈 Progress update: ${completed}/${total} completed = ${this.importProgress}%`);
        
        // Small delay between items to prevent rate limiting
        if (globalIndex < total - 1) {
          console.log(`⏳ Waiting 300ms before next item...`);
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      console.log(`✅ Batch ${batchNumber}/${totalBatches} completed. Current results: ${results.success} success, ${results.failed} failed`);
    }

    console.log(`🏁 Bulk insert completed: ${results.success} success, ${results.failed} failed`);
    
    // Log detailed results
    if (results.errors.length > 0) {
      console.error('❌ Import errors summary:');
      results.errors.forEach((error, index) => {
        console.error(`Error ${index + 1}: Row ${error.row} - ${error.error}`);
      });
    }
    
    // Ensure progress reaches 100% when completely finished
    this.importProgress = 100;
    console.log('🎯 Progress set to 100% - Import process completed');

    return results;
  }

  downloadTemplate(): void {
    // Create template data with proper headers (No column removed)
    const templateData = [
      ['P/N', 'Work Order', 'Quantity', 'Customer', 'Delivery Date', 'Line', 'Plan Received'], // Headers
      ['A005165', 'KZLSX0725/0062', '75', 'HOB', '03/07/2025', 'WH A', '26/06/2025'], // Sample 1
      ['P002117_A.1', 'KZLSX0725/0131', '7', 'HPPS', '03/07/2025', 'USB B', '26/06/2025'], // Sample 2
      ['P005773_A', 'KZLSX0725/0173', '3', 'GIL', '03/07/2025', 'WH C', '26/06/2025'] // Sample 3
    ];

    // Create workbook and worksheet
    const ws = XLSX.utils.aoa_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Work Orders');

    // Set column widths for better readability
    ws['!cols'] = [
      { wch: 15 }, // P/N
      { wch: 20 }, // Work Order  
      { wch: 10 }, // Quantity
      { wch: 15 }, // Customer
      { wch: 15 }, // Delivery Date
      { wch: 12 }, // Line
      { wch: 15 }  // Plan Received
    ];

    // Download the file
    XLSX.writeFile(wb, 'work-order-import-template.xlsx');
    
    console.log('✅ Template downloaded successfully');
    alert('📥 Template downloaded!\n\n' +
      '📋 Format:\n' +
      '• P/N: Product code\n' +
      '• Work Order: Production order number\n' +
      '• Quantity: Positive number\n' +
      '• Customer: Customer name\n' +
      '• Delivery Date: DD/MM/YYYY format\n' +
      '• Line: Production line\n' +
      '• Plan Received: DD/MM/YYYY format\n\n' +
      '🔢 Note: No column will be auto-generated based on delivery date sequence within each month.');
  }

  // Selection functionality methods
  isSelected(workOrder: WorkOrder): boolean {
    return this.selectedWorkOrders.some(wo => wo.id === workOrder.id);
  }

  toggleSelection(workOrder: WorkOrder, event: any): void {
    if (event.checked) {
      this.selectedWorkOrders.push(workOrder);
    } else {
      this.selectedWorkOrders = this.selectedWorkOrders.filter(wo => wo.id !== workOrder.id);
    }
  }

  isAllSelected(): boolean {
    return this.filteredWorkOrders.length > 0 && 
           this.selectedWorkOrders.length === this.filteredWorkOrders.length;
  }

  isIndeterminate(): boolean {
    return this.selectedWorkOrders.length > 0 && 
           this.selectedWorkOrders.length < this.filteredWorkOrders.length;
  }

  toggleAllSelection(event: any): void {
    if (event.checked) {
      // Select all filtered work orders
      this.selectedWorkOrders = [...this.filteredWorkOrders];
    } else {
      // Deselect all
      this.selectedWorkOrders = [];
    }
  }

  deleteSelectedWorkOrders(): void {
    if (this.selectedWorkOrders.length === 0) {
      alert('⚠️ No work orders selected for deletion.');
      return;
    }

    this.deleteMultipleWorkOrders(this.selectedWorkOrders);
    
    // Clear selection after deletion attempt
    this.selectedWorkOrders = [];
  }

  // Clear selection when filters change
  private clearSelection(): void {
    this.selectedWorkOrders = [];
  }

  // Handle case when filters result in no data but work orders exist
  private handleEmptyFilterResults(): void {
    console.log('🔧 Analyzing filter mismatch...');
    
    // Find unique years and months in the data
    const availableYears = [...new Set(this.workOrders.map(wo => wo.year))].sort();
    const availableMonths = [...new Set(this.workOrders.map(wo => wo.month))].sort();
    
    console.log('📊 Available data:', {
      years: availableYears,
      months: availableMonths,
      currentFilters: { year: this.yearFilter, month: this.monthFilter }
    });
    
    // Check if current year exists in data
    const hasCurrentYear = availableYears.includes(this.yearFilter);
    const hasCurrentMonth = this.workOrders.some(wo => wo.year === this.yearFilter && wo.month === this.monthFilter);
    
    if (!hasCurrentYear && availableYears.length > 0) {
      console.log(`⚡ Auto-adjusting year filter from ${this.yearFilter} to ${availableYears[availableYears.length - 1]}`);
      this.yearFilter = availableYears[availableYears.length - 1]; // Use most recent year
    }
    
    if (!hasCurrentMonth && availableYears.includes(this.yearFilter)) {
      const monthsInYear = [...new Set(this.workOrders.filter(wo => wo.year === this.yearFilter).map(wo => wo.month))].sort();
      if (monthsInYear.length > 0) {
        console.log(`⚡ Auto-adjusting month filter from ${this.monthFilter} to ${monthsInYear[monthsInYear.length - 1]}`);
        this.monthFilter = monthsInYear[monthsInYear.length - 1]; // Use most recent month in year
      }
    }
    
    // Re-apply filters after adjustment
    this.applyFilters();
    this.calculateSummary();
    
    if (this.filteredWorkOrders.length > 0) {
      console.log('✅ Filters auto-adjusted successfully');
      alert(`📅 Filters đã được tự động điều chỉnh để hiển thị dữ liệu:\n• Năm: ${this.yearFilter}\n• Tháng: ${this.monthFilter}\n\nHiển thị ${this.filteredWorkOrders.length} work orders.`);
    } else {
      console.log('❌ Still no data after filter adjustment');
    }
  }
}
