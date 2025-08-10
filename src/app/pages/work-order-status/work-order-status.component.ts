import { Component, OnInit, OnDestroy } from '@angular/core';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';
import { WorkOrder, WorkOrderStatus } from '../../models/material-lifecycle.model';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { environment } from '../../../environments/environment';
import { UserPermissionService } from '../../services/user-permission.service';

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
  selectedFactory: string = 'ASM1'; // Default to ASM1
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
  transferOrders: number = 0;
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
  showTimeRangeDialog: boolean = false;
  
  // Time range for filtering
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  showHiddenWorkOrders: boolean = false;
  
  // Delete functionality
  showDeleteDialog: boolean = false;
  deleteStartDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  deleteEndDate: Date = new Date();
  deleteFactoryFilter: string = '';
  deletePreviewItems: WorkOrder[] = [];
  isDeleting: boolean = false;
  currentUserDepartment: string = '';
  currentUserId: string = '';
  hasDeletePermissionValue: boolean = false;
  hasCompletePermissionValue: boolean = false;
  
  // Scan functionality
  showScanDialog: boolean = false;
  scannedQRData: string = '';
  scanResult: string = '';
  isScanning: boolean = false;
  scanMode: 'text' | 'camera' = 'text';
  qrScanner: any = null;
  
  isAddingWorkOrder: boolean = false;
  availableLines: string[] = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'];
  availablePersons: string[] = ['Tuấn', 'Tình', 'Vũ', 'Phúc', 'Tú', 'Hưng', 'Toàn', 'Ninh'];
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
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private userPermissionService: UserPermissionService
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
    
    // Load user department information and permissions
    this.loadUserDepartment();
    this.loadDeletePermission();
    
    // Set default function to view
    this.selectedFunction = 'view';
    
    this.loadWorkOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopCameraScanner();
  }

  selectFunction(functionName: string): void {
    this.selectedFunction = functionName;
    console.log('🔧 Selected function:', functionName);
  }

  selectFactory(factory: string): void {
    this.selectedFactory = factory;
    console.log('🏭 Selected factory:', factory);
    // Re-apply filters to show only work orders from selected factory
    this.applyFilters();
    // Update summary cards based on selected factory
    this.calculateSummary();
  }

  // Helper method to normalize factory names for comparison
  private normalizeFactoryName(factory: string): string {
    if (!factory) return '';
    return factory.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Helper method to reset all loading states
  resetLoadingStates(): void {
    this.isLoading = false;
    this.isSaving = false;
    this.isImporting = false;
    this.importProgress = 0;
    console.log('🔄 Reset all loading states');
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
    
    // Process date fields to ensure they are proper Date objects
    const processedWorkOrders = workOrders.map(wo => {
      const processedWo = { ...wo };
      
      // Handle deliveryDate
      if (processedWo.deliveryDate) {
        if (typeof processedWo.deliveryDate === 'object' && processedWo.deliveryDate !== null && 'toDate' in processedWo.deliveryDate) {
          // Firestore Timestamp
          processedWo.deliveryDate = (processedWo.deliveryDate as any).toDate();
          console.log(`📅 Converted deliveryDate from Firestore Timestamp:`, processedWo.deliveryDate);
        } else if (typeof processedWo.deliveryDate === 'string') {
          // String date
          processedWo.deliveryDate = new Date(processedWo.deliveryDate);
          console.log(`📅 Converted deliveryDate from string:`, processedWo.deliveryDate);
        } else if (!(processedWo.deliveryDate instanceof Date)) {
          // Other format, try to convert
          processedWo.deliveryDate = new Date(processedWo.deliveryDate);
          console.log(`📅 Converted deliveryDate from other format:`, processedWo.deliveryDate);
        }
      }
      
      // Handle planReceivedDate
      if (processedWo.planReceivedDate) {
        if (typeof processedWo.planReceivedDate === 'object' && processedWo.planReceivedDate !== null && 'toDate' in processedWo.planReceivedDate) {
          // Firestore Timestamp
          processedWo.planReceivedDate = (processedWo.planReceivedDate as any).toDate();
          console.log(`📅 Converted planReceivedDate from Firestore Timestamp:`, processedWo.planReceivedDate);
        } else if (typeof processedWo.planReceivedDate === 'string') {
          // String date
          processedWo.planReceivedDate = new Date(processedWo.planReceivedDate);
          console.log(`📅 Converted planReceivedDate from string:`, processedWo.planReceivedDate);
        } else if (!(processedWo.planReceivedDate instanceof Date)) {
          // Other format, try to convert
          processedWo.planReceivedDate = new Date(processedWo.planReceivedDate);
          console.log(`📅 Converted planReceivedDate from other format:`, processedWo.planReceivedDate);
        }
      }
      
      // Handle createdDate and lastUpdated
      if (processedWo.createdDate && typeof processedWo.createdDate === 'object' && processedWo.createdDate !== null && 'toDate' in processedWo.createdDate) {
        processedWo.createdDate = (processedWo.createdDate as any).toDate();
      }
      if (processedWo.lastUpdated && typeof processedWo.lastUpdated === 'object' && processedWo.lastUpdated !== null && 'toDate' in processedWo.lastUpdated) {
        processedWo.lastUpdated = (processedWo.lastUpdated as any).toDate();
      }
      
      return processedWo;
    });
    
    this.workOrders = processedWorkOrders;
    console.log(`✅ Processed ${processedWorkOrders.length} work orders with proper date handling`);
    
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
      
      // Only apply year/month filters if they are explicitly set by user (not default values)
      // This allows showing all imported data initially
      const matchesYear = true; // Show all years initially
      const matchesMonth = true; // Show all months initially
      
      // Filter by selected factory - but be more flexible to handle missing factory data
      const matchesFactory = !this.selectedFactory || 
                           (wo.factory && this.normalizeFactoryName(wo.factory) === this.normalizeFactoryName(this.selectedFactory)) || 
                           (!wo.factory && this.selectedFactory === 'ASM1'); // Default to ASM1 if no factory specified
      
      // Debug factory matching
      if (this.selectedFactory && wo.factory) {
        const normalizedData = this.normalizeFactoryName(wo.factory);
        const normalizedSelected = this.normalizeFactoryName(this.selectedFactory);
        console.log(`🔍 Factory comparison: "${wo.factory}" (normalized: "${normalizedData}") === "${this.selectedFactory}" (normalized: "${normalizedSelected}") = ${normalizedData === normalizedSelected}`);
      }
      
      // Hide completed work orders unless showHiddenWorkOrders is true
      const isNotCompleted = wo.status !== WorkOrderStatus.DONE || this.showHiddenWorkOrders;
      
      return matchesSearch && matchesStatus && matchesYear && matchesMonth && matchesFactory && isNotCompleted;
    });
    
    // Sort filtered results: urgent first, then by delivery date (earliest first)
    this.filteredWorkOrders.sort((a, b) => {
      // First priority: urgent work orders go to the top
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      
      // Second priority: delivery date (earliest first)
      const dateA = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
      const dateB = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
      return dateA - dateB;
    });
    
    console.log(`🔍 Filter applied: ${this.filteredWorkOrders.length}/${this.workOrders.length} work orders match filters`);
    console.log(`📋 Filtered work orders sorted by No:`, this.filteredWorkOrders.map(wo => `${wo.orderNumber}: ${wo.productCode}`));
    console.log(`🏭 Current factory filter: ${this.selectedFactory}`);
    console.log(`📊 Work orders by factory:`, this.workOrders.map(wo => `${wo.orderNumber}: factory=${wo.factory || 'undefined'}`));
    
    // Debug: Show all unique factory values in data
    const uniqueFactories = [...new Set(this.workOrders.map(wo => wo.factory).filter(f => f))];
    console.log(`🏭 Unique factories in data:`, uniqueFactories);
    console.log(`🔍 Selected factory: "${this.selectedFactory}"`);
    console.log(`🔍 Looking for matches with case-insensitive comparison...`);
  }

  calculateSummary(): void {
    const filtered = this.filteredWorkOrders;
    this.totalOrders = filtered.length;
    this.waitingOrders = filtered.filter(wo => wo.status === WorkOrderStatus.WAITING).length;
    this.kittingOrders = filtered.filter(wo => wo.status === WorkOrderStatus.KITTING).length;
    this.readyOrders = filtered.filter(wo => wo.status === WorkOrderStatus.READY).length;
    this.transferOrders = filtered.filter(wo => wo.status === WorkOrderStatus.TRANSFER).length;
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
    console.log(`🔄 Updating work order ${workOrder.id} - Field: ${field}, Value:`, value);
    
    // Handle date fields specifically
    let processedValue = value;
    if (field === 'deliveryDate' || field === 'planReceivedDate') {
      if (value instanceof Date) {
        processedValue = value;
        console.log(`📅 Date field ${field} - Original:`, value, 'Type:', typeof value);
      } else if (value && typeof value === 'string') {
        processedValue = new Date(value);
        console.log(`📅 Converting string to Date for ${field}:`, value, '→', processedValue);
      } else if (value && value.toDate) {
        // Handle Firestore Timestamp
        processedValue = value.toDate();
        console.log(`📅 Converting Firestore Timestamp for ${field}:`, value, '→', processedValue);
      }
    }
    
    const updatedWorkOrder = { 
      ...workOrder, 
      [field]: processedValue, 
      lastUpdated: new Date() 
    };
    
    console.log(`💾 Saving to Firebase - Updated work order:`, updatedWorkOrder);
    
    this.materialService.updateWorkOrder(workOrder.id!, updatedWorkOrder)
      .then(() => {
        console.log(`✅ Successfully updated work order ${workOrder.id} in Firebase`);
        
        // Update local array
        const index = this.workOrders.findIndex(wo => wo.id === workOrder.id);
        if (index !== -1) {
          this.workOrders[index] = { ...this.workOrders[index], ...updatedWorkOrder };
          this.applyFilters();
          this.calculateSummary();
          console.log(`✅ Updated local work order data`);
        }
      })
      .catch(error => {
        console.error(`❌ Error updating work order ${workOrder.id}:`, error);
        alert(`❌ Lỗi khi cập nhật work order: ${error.message || error}`);
      });
  }

  async deleteWorkOrder(workOrder: WorkOrder): Promise<void> {
    // Check delete permission first
    const hasPermission = await this.hasDeletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền xóa dữ liệu! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }

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
  async deleteMultipleWorkOrders(workOrders: WorkOrder[]): Promise<void> {
    // Check delete permission first
    const hasPermission = await this.hasDeletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền xóa dữ liệu! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }

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
      case WorkOrderStatus.TRANSFER: return 'status-transfer';
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
    // Filter by selected factory and current month/year
    const filteredData = this.workOrders.filter(wo => 
      wo.factory === this.selectedFactory && 
      wo.year === this.yearFilter && 
      wo.month === this.monthFilter
    );

    if (filteredData.length === 0) {
      alert(`❌ Không có dữ liệu nào cho nhà máy ${this.selectedFactory} trong tháng ${this.monthFilter}/${this.yearFilter}`);
      return;
    }

    const headers = [
      'Năm', 'Tháng', 'STT', 'Mã TP VN LSX', 'Lượng', 'Khách hàng', 'Gấp',
      'Ngày Giao Line', 'NVL thiếu', 'Người soạn', 'Tình trạng', 'Đủ/Thiếu',
      'Ngày nhận thông tin', 'Ghi Chú'
    ];
    
    const csvData = filteredData.map((wo, index) => [
      wo.year,
      wo.month,
      index + 1,
      `${wo.productCode || ''} ${wo.productionOrder || ''}`.trim(),
      wo.quantity,
      wo.customer,
      wo.isUrgent ? 'Có' : 'Không',
      wo.deliveryDate ? new Date(wo.deliveryDate).toLocaleDateString('vi-VN') : '',
      wo.missingMaterials || '',
      wo.createdBy || '',
      this.getStatusText(wo.status),
      wo.materialsStatus === 'sufficient' ? 'Đủ' : wo.materialsStatus === 'insufficient' ? 'Thiếu' : '',
      wo.planReceivedDate ? new Date(wo.planReceivedDate).toLocaleDateString('vi-VN') : '',
      wo.notes || ''
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-orders-${this.selectedFactory}-${this.yearFilter}-${this.monthFilter}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    console.log(`📊 Xuất ${filteredData.length} work orders của nhà máy ${this.selectedFactory} tháng ${this.monthFilter}/${this.yearFilter}`);
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
      
      // Step 3: Check for duplicate LSX (productionOrder) values in Firebase
      console.log('Step 3: Checking for duplicate LSX in Firebase...');
      this.importProgress = 30;
      
      // Extract all LSX values from the imported data
      const importedLSX = workOrders.map(wo => wo.productionOrder).filter(lsx => lsx);
      console.log('📋 LSX values to check:', importedLSX);
      
      // Check against Firebase for existing LSX
      const lsxCheck = await this.checkExistingLSXInFirebase(importedLSX);
      
      console.log('📊 Firebase LSX Check Results:');
      console.log('  - Existing in Firebase:', lsxCheck.existing);
      console.log('  - New (not in Firebase):', lsxCheck.new);
      console.log('  - Total imported LSX:', importedLSX.length);
      console.log('  - Already exist:', lsxCheck.existing.length);
      console.log('  - New:', lsxCheck.new.length);
      
      // Filter work orders based on Firebase check
      const validWorkOrders: Partial<WorkOrder>[] = [];
      const duplicates: string[] = [];
      
      for (const workOrder of workOrders) {
        if (workOrder.productionOrder && lsxCheck.existing.includes(workOrder.productionOrder)) {
          duplicates.push(workOrder.productionOrder);
          console.warn(`⚠️ LSX already exists in Firebase: ${workOrder.productionOrder}`);
        } else {
          validWorkOrders.push(workOrder);
        }
      }

      if (duplicates.length > 0) {
        const duplicateMessage = `⚠️ Tìm thấy ${duplicates.length} LSX đã tồn tại trong Firebase:\n${duplicates.join(', ')}\n\nChỉ import ${validWorkOrders.length} work orders mới.`;
        console.warn(duplicateMessage);
        // Don't show alert here, let the bulk insert handle it
      }

      // Validate data before saving
      if (validWorkOrders.length === 0) {
        throw new Error('No valid data found in Excel file (all LSX already exist in Firebase)');
      }

      // Step 4: Bulk insert
      console.log('Step 4: Starting bulk insert...');
      this.importProgress = 40;
      const results = await this.bulkInsertWorkOrders(validWorkOrders);
      
      // Step 5: Complete
      console.log('Step 5: Import completed');
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

      // Show duplicate LSX warning if any
      if (duplicates.length > 0) {
        const duplicateMessage = `⚠️ Tìm thấy ${duplicates.length} LSX đã tồn tại trong Firebase:\n${duplicates.join(', ')}\n\nChỉ import ${validWorkOrders.length} work orders mới.`;
        alert(duplicateMessage);
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

        // Validate required fields with updated indices (Factory is now first column)
        if (!row[4] || row[4].toString().trim() === '') { // P/N is required (now at index 4)
          errors.push(`Row ${i + 1}: Product Code (P/N) is required`);
          continue;
        }
        if (!row[5] || row[5].toString().trim() === '') { // Work Order is required (now at index 5)
          errors.push(`Row ${i + 1}: Work Order is required`);
          continue;
        }
        
        // More lenient quantity check
        const quantityValue = row[6];
        const quantity = parseInt(quantityValue);
        if (!quantityValue || isNaN(quantity) || quantity <= 0) { // Quantity is required and must be positive number
          errors.push(`Row ${i + 1}: Valid positive quantity is required (got: ${quantityValue})`);
          continue;
        }
        
        if (!row[7] || row[7].toString().trim() === '') { // Customer is required (now at index 7)
          errors.push(`Row ${i + 1}: Customer is required`);
          continue;
        }
        if (!row[10] || row[10].toString().trim() === '') { // Line is required (now at index 10)
          errors.push(`Row ${i + 1}: Production Line is required`);
          continue;
        }

        // Parse factory from Excel (first column in template)
        let factory = this.selectedFactory; // Default to selected factory
        if (row[0] && row[0].toString().trim()) { // Factory is in first column (index 0)
          const factoryValue = row[0].toString().trim();
          // Validate factory value
          const validFactories = ['ASM1', 'ASM2', 'Sample 1', 'Sample 2'];
          if (validFactories.includes(factoryValue)) {
            factory = factoryValue;
            console.log(`Row ${i + 1}: Factory set to ${factory}`);
          } else {
            console.warn(`Row ${i + 1}: Invalid factory value "${factoryValue}", using default ${this.selectedFactory}`);
          }
        } else {
          console.log(`Row ${i + 1}: No factory specified, using default ${this.selectedFactory}`);
        }

        const workOrder: Partial<WorkOrder> = {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          factory: factory, // Use parsed factory value
          orderNumber: '', // Will be auto-assigned based on delivery date sequence
          productCode: row[4].toString().trim(), // P/N (now at index 4)
          productionOrder: row[5].toString().trim(), // Work Order (now at index 5)
          quantity: quantity, // Use the validated quantity (from index 6)
          customer: row[7].toString().trim(), // Customer (now at index 7)
          deliveryDate: undefined, // Sẽ gán bên dưới
          productionLine: row[10].toString().trim(), // Line (now at index 10)
          status: WorkOrderStatus.WAITING,
          createdBy: 'Excel Import', // Set import source
          checkedBy: '', // Will be set on web
          planReceivedDate: undefined, // Sẽ gán bên dưới
          notes: 'Imported from Excel', // Set import note
          createdDate: new Date(),
          lastUpdated: new Date()
        };

        // Parse and log Delivery Date
        const deliveryRaw = row[9]; // Delivery Date is now at index 9
        const deliveryParsed = this.parseExcelDate(deliveryRaw);
        if (!deliveryParsed || isNaN(deliveryParsed.getTime())) {
          console.warn(`Row ${i + 1}: Delivery Date parse failed! Raw value:`, deliveryRaw, 'Parsed:', deliveryParsed);
        } else {
          console.log(`Row ${i + 1}: Delivery Date OK. Raw:`, deliveryRaw, 'Parsed:', deliveryParsed);
        }
        workOrder.deliveryDate = deliveryParsed;

        // Parse and log Plan Received Date
        const planRaw = row[15]; // Plan Received Date is now at index 15
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
    
    // Create template data with Factory as first column
    const templateData = [
      ['Nhà Máy', 'Năm', 'Tháng', 'STT', 'Mã TP VN', 'LSX', 'Lượng sản phẩm', 'Khách hàng', 'Gấp', 'Ngày Giao NVL', 'Line', 'NVL thiếu', 'Người soạn', 'Tình trạng', 'Đủ/Thiếu', 'Ngày nhận thông tin', 'Ghi Chú'],
      ['ASM1', 2024, 12, 'WO001', 'P/N001', 'PO2024001', 100, 'Khách hàng A', 'Gấp', '31/12/2024', 'Line 1', 'NVL A, NVL B', 'Hoàng Tuấn', 'Waiting', 'Đủ', '01/12/2024', 'Ghi chú mẫu'],
      ['ASM2', 2024, 12, 'WO002', 'P/N002', 'PO2024002', 50, 'Khách hàng B', '', '15/12/2024', 'Line 2', '', 'Hữu Tình', 'Ready', 'Thiếu', '01/12/2024', ''],
      ['ASM1', 2024, 12, 'WO003', 'P/N003', 'PO2024003', 75, 'Khách hàng C', '', '20/12/2024', 'Line 3', 'NVL C', 'Hoàng Vũ', 'Done', 'Đủ', '01/12/2024', 'Hoàn thành']
    ];
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    const columnWidths = [
      { wch: 10 }, // Nhà Máy
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

  async deleteSelectedWorkOrders(): Promise<void> {
    if (this.selectedWorkOrders.length === 0) {
      alert('⚠️ No work orders selected for deletion.');
      return;
    }

    await this.deleteMultipleWorkOrders(this.selectedWorkOrders);
    
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
          factory: row[0]?.toString() || this.selectedFactory, // First column is factory (ASM1/ASM2)
          year: row[1] ? parseInt(row[1].toString()) : new Date().getFullYear(),
          month: row[2] ? parseInt(row[2].toString()) : new Date().getMonth() + 1,
          orderNumber: row[3]?.toString() || '',
          productCode: row[4]?.toString() || '',
          productionOrder: row[5]?.toString() || '',
          quantity: row[6] ? parseInt(row[6].toString()) : 0,
          customer: row[7]?.toString() || '',
          isUrgent: row[8]?.toString().toLowerCase() === 'gấp' || row[8]?.toString().toLowerCase() === 'urgent',
          deliveryDate: this.parseExcelDate(row[9]) || new Date(),
          productionLine: row[10]?.toString() || '',
          missingMaterials: row[11]?.toString() || '',
          createdBy: row[12]?.toString() || '',
          status: this.parseStatus(row[13]) || WorkOrderStatus.WAITING,
          materialsComplete: row[14]?.toString().toLowerCase() === 'đủ' || row[14]?.toString().toLowerCase() === 'complete',
          planReceivedDate: this.parseExcelDate(row[15]) || new Date(),
          notes: row[16]?.toString() || '',
          createdDate: new Date(),
          lastUpdated: new Date()
        } as WorkOrder));

      console.log('📋 Processed new work order data:', newWorkOrderData.length, 'items');

      // Check for duplicate LSX (productionOrder) values
      const existingLSX = this.workOrders.map(wo => wo.productionOrder).filter(lsx => lsx);
      const duplicates: string[] = [];
      const validWorkOrders: WorkOrder[] = [];

      for (const workOrder of newWorkOrderData) {
        if (workOrder.productionOrder && existingLSX.includes(workOrder.productionOrder)) {
          duplicates.push(workOrder.productionOrder);
          console.warn(`⚠️ Duplicate LSX found: ${workOrder.productionOrder}`);
        } else {
          validWorkOrders.push(workOrder);
          // Add to existing LSX list to prevent duplicates within the import batch
          existingLSX.push(workOrder.productionOrder);
        }
      }

      if (duplicates.length > 0) {
        const duplicateMessage = `⚠️ Tìm thấy ${duplicates.length} LSX trùng lặp:\n${duplicates.join(', ')}\n\nChỉ import ${validWorkOrders.length} work orders không trùng lặp.`;
        alert(duplicateMessage);
      }

      // Validate data before saving
      if (validWorkOrders.length === 0) {
        throw new Error('No valid data found in Excel file (all LSX are duplicates)');
      }

      // Save each work order individually to ensure proper saving
      this.saveWorkOrdersIndividually(validWorkOrders);
      
    } catch (error) {
      console.error('❌ Error processing Excel data:', error);
      alert(`❌ Lỗi khi xử lý dữ liệu Excel:\n${error.message || error}`);
      this.isLoading = false;
    } finally {
      // Always reset isLoading to false, regardless of success or error
      this.isLoading = false;
    }
  }

  private async saveWorkOrdersIndividually(workOrders: WorkOrder[]): Promise<void> {
    console.log('🔥 Saving work orders individually to Firebase...');
    this.isSaving = true;
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < workOrders.length; i++) {
      const workOrder = workOrders[i];
      try {
        await this.addWorkOrderDirect(workOrder);
        successCount++;
        console.log(`✅ Saved work order ${i + 1}/${workOrders.length}:`, workOrder.productCode);
      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to save work order ${i + 1}/${workOrders.length}:`, error);
      }
    }
    
    this.isSaving = false;
    this.isLoading = false; // Reset isLoading after saving is complete
    
    if (successCount > 0) {
      this.firebaseSaved = true;
      console.log(`✅ Successfully saved ${successCount} work orders to Firebase`);
      alert(`✅ Đã lưu thành công ${successCount} work orders vào Firebase!${errorCount > 0 ? `\n❌ ${errorCount} work orders không thể lưu.` : ''}`);
      
      // Reload data to show the new work orders
      this.loadWorkOrders();
    } else {
      this.firebaseSaved = false;
      console.error('❌ Failed to save any work orders');
      alert('❌ Không thể lưu work orders nào vào Firebase!');
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
    const savePromise = this.firestore.collection('work-orders').add(workOrderDoc);
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

  // Check if user has delete permission
  async loadDeletePermission(): Promise<void> {
    try {
      const user = await this.afAuth.currentUser;
      if (!user) {
        console.log('❌ No authenticated user found');
        this.hasDeletePermissionValue = false;
        this.hasCompletePermissionValue = false;
        return;
      }

      // Get user permission from Firebase
      const userPermission = await firstValueFrom(this.userPermissionService.getUserPermission(user.uid));
      if (!userPermission) {
        console.log('❌ No user permission found for user:', user.uid);
        this.hasDeletePermissionValue = false;
        this.hasCompletePermissionValue = false;
        return;
      }

      // Check if user has delete and complete permissions
      this.hasDeletePermissionValue = userPermission.hasDeletePermission;
      this.hasCompletePermissionValue = userPermission.hasCompletePermission;
      console.log('🔐 User permissions - delete:', this.hasDeletePermissionValue, 'complete:', this.hasCompletePermissionValue);
    } catch (error) {
      console.error('❌ Error loading permissions:', error);
      this.hasDeletePermissionValue = false;
      this.hasCompletePermissionValue = false;
    }
  }

  async hasDeletePermission(): Promise<boolean> {
    try {
      const user = await this.afAuth.currentUser;
      if (!user) {
        console.log('❌ No authenticated user found');
        return false;
      }

      // Get user permission from Firebase
      const userPermission = await firstValueFrom(this.userPermissionService.getUserPermission(user.uid));
      if (!userPermission) {
        console.log('❌ No user permission found for user:', user.uid);
        return false;
      }

      // Check if user has delete permission
      const hasPermission = userPermission.hasDeletePermission;
      console.log('🔐 User delete permission:', hasPermission);
      return hasPermission;
    } catch (error) {
      console.error('❌ Error checking delete permission:', error);
      return false;
    }
  }

  async hasCompletePermission(): Promise<boolean> {
    try {
      const user = await this.afAuth.currentUser;
      if (!user) {
        console.log('❌ No authenticated user found');
        return false;
      }

      // Get user permission from Firebase
      const userPermission = await firstValueFrom(this.userPermissionService.getUserPermission(user.uid));
      if (!userPermission) {
        console.log('❌ No user permission found for user:', user.uid);
        return false;
      }

      // Check if user has complete permission
      const hasPermission = userPermission.hasCompletePermission;
      console.log('🔐 User complete permission:', hasPermission);
      return hasPermission;
    } catch (error) {
      console.error('❌ Error checking complete permission:', error);
      return false;
    }
  }

  // Load user department information
  async loadUserDepartment(): Promise<void> {
    try {
      const user = await this.afAuth.currentUser;
      if (user) {
        // Get user department from user-permissions collection
        const userPermissionDoc = await this.firestore.collection('user-permissions').doc(user.uid).get().toPromise();
        if (userPermissionDoc && userPermissionDoc.exists) {
          const userData = userPermissionDoc.data() as any;
          this.currentUserDepartment = userData.department || '';
          console.log('👤 Current user department:', this.currentUserDepartment);
        }
      }
    } catch (error) {
      console.error('❌ Error loading user department:', error);
    }
  }

  // Check if current user is QA department
  isQADepartment(): boolean {
    return this.currentUserDepartment === 'QA';
  }

  // Check if user can edit (QA cannot edit anything in Work Order)
  canEdit(): boolean {
    return !this.isQADepartment();
  }



  // Preview items to be deleted
  previewDeleteItems(): void {
    if (!this.deleteStartDate || !this.deleteEndDate) {
      alert('Vui lòng chọn khoảng thời gian!');
      return;
    }

    const startDate = new Date(this.deleteStartDate);
    const endDate = new Date(this.deleteEndDate);
    endDate.setHours(23, 59, 59, 999); // Include the entire end date

    this.deletePreviewItems = this.workOrders.filter(wo => {
      const createdDate = new Date(wo.createdDate);
      const matchesTimeRange = createdDate >= startDate && createdDate <= endDate;
      const matchesFactory = !this.deleteFactoryFilter || wo.factory === this.deleteFactoryFilter;
      
      return matchesTimeRange && matchesFactory;
    });

    console.log(`🔍 Preview: Found ${this.deletePreviewItems.length} work orders to delete`);
  }

  // Delete work orders by time range
  async deleteWorkOrdersByTimeRange(): Promise<void> {
    const hasPermission = await this.hasDeletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền xóa dữ liệu! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }

    if (this.deletePreviewItems.length === 0) {
      alert('❌ Không có work orders nào để xóa!');
      return;
    }

    const confirmMessage = `⚠️ Bạn có chắc chắn muốn xóa ${this.deletePreviewItems.length} work orders?\n\nThao tác này không thể hoàn tác!`;
    if (!confirm(confirmMessage)) {
      return;
    }

    this.isDeleting = true;
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const workOrder of this.deletePreviewItems) {
        try {
          if (workOrder.id) {
            await this.deleteWorkOrderWithFallback(workOrder.id, workOrder);
            successCount++;
            console.log(`✅ Deleted work order: ${workOrder.orderNumber}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`❌ Failed to delete work order ${workOrder.orderNumber}:`, error);
        }
      }

      // Refresh the work orders list
      await this.loadWorkOrders();

      // Show result
      const message = `✅ Đã xóa thành công ${successCount} work orders!${errorCount > 0 ? `\n❌ ${errorCount} work orders không thể xóa.` : ''}`;
      alert(message);

      // Close dialog and reset
      this.showDeleteDialog = false;
      this.deletePreviewItems = [];

    } catch (error) {
      console.error('❌ Error during bulk delete:', error);
      alert(`❌ Lỗi khi xóa work orders: ${error.message || error}`);
    } finally {
      this.isDeleting = false;
    }
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
      case 'transfer':
      case 'chuyển':
        return WorkOrderStatus.TRANSFER;
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

  // New methods for the updated UI
  async completeWorkOrder(workOrder: WorkOrder): Promise<void> {
    console.log('🔄 Bắt đầu hoàn thành work order:', workOrder.productCode, 'ID:', workOrder.id);
    
    // Kiểm tra quyền hoàn thành
    const hasPermission = await this.hasCompletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền hoàn thành Work Order! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }
    
    workOrder.status = WorkOrderStatus.DONE;
    // Remove urgent status when completed
    workOrder.isUrgent = false;
    this.updateWorkOrderStatus(workOrder, WorkOrderStatus.DONE);
    this.updateWorkOrder(workOrder, 'isUrgent', false);
    
    // Re-apply filters to hide completed work order
    this.applyFilters();
    this.calculateSummary();
    console.log('✅ Hoàn thành work order:', workOrder.productCode, '- Đã ẩn khỏi danh sách');
  }

  showAllWorkOrders(): void {
    this.showHiddenWorkOrders = !this.showHiddenWorkOrders;
    
    if (this.showHiddenWorkOrders) {
      // Show all work orders including completed ones for selected factory
      this.filteredWorkOrders = this.workOrders.filter(wo => wo.factory === this.selectedFactory);
      console.log(`👁️ Hiển thị tất cả work orders của nhà máy ${this.selectedFactory} (bao gồm đã hoàn thành)`);
    } else {
      // Show only non-completed work orders for selected factory
      this.filteredWorkOrders = this.workOrders.filter(wo => wo.status !== WorkOrderStatus.DONE && wo.factory === this.selectedFactory);
      console.log(`👁️ Chỉ hiển thị work orders chưa hoàn thành của nhà máy ${this.selectedFactory}`);
    }
    
    this.calculateSummary();
  }



  getStatusText(status: WorkOrderStatus): string {
    const statusMap: { [key: string]: string } = {
      'waiting': 'Waiting',
      'kitting': 'Kitting',
      'ready': 'Ready',
      'transfer': 'Transfer',
      'done': 'Done',
      'delay': 'Delay'
    };
    return statusMap[status] || 'Waiting';
  }

  getStatusBadgeClass(status: WorkOrderStatus): string {
    const statusClassMap: { [key: string]: string } = {
      'waiting': 'badge badge-warning',
      'kitting': 'badge badge-info',
      'ready': 'badge badge-primary',
      'transfer': 'badge badge-secondary',
      'done': 'badge badge-success',
      'delay': 'badge badge-danger'
    };
    return statusClassMap[status] || 'badge badge-warning';
  }

  toggleUrgent(workOrder: WorkOrder): void {
    workOrder.isUrgent = !workOrder.isUrgent;
    this.updateWorkOrder(workOrder, 'isUrgent', workOrder.isUrgent);
    
    if (workOrder.isUrgent) {
      console.log('🔥 Đánh dấu gấp cho work order:', workOrder.productCode);
    } else {
      console.log('✅ Bỏ đánh dấu gấp cho work order:', workOrder.productCode);
    }
    
    // Re-apply filters to re-sort the list with urgent items at the top
    this.applyFilters();
    this.calculateSummary();
  }

  exportWorkOrdersByTimeRange(): void {
    const startDateStr = this.startDate ? this.startDate.toISOString().split('T')[0] : '';
    const endDateStr = this.endDate ? this.endDate.toISOString().split('T')[0] : '';
    
    if (!startDateStr || !endDateStr) {
      alert('❌ Vui lòng chọn khoảng thời gian!');
      return;
    }
    
    // Filter work orders by date range and selected factory
    const filteredByDateAndFactory = this.workOrders.filter(wo => {
      const deliveryDate = wo.deliveryDate ? new Date(wo.deliveryDate) : null;
      const planDate = wo.planReceivedDate ? new Date(wo.planReceivedDate) : null;
      
      if (!deliveryDate && !planDate) return false;
      
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      
      const isInDateRange = (deliveryDate && deliveryDate >= start && deliveryDate <= end) ||
                           (planDate && planDate >= start && planDate <= end);
      
      const isFromSelectedFactory = wo.factory === this.selectedFactory;
      
      return isInDateRange && isFromSelectedFactory;
    });
    
    if (filteredByDateAndFactory.length === 0) {
      alert(`❌ Không có work orders nào của nhà máy ${this.selectedFactory} trong khoảng thời gian đã chọn!`);
      return;
    }
    
    // Export to CSV with English headers
    this.exportToCSVWithDataEnglish(filteredByDateAndFactory, `work-orders-${this.selectedFactory}-${startDateStr}-to-${endDateStr}`);
    
    console.log(`📊 Xuất ${filteredByDateAndFactory.length} work orders của nhà máy ${this.selectedFactory} từ ${startDateStr} đến ${endDateStr}`);
  }

  private exportToCSVWithData(data: WorkOrder[], filename: string): void {
    const headers = [
      'Năm', 'Tháng', 'STT', 'Mã TP VN LSX', 'Lượng', 'Khách hàng', 'Gấp',
      'Ngày Giao Line', 'NVL thiếu', 'Người soạn', 'Tình trạng', 'Đủ/Thiếu',
      'Ngày nhận thông tin', 'Ghi Chú'
    ];
    
    const csvData = data.map((wo, index) => [
      wo.year,
      wo.month,
      index + 1,
      `${wo.productCode || ''} ${wo.productionOrder || ''}`.trim(),
      wo.quantity,
      wo.customer,
      wo.isUrgent ? 'Có' : 'Không',
      wo.deliveryDate ? new Date(wo.deliveryDate).toLocaleDateString('vi-VN') : '',
      wo.missingMaterials || '',
      wo.createdBy || '',
      this.getStatusText(wo.status || WorkOrderStatus.WAITING),
      wo.materialsStatus === 'sufficient' ? 'Đủ' : wo.materialsStatus === 'insufficient' ? 'Thiếu' : '',
      wo.planReceivedDate ? new Date(wo.planReceivedDate).toLocaleDateString('vi-VN') : '',
      wo.notes || ''
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    console.log(`✅ Đã xuất ${data.length} work orders thành file CSV`);
  }

  private exportToCSVWithDataEnglish(data: WorkOrder[], filename: string): void {
    const headers = [
      'Year', 'Month', 'Order No', 'Product Code VN LSX', 'Quantity', 'Customer', 'Urgent',
      'Material Delivery Date', 'Missing Materials', 'Creator', 'Status', 'Sufficient/Insufficient',
      'Plan Received Date', 'Notes'
    ];
    
    const csvData = data.map((wo, index) => [
      wo.year,
      wo.month,
      index + 1,
      `${wo.productCode || ''} ${wo.productionOrder || ''}`.trim(),
      wo.quantity,
      wo.customer,
      wo.isUrgent ? 'Yes' : 'No',
      wo.deliveryDate ? new Date(wo.deliveryDate).toLocaleDateString('en-US') : '',
      wo.missingMaterials || '',
      wo.createdBy || '',
      this.getStatusTextEnglish(wo.status || WorkOrderStatus.WAITING),
      wo.materialsStatus === 'sufficient' ? 'Sufficient' : wo.materialsStatus === 'insufficient' ? 'Insufficient' : '',
      wo.planReceivedDate ? new Date(wo.planReceivedDate).toLocaleDateString('en-US') : '',
      wo.notes || ''
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    console.log(`✅ Đã xuất ${data.length} work orders thành file CSV (English)`);
  }

  private getStatusTextEnglish(status: WorkOrderStatus): string {
    const statusMap: { [key: string]: string } = {
      'waiting': 'Waiting',
      'kitting': 'Kitting',
      'ready': 'Ready',
      'transfer': 'Transfer',
      'done': 'Done',
      'delay': 'Delay'
    };
    return statusMap[status] || 'Waiting';
  }

  private async checkExistingLSXInFirebase(lsxValues: string[]): Promise<{ existing: string[], new: string[] }> {
    console.log('🔍 Checking existing LSX in Firebase for:', lsxValues);
    
    try {
      // Get all existing work orders from Firebase
      const existingWorkOrders = await this.loadAllWorkOrdersFromFirebase();
      const existingLSX = existingWorkOrders.map(wo => wo.productionOrder).filter(lsx => lsx);
      
      console.log('📊 Found existing LSX in Firebase:', existingLSX);
      
      const existing: string[] = [];
      const newLSX: string[] = [];
      
      for (const lsx of lsxValues) {
        if (existingLSX.includes(lsx)) {
          existing.push(lsx);
          console.warn(`⚠️ LSX already exists in Firebase: ${lsx}`);
        } else {
          newLSX.push(lsx);
          console.log(`✅ LSX is new: ${lsx}`);
        }
      }
      
      console.log(`📊 LSX Check Results:
        - Total checked: ${lsxValues.length}
        - Already exist: ${existing.length}
        - New: ${newLSX.length}`);
      
      return { existing, new: newLSX };
    } catch (error) {
      console.error('❌ Error checking existing LSX in Firebase:', error);
      // If we can't check Firebase, assume all are new to be safe
      return { existing: [], new: lsxValues };
    }
  }

  private async loadAllWorkOrdersFromFirebase(): Promise<WorkOrder[]> {
    console.log('🔄 Loading all work orders from Firebase for LSX check...');
    
    try {
      // Try Firebase v9 SDK first
      const app = initializeApp(environment.firebase);
      const db = getFirestore(app);
      const querySnapshot = await getDocs(collection(db, 'work-orders'));
      
      const workOrders: WorkOrder[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data() as WorkOrder;
        workOrders.push({ id: doc.id, ...data });
      });
      
      console.log(`✅ Loaded ${workOrders.length} work orders from Firebase for LSX check`);
      return workOrders;
    } catch (error) {
      console.error('❌ Error loading work orders from Firebase for LSX check:', error);
      throw error;
    }
  }

  // Generate QR Code for Work Order
  generateQRCode(workOrder: WorkOrder): void {
    console.log('Generating QR code for work order:', workOrder.productionOrder);
    
    // Create QR code data with LSX information
    const qrData = `${workOrder.productionOrder}|${workOrder.productCode}|${workOrder.quantity}|${workOrder.customer}`;
    
    console.log('QR Code data:', qrData);
    
    // Generate QR code image
    QRCode.toDataURL(qrData, {
      width: 240, // 30mm = 240px (8px/mm)
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    }).then(qrImage => {
      // Show QR code dialog
      this.showQRCodeDialog(qrImage, workOrder, qrData);
    }).catch(error => {
      console.error('Error generating QR code:', error);
      alert('Lỗi khi tạo QR code!');
    });
  }

  // Show QR code dialog
  async showQRCodeDialog(qrImage: string, workOrder: WorkOrder, qrData: string): Promise<void> {
    try {
      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const printDate = new Date().toLocaleDateString('vi-VN');
      
      // Create print window with professional label layout
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title>QR Code LSX - ${workOrder.productionOrder}</title>
              <style>
                * {
                  margin: 0 !important;
                  padding: 0 !important;
                  box-sizing: border-box !important;
                }
                
                body { 
                  font-family: Arial, sans-serif; 
                  margin: 0 !important; 
                  padding: 0 !important;
                  background: white !important;
                  overflow: hidden !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                .qr-container { 
                  display: flex !important; 
                  margin: 0 !important; 
                  padding: 0 !important; 
                  border: 1px solid #000 !important; 
                  width: 57mm !important; 
                  height: 32mm !important; 
                  page-break-inside: avoid !important;
                  background: white !important;
                  box-sizing: border-box !important;
                }
                
                .qr-section {
                  width: 30mm !important;
                  height: 30mm !important;
                  display: flex !important;
                  align-items: center !important;
                  justify-content: center !important;
                  border-right: 1px solid #ccc !important;
                  box-sizing: border-box !important;
                }
                
                .qr-image {
                  width: 28mm !important;
                  height: 28mm !important;
                  display: block !important;
                }
                
                .info-section {
                  flex: 1 !important;
                  padding: 0.5mm !important;
                  display: flex !important;
                  flex-direction: column !important;
                  justify-content: space-between !important;
                  font-size: 6px !important;
                  line-height: 1.0 !important;
                  box-sizing: border-box !important;
                }
                
                .info-row {
                  margin: 0.2mm 0 !important;
                  font-weight: bold !important;
                  white-space: nowrap !important;
                  overflow: hidden !important;
                  text-overflow: ellipsis !important;
                }
                
                .info-row.small {
                  font-size: 5px !important;
                  color: #666 !important;
                  margin: 0.1mm 0 !important;
                }
                
                .qr-grid {
                  text-align: center !important;
                  display: flex !important;
                  flex-direction: row !important;
                  flex-wrap: wrap !important;
                  align-items: flex-start !important;
                  justify-content: flex-start !important;
                  gap: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                @media print {
                  body { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    overflow: hidden !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  @page {
                    margin: 0 !important;
                    size: 57mm 32mm !important;
                    padding: 0 !important;
                  }
                  
                  .qr-container { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                    page-break-inside: avoid !important;
                    border: 1px solid #000 !important;
                  }
                  
                  .qr-section {
                    width: 30mm !important;
                    height: 30mm !important;
                  }
                  
                  .qr-image {
                    width: 28mm !important;
                    height: 28mm !important;
                  }
                  
                  .info-section {
                    font-size: 6px !important;
                    padding: 0.5mm !important;
                  }
                  
                  .info-row {
                    margin: 0.2mm 0 !important;
                  }
                  
                  .info-row.small {
                    font-size: 5px !important;
                    margin: 0.1mm 0 !important;
                  }
                  
                  .qr-grid {
                    gap: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  /* Hide all browser elements */
                  @media screen {
                    body::before,
                    body::after,
                    header,
                    footer,
                    nav,
                    .browser-ui {
                      display: none !important;
                    }
                  }
                }
              </style>
            </head>
            <body>
              <div class="qr-grid">
                <div class="qr-container">
                  <div class="qr-section">
                    <img src="${qrImage}" class="qr-image" alt="QR Code LSX">
                  </div>
                  <div class="info-section">
                    <div>
                      <div class="info-row">LSX: ${workOrder.productionOrder}</div>
                      <div class="info-row">Mã TP: ${workOrder.productCode}</div>
                      <div class="info-row">Lượng: ${workOrder.quantity}</div>
                      <div class="info-row">KH: ${workOrder.customer}</div>
                    </div>
                    <div>
                      <div class="info-row small">Ngày in: ${printDate}</div>
                      <div class="info-row small">NV: ${currentUser}</div>
                    </div>
                  </div>
                </div>
              </div>
              <script>
                window.onload = function() {
                  // Remove all browser UI elements
                  document.title = '';
                  
                  // Hide browser elements
                  const style = document.createElement('style');
                  style.textContent = '@media print { body { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important; } @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; } body::before, body::after, header, footer, nav, .browser-ui { display: none !important; } }';
                  document.head.appendChild(style);
                  
                  // Remove any browser elements
                  const elementsToRemove = document.querySelectorAll('header, footer, nav, .browser-ui');
                  elementsToRemove.forEach(el => el.remove());
                  
                  setTimeout(() => {
                    window.print();
                  }, 500);
                }
              </script>
            </body>
          </html>
        `);
        newWindow.document.close();
      }
    } catch (error) {
      console.error('Error showing QR code dialog:', error);
      alert('Lỗi khi hiển thị QR code!');
    }
  }

  // Scan functionality methods
  openScanDialog(): void {
    console.log('🔍 Opening scan dialog...');
    this.showScanDialog = true;
    this.scanMode = 'camera'; // Default to camera mode
    this.scannedQRData = '';
    this.scanResult = '';
    this.isScanning = false;
    
    console.log('📷 Scan mode set to camera, waiting for DOM...');
    
    // Start camera after a short delay to ensure DOM is ready
    setTimeout(() => {
      console.log('📷 DOM ready, checking camera availability...');
      this.checkCameraAvailability().then(hasCamera => {
        if (hasCamera) {
          console.log('✅ Camera available, starting scanner...');
          this.startCameraScanner();
        } else {
          console.log('❌ Camera not available');
          this.scanResult = '❌ Không tìm thấy camera. Vui lòng kiểm tra quyền truy cập camera.';
        }
      });
    }, 200);
  }

  closeScanDialog(): void {
    this.showScanDialog = false;
    this.scannedQRData = '';
    this.scanResult = '';
    this.isScanning = false;
    this.stopCameraScanner();
  }

  setScanMode(mode: 'text' | 'camera'): void {
    // Stop current camera if switching modes
    if (this.scanMode === 'camera') {
      this.stopCameraScanner();
    }
    
    this.scanMode = mode;
    this.scannedQRData = '';
    this.scanResult = '';
    
    if (mode === 'camera') {
      // Check camera availability first
      this.checkCameraAvailability().then(hasCamera => {
        if (hasCamera) {
          // Small delay to ensure previous camera is stopped
          setTimeout(() => {
            this.startCameraScanner();
          }, 100);
        } else {
          this.scanResult = '❌ Không tìm thấy camera. Vui lòng kiểm tra quyền truy cập camera.';
        }
      });
    }
  }

  private async startCameraScanner(): Promise<void> {
    try {
      console.log('🔍 Starting camera scanner...');
      
      if (this.qrScanner) {
        this.stopCameraScanner();
      }

      // Check if element exists
      const qrReaderElement = document.getElementById('qr-reader');
      if (!qrReaderElement) {
        console.error('❌ QR reader element not found');
        this.scanResult = '❌ Lỗi: Không tìm thấy element camera. Vui lòng thử lại.';
        return;
      }

      console.log('✅ QR reader element found, initializing scanner...');
      this.qrScanner = new Html5Qrcode("qr-reader");
      
      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };

      this.scanResult = '📷 Đang khởi động camera...';
      console.log('📷 Starting camera with config:', config);

      await this.qrScanner.start(
        { facingMode: "environment" }, // Use back camera
        config,
        (decodedText: string) => {
          // Success callback
          console.log('✅ QR Code detected:', decodedText);
          this.scannedQRData = decodedText;
          this.scanResult = '✅ QR Code quét thành công! Nhấn "Scan QR Code" để xử lý.';
          this.stopCameraScanner();
        },
        (errorMessage: string) => {
          // Error callback - ignore errors during scanning
          console.log('📷 Camera scan error (ignored):', errorMessage);
        }
      );

      console.log('✅ Camera started successfully');
      this.scanResult = '📷 Camera đã sẵn sàng! Đặt QR code vào khung hình để quét.';
    } catch (error) {
      console.error('❌ Error starting camera scanner:', error);
      this.scanResult = '❌ Không thể khởi động camera. Vui lòng kiểm tra quyền truy cập camera và đảm bảo trình duyệt hỗ trợ.';
    }
  }

  private stopCameraScanner(): void {
    if (this.qrScanner) {
      try {
        this.qrScanner.stop().then(() => {
          this.qrScanner = null;
        }).catch((error: any) => {
          console.error('❌ Error stopping camera scanner:', error);
        });
      } catch (error) {
        console.error('❌ Error stopping camera scanner:', error);
      }
    }
  }

  private async checkCameraAvailability(): Promise<boolean> {
    try {
      console.log('🔍 Checking camera availability...');
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      console.log('📷 Found video devices:', videoDevices.length);
      console.log('📷 Video devices:', videoDevices);
      return videoDevices.length > 0;
    } catch (error) {
      console.error('❌ Error checking camera availability:', error);
      return false;
    }
  }

  async processScannedQRCode(qrData: string): Promise<void> {
    // Stop camera if in camera mode
    if (this.scanMode === 'camera') {
      this.stopCameraScanner();
    }

    if (!qrData || !qrData.trim()) {
      if (this.scanMode === 'camera') {
        this.scanResult = '❌ Vui lòng quét QR code bằng camera trước.';
      } else {
        this.scanResult = '❌ Vui lòng nhập hoặc quét QR code data.';
      }
      return;
    }

    try {
      this.isScanning = true;
      this.scanResult = 'Đang xử lý...';
      
      // Parse QR data to find LSX (Production Order)
      const lsxMatch = qrData.match(/LSX:\s*([^\s]+)/);
      if (!lsxMatch) {
        this.scanResult = '❌ QR code không hợp lệ. Không tìm thấy LSX.';
        return;
      }

      const lsx = lsxMatch[1];
      console.log('🔍 Tìm thấy LSX:', lsx);

      // Find work order by LSX
      const workOrder = this.workOrders.find(wo => wo.productionOrder === lsx);
      if (!workOrder) {
        this.scanResult = `❌ Không tìm thấy Work Order với LSX: ${lsx}`;
        return;
      }

      console.log('📋 Tìm thấy Work Order:', workOrder);

      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const scanTime = new Date();

      // Determine next status based on current status
      let newStatus: WorkOrderStatus;
      let statusDescription: string;

      switch (workOrder.status) {
        case WorkOrderStatus.WAITING:
          newStatus = WorkOrderStatus.KITTING;
          statusDescription = 'Kitting';
          break;
        case WorkOrderStatus.KITTING:
          newStatus = WorkOrderStatus.READY;
          statusDescription = 'Ready';
          break;
        case WorkOrderStatus.READY:
          newStatus = WorkOrderStatus.TRANSFER;
          statusDescription = 'Transfer';
          break;
        case WorkOrderStatus.TRANSFER:
          newStatus = WorkOrderStatus.DONE;
          statusDescription = 'Done';
          break;
        case WorkOrderStatus.DONE:
          this.scanResult = `✅ Work Order đã hoàn thành (Done). Không thể scan thêm.`;
          return;
        case WorkOrderStatus.DELAY:
          newStatus = WorkOrderStatus.KITTING;
          statusDescription = 'Kitting (từ Delay)';
          break;
        default:
          newStatus = WorkOrderStatus.KITTING;
          statusDescription = 'Kitting';
      }

      // Update work order status
      await this.updateWorkOrderStatus(workOrder, newStatus);

      // Log scan activity
      await this.logScanActivity(lsx, currentUser, scanTime, workOrder.status, newStatus);

      this.scanResult = `✅ Scan thành công!\nLSX: ${lsx}\nTrạng thái: ${workOrder.status} → ${statusDescription}\nNhân viên: ${currentUser}\nThời gian: ${scanTime.toLocaleString('vi-VN')}`;

      // Refresh work orders to show updated status
      this.loadWorkOrders();

    } catch (error) {
      console.error('❌ Lỗi khi xử lý QR code:', error);
      this.scanResult = `❌ Lỗi: ${error.message || error}`;
    } finally {
      this.isScanning = false;
    }
  }

  private async logScanActivity(lsx: string, userId: string, scanTime: Date, oldStatus: WorkOrderStatus, newStatus: WorkOrderStatus): Promise<void> {
    try {
      const scanLog = {
        lsx: lsx,
        userId: userId,
        scanTime: scanTime,
        oldStatus: oldStatus,
        newStatus: newStatus,
        timestamp: new Date()
      };

      // Save to Firestore
      const db = getFirestore();
      await addDoc(collection(db, 'scan_logs'), scanLog);
      
      console.log('📝 Đã lưu log scan:', scanLog);
    } catch (error) {
      console.error('❌ Lỗi khi lưu log scan:', error);
    }
  }
}
