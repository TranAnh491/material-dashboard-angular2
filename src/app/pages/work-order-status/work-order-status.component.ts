import { Component, OnInit, OnDestroy } from '@angular/core';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';
import { WorkOrder, WorkOrderStatus } from '../../models/material-lifecycle.model';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit, OnDestroy {
  Object = Object;
  workOrders: WorkOrder[] = [];
  filteredWorkOrders: WorkOrder[] = [];
  
  // Import functionality
  selectedFunction: string | null = null;
  firebaseSaved: boolean = false;
  isSaving: boolean = false;
  isLoading: boolean = false;
  
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

  constructor(
    private materialService: MaterialLifecycleService,
    private firestore: AngularFirestore
  ) {
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
    
    // Set default function to view
    this.selectedFunction = 'view';
    
    this.loadWorkOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectFunction(functionName: string): void {
    this.selectedFunction = functionName;
    console.log('🔧 Selected function:', functionName);
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      console.log('📁 File selected:', file.name, 'Size:', file.size, 'bytes');
      
      // Validate file type
      const validExtensions = ['.xlsx', '.xls'];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      
      if (!validExtensions.includes(fileExtension)) {
        alert('❌ Vui lòng chọn file Excel (.xlsx hoặc .xls)');
        return;
      }
      
      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('❌ File quá lớn. Vui lòng chọn file nhỏ hơn 10MB');
        return;
      }
      
      console.log('✅ File validation passed, processing...');
      this.readExcelFile(file).then((jsonData) => {
        this.processExcelData(jsonData);
      }).catch((error) => {
        console.error('❌ Error reading Excel file:', error);
        alert(`❌ Lỗi khi đọc file Excel:\n${error.message || error}`);
      });
    }
  }

  loadWorkOrders(): void {
    console.log('🔄 Loading work orders from database...');
    
    // Always try fallback first for better reliability in production
    console.log('📄 Using direct Firestore methods for better reliability');
    this.loadWorkOrdersDirect();
  }
  
  private processLoadedWorkOrders(workOrders: WorkOrder[]): void {
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
  }
  
  private async loadWorkOrdersDirect(): Promise<void> {
    console.log('🔄 Loading work orders using direct Firestore...');
    
    try {
      // Try Firebase v9 SDK first (most reliable)
      console.log('📄 Trying Firebase v9 SDK first...');
      await this.loadWorkOrdersWithFirebaseV9();
    } catch (firebaseV9Error) {
      console.log('⚠️ Firebase v9 SDK failed, trying AngularFirestore...', firebaseV9Error);
      
      try {
        console.log('📄 Trying AngularFirestore...');
        this.firestore.collection('work-orders').snapshotChanges()
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (actions) => {
              const workOrders = actions.map(a => {
                const data = a.payload.doc.data() as WorkOrder;
                const id = a.payload.doc.id;
                return { id, ...data };
              });
              console.log('✅ AngularFirestore load successful!');
              this.processLoadedWorkOrders(workOrders);
            },
            error: (error) => {
              console.error('❌ All Firestore load methods failed!', error);
              // Try one more time after delay
              setTimeout(() => {
                console.log('🔄 Retrying load after delay...');
                this.loadWorkOrdersWithFirebaseV9();
              }, 2000);
            }
          });
      } catch (angularFireError) {
        console.error('❌ All Firestore load methods failed!', angularFireError);
        alert(`⚠️ Error loading work orders: ${angularFireError?.message || angularFireError}\n\nPlease check your internet connection and try refreshing the page.`);
      }
    }
  }
  
  private async loadWorkOrdersWithFirebaseV9(): Promise<void> {
    try {
      console.log('📄 Using Firebase v9 SDK to load work orders...');
      
      const app = initializeApp(environment.firebase);
      const db = getFirestore(app);
      const q = query(collection(db, 'work-orders'));
      
      const querySnapshot = await getDocs(q);
      const workOrders: WorkOrder[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as WorkOrder;
        workOrders.push({ id: doc.id, ...data });
      });
      
      console.log('✅ Firebase v9 SDK load successful!');
      this.processLoadedWorkOrders(workOrders);
    } catch (error) {
      console.error('❌ Firebase v9 SDK load failed!', error);
      throw error;
    }
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

      this.deleteWorkOrderWithFallback(workOrder.id!, workOrder)
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
      const deletePromises = workOrders.map(wo => this.deleteWorkOrderWithFallback(wo.id!, wo));
      
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
      
      // Show detailed results message - only alert on complete failure
      if (results.success === 0) {
        // Complete failure - show alert
        const message = `❌ Import thất bại hoàn toàn!\n\n` +
          `Không có work order nào được import thành công.\n` +
          `Vui lòng kiểm tra format file Excel và thử lại.`;
        alert(message);
      } else if (results.success > 0 && results.failed > 0) {
        // Partial success - log to console only, no alert to avoid confusion
        console.log(`⚠️ Import hoàn thành với một số lỗi:
✅ Thành công: ${results.success} work orders
❌ Thất bại: ${results.failed} work orders
Kiểm tra chi tiết lỗi trong popup import.`);
      } else {
        // Complete success - log to console only
        console.log(`🎉 Import hoàn thành thành công!
✅ Đã import thành công: ${results.success} work orders`);
      }
      
      // Always reload data to show any successful imports
      if (results.success > 0) {
        console.log('✅ Import successful! Reloading data and resetting filters...');
        
        // Close import dialog immediately to show results
        this.closeImportDialog();
        
        // Wait longer for Firestore to sync then reload
        setTimeout(() => {
          console.log('🔄 Reloading work orders after import...');
          
          // Reset filters to show all work orders (including newly imported ones)
          this.resetFiltersToShowAll();
          
          // Reload data
          this.loadWorkOrders(); // This will automatically call assignSequentialNumbers
          
          console.log('✅ Data reload completed');
        }, 2000); // Increased to 2 seconds for better Firestore sync
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
              
              // Add debug logging for service method
              console.log('🔍 Checking materialService:', {
                serviceExists: !!this.materialService,
                addWorkOrderExists: !!(this.materialService && this.materialService.addWorkOrder),
                serviceType: typeof this.materialService,
                methodType: typeof (this.materialService && this.materialService.addWorkOrder)
              });
              
              // Use direct Firestore method as backup for production build issues
              let result;
              if (this.materialService && typeof this.materialService.addWorkOrder === 'function') {
                console.log('📄 Using MaterialLifecycleService.addWorkOrder');
                result = await this.materialService.addWorkOrder(workOrder);
              } else {
                console.log('⚠️ Using fallback direct Firestore method');
                result = await this.addWorkOrderDirect(workOrder);
              }
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
    console.log('📥 Creating Work Order Excel template...');
    
    // Create template data
    const templateData = [
      ['Năm', 'Tháng', 'STT', 'Mã TP VN', 'LSX', 'Lượng sản phẩm', 'Khách hàng', 'Gấp', 'Ngày Giao NVL', 'Line', 'NVL thiếu', 'Người soạn', 'Tình trạng', 'Đủ/Thiếu', 'Ngày nhận thông tin', 'Ghi Chú'],
      [2024, 12, 'WO001', 'P/N001', 'PO2024001', 100, 'Khách hàng A', 'Gấp', '31/12/2024', 'Line 1', 'NVL A, NVL B', 'Hoàng Tuấn', 'Waiting', 'Đủ', '01/12/2024', 'Ghi chú mẫu'],
      [2024, 12, 'WO002', 'P/N002', 'PO2024002', 50, 'Khách hàng B', '', '15/12/2024', 'Line 2', '', 'Hữu Tình', 'Ready', 'Thiếu', '01/12/2024', ''],
      [2024, 12, 'WO003', 'P/N003', 'PO2024003', 75, 'Khách hàng C', '', '20/12/2024', 'Line 3', 'NVL C', 'Hoàng Vũ', 'Done', 'Đủ', '01/12/2024', 'Hoàn thành']
    ];
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    const columnWidths = [
      { wch: 8 },  // Năm
      { wch: 8 },  // Tháng
      { wch: 12 }, // STT
      { wch: 15 }, // Mã TP VN
      { wch: 15 }, // LSX
      { wch: 12 }, // Lượng sản phẩm
      { wch: 15 }, // Khách hàng
      { wch: 8 },  // Gấp
      { wch: 15 }, // Ngày Giao NVL
      { wch: 12 }, // Line
      { wch: 20 }, // NVL thiếu
      { wch: 12 }, // Người soạn
      { wch: 12 }, // Tình trạng
      { wch: 10 }, // Đủ/Thiếu
      { wch: 18 }, // Ngày nhận thông tin
      { wch: 20 }  // Ghi Chú
    ];
    worksheet['!cols'] = columnWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Work Orders Template');
    
    // Generate filename with current date
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const filename = `Work_Orders_Template_${dateStr}.xlsx`;
    
    // Download file
    XLSX.writeFile(workbook, filename);
    
    console.log('✅ Work Order template downloaded:', filename);
    alert(`✅ Đã tải xuống template Excel: ${filename}`);
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
  // Direct Firestore method as fallback for production build issues
  // Reset filters to show all work orders (useful after import)
  private resetFiltersToShowAll(): void {
    console.log('🔄 Resetting filters to show all work orders...');
    
    // Use existing showAllWorkOrders method to truly show everything
    this.showAllWorkOrders();
    
    console.log('✅ Filters reset to show all work orders');
  }

  private async addWorkOrderDirect(workOrder: WorkOrder): Promise<any> {
    console.log('🔄 Direct Firestore save for work order:', {
      orderNumber: workOrder.orderNumber,
      productCode: workOrder.productCode,
      customer: workOrder.customer
    });
    
    try {
      // Add timestamps
      workOrder.createdDate = new Date();
      workOrder.lastUpdated = new Date();
      
      // Try Angular Fire first
      try {
        const result = await this.firestore.collection('work-orders').add(workOrder);
        console.log('✅ Angular Fire save successful!', result);
        return result;
      } catch (angularFireError) {
        console.log('⚠️ Angular Fire failed, trying Firebase v9 SDK...', angularFireError);
        
        // Fallback to Firebase v9 modular SDK
        const app = initializeApp(environment.firebase);
        const db = getFirestore(app);
        const docRef = await addDoc(collection(db, 'work-orders'), workOrder);
        console.log('✅ Firebase v9 SDK save successful!', docRef);
        return { id: docRef.id };
      }
    } catch (error) {
      console.error('❌ All Firestore save methods failed!', error);
      throw new Error(`Direct Firestore save failed: ${error?.message || error}`);
    }
  }

  // Enhanced fallback delete method to handle all production issues
  private async deleteWorkOrderWithFallback(id: string, workOrder: WorkOrder): Promise<void> {
    console.log('🗑️ Attempting to delete work order:', id);
    
    // Try method 1: MaterialLifecycleService
    try {
      if (this.materialService && typeof this.materialService.deleteWorkOrder === 'function') {
        console.log('📄 Attempt 1: MaterialLifecycleService.deleteWorkOrder');
        await this.materialService.deleteWorkOrder(id);
        console.log('✅ MaterialLifecycleService delete successful');
        return; // Success, exit early
      }
    } catch (error) {
      console.log('⚠️ MaterialLifecycleService failed, trying fallback methods...', error);
    }

    // Try method 2: Direct AngularFirestore
    try {
      console.log('📄 Attempt 2: Direct AngularFirestore delete');
      await this.firestore.collection('work-orders').doc(id).delete();
      console.log('✅ Direct AngularFirestore delete successful');
      return; // Success, exit early
    } catch (error) {
      console.log('⚠️ AngularFirestore failed, trying Firebase v9 SDK...', error);
    }

    // Try method 3: Firebase v9 SDK (final fallback)
    try {
      console.log('📄 Attempt 3: Firebase v9 SDK delete');
      const app = initializeApp(environment.firebase);
      const db = getFirestore(app);
      await deleteDoc(doc(db, 'work-orders', id));
      console.log('✅ Firebase v9 SDK delete successful');
      return; // Success, exit early
    } catch (error) {
      console.error('❌ All delete methods failed!', error);
      throw new Error(`All delete methods failed for work order ${id}: ${error?.message || error}`);
    }
  }

  readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      console.log('📋 Starting Excel file processing...');
      
      const reader = new FileReader();
      
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Get the first sheet
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // Convert to JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          console.log('📊 Raw Excel data:', jsonData.length, 'rows');
          
          if (jsonData.length < 2) {
            throw new Error('File không có dữ liệu hoặc thiếu header');
          }
          
          resolve(jsonData);
          
        } catch (error) {
          console.error('❌ Error processing Excel file:', error);
          reject(error);
        }
      };
      
      reader.onerror = (error) => {
        console.error('❌ Error reading file:', error);
        reject(error);
      };
      
      reader.readAsArrayBuffer(file);
    });
  }

  processExcelData(jsonData: any[]): void {
    console.log('📋 Processing Excel data...');
    this.isLoading = true;
    
    try {
              // Remove header row and convert to WorkOrder format
        const dataRows = jsonData.slice(1); // Skip header row
        const newWorkOrderData = dataRows.map((row: any, index: number) => ({
          year: row[0] ? parseInt(row[0].toString()) : new Date().getFullYear(),
          month: row[1] ? parseInt(row[1].toString()) : new Date().getMonth() + 1,
          orderNumber: row[2]?.toString() || '',
          productCode: row[3]?.toString() || '',
          productionOrder: row[4]?.toString() || '',
          quantity: row[5] ? parseInt(row[5].toString()) : 0,
          customer: row[6]?.toString() || '',
          isUrgent: row[7]?.toString().toLowerCase() === 'gấp' || row[7]?.toString().toLowerCase() === 'urgent',
          deliveryDate: this.parseExcelDate(row[8]) || new Date(),
          productionLine: row[9]?.toString() || '',
          missingMaterials: row[10]?.toString() || '',
          createdBy: row[11]?.toString() || '',
          status: this.parseStatus(row[12]) || WorkOrderStatus.WAITING,
          materialsComplete: row[13]?.toString().toLowerCase() === 'đủ' || row[13]?.toString().toLowerCase() === 'complete',
          planReceivedDate: this.parseExcelDate(row[14]) || new Date(),
          notes: row[15]?.toString() || '',
          createdDate: new Date(),
          lastUpdated: new Date()
        } as WorkOrder));

      console.log('📋 Processed new work order data:', newWorkOrderData.length, 'items');

      // Validate data before saving
      if (newWorkOrderData.length === 0) {
        throw new Error('No data found in Excel file');
      }

      // Merge with existing data instead of replacing
      const existingData = this.workOrders || [];
      const mergedData = [...existingData, ...newWorkOrderData];

      console.log(`📊 Merging data: ${existingData.length} existing + ${newWorkOrderData.length} new = ${mergedData.length} total`);

      // Update the work orders data with merged data
      this.workOrders = mergedData;
      this.filteredWorkOrders = mergedData;

      // Save to Firebase
      this.saveToFirebase(this.workOrders);

      alert(`✅ Successfully imported ${newWorkOrderData.length} new work orders and merged with ${existingData.length} existing records. Total: ${mergedData.length} records saved to Firebase 🔥`);
      
    } catch (error) {
      console.error('❌ Error processing Excel data:', error);
      alert(`❌ Lỗi khi xử lý dữ liệu Excel:\n${error.message || error}`);
    } finally {
      this.isLoading = false;
    }
  }

  saveToFirebase(data: WorkOrder[]): void {
    console.log('🔥 Saving work orders to Firebase...');
    this.isSaving = true;
    
    const workOrderDoc = {
      data: data,
      importedAt: new Date(),
      month: this.getCurrentMonth(),
      recordCount: data.length,
      lastUpdated: new Date(),
      importHistory: [
        {
          importedAt: new Date(),
          recordCount: data.length,
          month: this.getCurrentMonth(),
          description: `Import ${data.length} work orders`
        }
      ]
    };

    console.log('📤 Attempting to save work order data:', {
      recordCount: workOrderDoc.recordCount,
      month: workOrderDoc.month,
      timestamp: workOrderDoc.importedAt
    });

    // Add timeout to Firebase save
    const savePromise = this.firestore.collection('workOrders').add(workOrderDoc);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase save timeout after 15 seconds')), 15000)
    );

    Promise.race([savePromise, timeoutPromise])
      .then((docRef: any) => {
        console.log('✅ Data successfully saved to Firebase with ID: ', docRef.id);
        this.firebaseSaved = true;
        this.isSaving = false;
        console.log('🔄 Updated firebaseSaved to:', this.firebaseSaved);
        alert('✅ Dữ liệu đã được lưu thành công vào Firebase!');
      })
      .catch((error) => {
        console.error('❌ Error saving to Firebase: ', error);
        this.isSaving = false;
        this.firebaseSaved = false;
        console.log('🔄 Updated firebaseSaved to:', this.firebaseSaved);
        alert(`❌ Lỗi khi lưu dữ liệu vào Firebase:\n${error.message || error}`);
      });
  }

  getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  parseStatus(statusStr: any): WorkOrderStatus {
    if (!statusStr) return WorkOrderStatus.WAITING;
    
    const status = statusStr.toString().toLowerCase();
    switch (status) {
      case 'waiting':
      case 'chờ':
        return WorkOrderStatus.WAITING;
      case 'kitting':
      case 'chuẩn bị':
        return WorkOrderStatus.KITTING;
      case 'ready':
      case 'sẵn sàng':
        return WorkOrderStatus.READY;
      case 'done':
      case 'hoàn thành':
        return WorkOrderStatus.DONE;
      case 'delay':
      case 'chậm':
        return WorkOrderStatus.DELAY;
      default:
        return WorkOrderStatus.WAITING;
    }
  }

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

  editWorkOrder(workOrder: WorkOrder): void {
    console.log('✏️ Editing work order:', workOrder);
    // For now, just log the action. You can implement edit functionality later
    alert(`Chỉnh sửa Work Order: ${workOrder.orderNumber || workOrder.productCode}`);
  }
}
