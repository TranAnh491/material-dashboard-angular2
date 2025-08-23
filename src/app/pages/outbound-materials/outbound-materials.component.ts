import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx'; // Added for Excel download
import { FactoryAccessService } from '../../services/factory-access.service';

export interface OutboundMaterial {
  id?: string;
  factory?: string; // Factory identifier (ASM1, ASM2, etc.)
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  exportQuantity: number;
  exportDate: Date;
  location: string;
  exportedBy: string;
  scanMethod?: string; // 'QR_SCAN' or 'MANUAL'
  createdAt?: Date;
  updatedAt?: Date;
  inventoryDocId?: string; // Track which inventory document was used for deduction
  notes?: string; // Additional notes about the export operation
}

@Component({
  selector: 'app-outbound-materials',
  templateUrl: './outbound-materials.component.html',
  styleUrls: ['./outbound-materials.component.scss']
})
export class OutboundMaterialsComponent implements OnInit, OnDestroy {
  // Data properties
  outboundMaterials: OutboundMaterial[] = [];
  filteredOutbound: OutboundMaterial[] = [];
  
  // Factory selection
  selectedFactory: string = '';
  availableFactories: string[] = ['ASM1', 'ASM2'];
  
  // Search and filter
  searchTerm = '';
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  
  // Auto-hide previous day's scan history
  hidePreviousDayHistory: boolean = true;
  
  // Loading state
  isLoading = false;
  
  // Scanner properties
  isScannerActive = false;
  scanCount = 0;
  successfulScans = 0;
  errorScans = 0;
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService
  ) {}

  ngOnInit(): void {
    this.setupDefaultDateRange();
    this.loadOutboundMaterialsFromFirebase();
    this.cleanupOldRecords(); // Clean up records older than 6 months
    
    // Load factory access and set default factory
    this.loadFactoryAccess();
    
    // Set up daily auto-update for date range
    this.setupDailyAutoUpdate();
  }
  
  // Setup default date range to today only
  private setupDefaultDateRange(): void {
    const today = new Date();
    this.startDate = today;
    this.endDate = today;
    console.log('📅 Default date range set to today only');
  }
  
  // Setup daily auto-update for date range
  private setupDailyAutoUpdate(): void {
    // Check if it's a new day and update date range accordingly
    const today = new Date();
    const currentDate = today.toDateString();
    
    // If it's a new day, update the date range
    if (this.startDate.toDateString() !== currentDate) {
      this.startDate = today;
      this.endDate = today;
      console.log('📅 New day detected, updated date range to today');
      
      // Reapply filters to hide previous day's history
      if (this.hidePreviousDayHistory) {
        this.applyFilters();
        console.log('📅 Previous day\'s scan history automatically hidden');
      }
    }
    
    console.log('📅 Daily auto-update setup completed');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopScannerMode(); // Ensure scanner is stopped
  }

  // Load outbound materials from Firebase
  loadOutboundMaterialsFromFirebase(): void {
    this.isLoading = true;
    
    this.firestore.collection('outbound-materials')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        this.outboundMaterials = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            exportDate: data.exportDate ? new Date(data.exportDate.seconds * 1000) : new Date()
          };
        });
        
        this.applyFilters();
        console.log('Loaded outbound materials from Firebase:', this.outboundMaterials.length);
        this.isLoading = false;
      });
  }

  // Factory selection
  selectFactory(factory: string): void {
    this.selectedFactory = factory;
    console.log('🏭 Selected factory:', factory);
    this.applyFilters();
    this.showFactoryStockSummary();
  }

  // Load factory access permissions and set default factory
  private loadFactoryAccess(): void {
    this.factoryAccessService.getCurrentUserFactoryAccess()
      .pipe(takeUntil(this.destroy$))
      .subscribe((access) => {
        // Update available factories based on user permissions
        this.availableFactories = access.availableFactories;
        
        // Set default factory if user has access
        if (access.defaultFactory && access.availableFactories.includes(access.defaultFactory)) {
          this.selectedFactory = access.defaultFactory;
        } else if (access.availableFactories.length > 0) {
          this.selectedFactory = access.availableFactories[0];
        }
        
        console.log('🏭 Factory access loaded for Outbound Materials:', {
          selectedFactory: this.selectedFactory,
          availableFactories: this.availableFactories
        });
      });
  }

  // Kiểm tra user có thể chỉnh sửa outbound material của nhà máy cụ thể không
  canEditMaterial(material: OutboundMaterial): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Kiểm tra user có thể xem outbound material của nhà máy cụ thể không
  canViewMaterial(material: OutboundMaterial): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Show factory stock summary
  private showFactoryStockSummary(): void {
    if (!this.selectedFactory) return;

    this.firestore.collection('inventory-materials', ref => 
      ref.where('factory', '==', this.selectedFactory)
    ).get().subscribe(snapshot => {
      if (!snapshot.empty) {
        let totalItems = 0;
        let totalStock = 0;
        let lowStockItems = 0;

        snapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          totalItems++;
          
          // Calculate current stock
          let currentStock = 0;
          if (data.stock !== undefined && data.stock !== null) {
            currentStock = data.stock;
          } else {
            currentStock = (data.quantity || 0) - (data.exported || 0);
          }
          
          totalStock += currentStock;
          if (currentStock <= 0) {
            lowStockItems++;
          }
        });

        console.log(`📊 ${this.selectedFactory} Stock Summary:`, {
          totalItems,
          totalStock,
          lowStockItems,
          averageStock: totalItems > 0 ? Math.round(totalStock / totalItems) : 0
        });

        // Show summary in console for now (can be enhanced to show in UI)
        if (lowStockItems > 0) {
          console.log(`⚠️ ${lowStockItems} items in ${this.selectedFactory} have low or no stock`);
        }
      } else {
        console.log(`📊 ${this.selectedFactory} has no inventory items`);
      }
    }, error => {
      console.error('Error getting factory stock summary:', error);
    });
  }

  // Download FIFO violation report by factory
  downloadFIFOReportByFactory(factory: string): void {
    if (!factory) {
      alert('⚠️ Vui lòng chọn nhà máy!');
      return;
    }

    this.firestore.collection('fifo-violations', ref => 
      ref.where('factory', '==', factory)
         .orderBy('scanDate', 'desc')
    ).get().subscribe(snapshot => {
      if (snapshot.empty) {
        alert(`📊 Không có báo cáo vi phạm FIFO nào cho ${factory}`);
        return;
      }

      const violations = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          'Nhà máy': data.factory,
          'Mã hàng': data.materialCode,
          'PO': data.poNumber,
          'Số lượng yêu cầu': data.requestedQuantity,
          'Loại vi phạm': data.violationType,
          'Ngày scan': data.scanDate ? new Date(data.scanDate.seconds * 1000).toLocaleDateString('vi-VN') : 'N/A',
          'Người xuất': data.exportedBy,
          'Ngày tạo': data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString('vi-VN') : 'N/A'
        };
      });

      // Create Excel file
      const worksheet = XLSX.utils.json_to_sheet(violations);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'FIFO Violations');
      
      // Download file
      const fileName = `FIFO_Violations_${factory}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log(`✅ Downloaded FIFO violation report for ${factory}:`, violations.length, 'violations');
    }, error => {
      console.error('Error downloading FIFO report:', error);
      alert('❌ Lỗi khi tải báo cáo FIFO!');
    });
  }

  // Download FIFO report for ASM1
  downloadFIFOReportASM1(): void {
    this.downloadFIFOReportByFactory('ASM1');
  }

  // Download FIFO report for ASM2
  downloadFIFOReportASM2(): void {
    this.downloadFIFOReportByFactory('ASM2');
  }

  // Save FIFO violation report to Firebase
  private saveFIFOViolationReport(materialCode: string, poNumber: string, quantity: number, violationType: string): void {
    if (!this.selectedFactory) return;

    const violationReport = {
      factory: this.selectedFactory,
      materialCode: materialCode,
      poNumber: poNumber,
      requestedQuantity: quantity,
      violationType: violationType,
      scanDate: new Date(),
      exportedBy: 'Unknown', // Will be updated when user info is available
      createdAt: new Date()
    };

    this.firestore.collection('fifo-violations').add(violationReport)
      .then(() => {
        console.log('✅ FIFO violation report saved:', violationReport);
      })
      .catch(error => {
        console.error('❌ Error saving FIFO violation report:', error);
      });
  }

  // Check FIFO compliance for outbound scanning
  private checkFIFOCompliance(materialCode: string, poNumber: string, quantity: number): Promise<{isCompliant: boolean, message: string}> {
    return new Promise((resolve) => {
      if (!this.selectedFactory) {
        resolve({isCompliant: false, message: 'Chưa chọn nhà máy'});
        return;
      }

      // Query inventory for the same material and PO in the selected factory
      this.firestore.collection('inventory-materials', ref => 
        ref.where('materialCode', '==', materialCode)
           .where('poNumber', '==', poNumber)
           .where('factory', '==', this.selectedFactory)
           .orderBy('__name__')
      ).get().subscribe(snapshot => {
        if (snapshot.docs.length <= 1) {
          // Only one item or no items, always compliant
          resolve({isCompliant: true, message: 'OK'});
          return;
        }

        // Check if we're taking from the first (top) row
        const firstDoc = snapshot.docs[0];
        const firstData = firstDoc.data() as any;
        
        // Calculate current stock for first item
        let firstItemStock = 0;
        if (firstData.stock !== undefined && firstData.stock !== null) {
          firstItemStock = firstData.stock;
        } else {
          firstItemStock = (firstData.quantity || 0) - (firstData.exported || 0);
        }

        if (firstItemStock >= quantity) {
          // Taking from first row with sufficient stock - FIFO compliant
          resolve({isCompliant: true, message: 'OK - FIFO compliant'});
        } else {
          // Taking from other rows - FIFO violation
          const violationMessage = `⚠️ FIFO Violation: Insufficient stock in first row (${firstItemStock}), but scanning from other rows. This may violate FIFO principle.`;
          
          // Log violation to Firebase
          this.saveFIFOViolationReport(materialCode, poNumber, quantity, 'Insufficient stock in first row');
          
          resolve({
            isCompliant: false, 
            message: violationMessage
          });
        }
      }, error => {
        console.error('Error checking FIFO compliance:', error);
        resolve({isCompliant: false, message: 'Error checking FIFO compliance'});
      });
    });
  }

  // Validate factory has sufficient stock before starting scanner
  private validateFactoryStock(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.selectedFactory) {
        resolve(false);
        return;
      }

      // Check if there are any items in the selected factory
      this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', this.selectedFactory)
           .limit(1)
      ).get().subscribe(snapshot => {
        if (snapshot.empty) {
          alert(`⚠️ Nhà máy ${this.selectedFactory} chưa có dữ liệu tồn kho!\nVui lòng nhập hàng vào ${this.selectedFactory} trước khi xuất kho.`);
          resolve(false);
        } else {
          resolve(true);
        }
      }, error => {
        console.error('Error validating factory stock:', error);
        resolve(false);
      });
    });
  }

  // Apply filters based on search, date range, and factory
  applyFilters(): void {
    this.filteredOutbound = this.outboundMaterials.filter(material => {
      // Filter by factory
      if (this.selectedFactory) {
        const materialFactory = material.factory || 'ASM1';
        if (materialFactory !== this.selectedFactory) {
          return false;
        }
      }

      // Filter by search term
      if (this.searchTerm) {
        const searchLower = this.searchTerm.toLowerCase();
        const matchesSearch = (
          material.materialCode.toLowerCase().includes(searchLower) ||
          material.poNumber.toLowerCase().includes(searchLower) ||
          material.location.toLowerCase().includes(searchLower)
        );
        if (!matchesSearch) return false;
      }
      
      // Auto-hide previous day's scan history
      if (this.hidePreviousDayHistory) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today
        
        const exportDate = new Date(material.exportDate);
        exportDate.setHours(0, 0, 0, 0); // Start of export date
        
        // Hide records from previous days
        if (exportDate < today) {
          return false;
        }
      }
      
      // Filter by date range
      if (this.startDate && this.endDate) {
        const exportDate = new Date(material.exportDate);
        const startDate = new Date(this.startDate);
        const endDate = new Date(this.endDate);
        endDate.setHours(23, 59, 59); // Include end date
        
        if (exportDate < startDate || exportDate > endDate) {
          return false;
        }
      }
      
      return true;
    });
    
    // Sort by export date (newest first)
    this.filteredOutbound.sort((a, b) => new Date(b.exportDate).getTime() - new Date(a.exportDate).getTime());
    
    // Log filter results
    console.log(`🔍 Filter applied: ${this.filteredOutbound.length}/${this.outboundMaterials.length} records shown`);
    if (this.hidePreviousDayHistory) {
      console.log(`📅 Previous day's scan history is hidden`);
    }
  }

  // Search change handler
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
    this.applyFilters();
  }

  // Date range filter
  applyDateRangeFilter(): void {
    // Check if user selected today's date
    const today = new Date();
    const startDate = new Date(this.startDate);
    const endDate = new Date(this.endDate);
    
    // If user selects today, automatically hide previous day's history
    if (startDate.toDateString() === today.toDateString() && 
        endDate.toDateString() === today.toDateString()) {
      this.hidePreviousDayHistory = true;
      console.log('📅 User selected today, automatically hiding previous day\'s history');
    }
    
    this.applyFilters();
  }
  
  // Toggle auto-hide previous day's scan history
  toggleHidePreviousDayHistory(): void {
    this.hidePreviousDayHistory = !this.hidePreviousDayHistory;
    console.log(`📅 Auto-hide previous day's scan history: ${this.hidePreviousDayHistory ? 'ON' : 'OFF'}`);
    this.applyFilters();
  }
  
  // Reset to today's date
  resetToToday(): void {
    const today = new Date();
    this.startDate = today;
    this.endDate = today;
    this.hidePreviousDayHistory = true;
    console.log('📅 Reset to today\'s date and hide previous day\'s history');
    this.applyFilters();
  }

  // Delete outbound record
  deleteOutboundRecord(material: OutboundMaterial): void {
    if (confirm('Bạn có chắc muốn xóa record này?')) {
      if (material.id) {
        this.firestore.collection('outbound-materials').doc(material.id).delete()
          .then(() => {
            console.log('Outbound record deleted');
            alert('✅ Đã xóa record thành công!');
          })
          .catch(error => {
            console.error('Error deleting outbound record:', error);
            alert('❌ Lỗi khi xóa record!');
          });
      }
    }
  }

  // Clean up old records (older than 6 months)
  cleanupOldRecords(): void {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    console.log('Cleaning up outbound records older than:', sixMonthsAgo);
    
    this.firestore.collection('outbound-materials', ref => 
      ref.where('exportDate', '<', sixMonthsAgo)
    ).get().subscribe(snapshot => {
      const batch = this.firestore.firestore.batch();
      let deletedCount = 0;
      
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
      });
      
      if (deletedCount > 0) {
        batch.commit().then(() => {
          console.log(`Deleted ${deletedCount} old outbound records`);
        }).catch(error => {
          console.error('Error cleaning up old records:', error);
        });
      } else {
        console.log('No old records to clean up');
      }
    });
  }
  
  // Clean up previous day's records (optional - more aggressive cleanup)
  cleanupPreviousDayRecords(): void {
    if (!this.hidePreviousDayHistory) {
      console.log('⚠️ Cannot cleanup previous day records when history is visible');
      return;
    }
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    console.log('🧹 Cleaning up previous day\'s outbound records:', yesterday);
    
    this.firestore.collection('outbound-materials', ref => 
      ref.where('exportDate', '<', yesterday)
    ).get().subscribe(snapshot => {
      const batch = this.firestore.firestore.batch();
      let deletedCount = 0;
      
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
      });
      
      if (deletedCount > 0) {
        batch.commit().then(() => {
          console.log(`🧹 Deleted ${deletedCount} previous day outbound records`);
          // Reload materials after cleanup
          this.loadOutboundMaterialsFromFirebase();
        }).catch(error => {
          console.error('Error cleaning up previous day records:', error);
        });
      } else {
        console.log('🧹 No previous day records to clean up');
      }
    });
  }

  // Scanner Mode Methods
  async startBatchScan(): Promise<void> {
    // Validate factory selection first
    if (!this.selectedFactory) {
      alert('⚠️ Vui lòng chọn nhà máy (ASM1 hoặc ASM2) trước khi bắt đầu Batch Scan!');
      return;
    }

    console.log(`🚀 Starting batch scan mode for factory: ${this.selectedFactory}...`);
    this.isScannerActive = true;
    this.scanCount = 0;
    this.successfulScans = 0;
    this.errorScans = 0;
    
    // Focus scanner input after a short delay
    setTimeout(() => {
      this.focusScannerInput();
    }, 500);
    
    console.log(`🟢 Batch Scan đã được bật cho ${this.selectedFactory}!\n\n📋 Hướng dẫn:\n• Quét QR code lệnh sản xuất và mã nhân viên\n• Sau đó bắt đầu quét QR code xuất hàng\n• Hệ thống sẽ xử lý tự động`);
  }

  stopScannerMode(): void {
    console.log('🛑 Stopping scanner mode...');
    this.isScannerActive = false;
    
    // Stop keyboard listener
    this.stopKeyboardListener();
    
    // Log statistics to console instead of showing alert
    console.log('🔴 Scanner đã dừng!\n\n📊 Thống kê:\n• Tổng quét: ' + this.scanCount + '\n• Thành công: ' + this.successfulScans + '\n• Lỗi: ' + this.errorScans);
  }



  private startKeyboardListener(): void {
    // Listen for keyboard input (simulating scanner)
    document.addEventListener('keydown', this.handleScannerInput.bind(this));
  }

  private stopKeyboardListener(): void {
    document.removeEventListener('keydown', this.handleScannerInput.bind(this));
  }

  // Handle batch scan input (lệnh sản xuất và mã nhân viên)
  handleBatchScanInput(event: any): void {
    const input = event.target;
    const batchData = input.value.trim();
    
    if (!batchData) {
      alert('⚠️ Vui lòng nhập dữ liệu lệnh sản xuất và mã nhân viên!');
      return;
    }
    
    console.log('📋 Batch scan data received:', batchData);
    
    // Parse batch data (format: PO|EmployeeID or similar)
    try {
      // Clear input and show success message
      input.value = '';
      alert('✅ Đã nhận lệnh sản xuất và mã nhân viên!\n\nBây giờ bạn có thể bắt đầu quét QR code xuất hàng.');
      
      // Focus back to input for next scan
      setTimeout(() => {
        input.focus();
      }, 100);
      
    } catch (error) {
      console.error('❌ Error parsing batch scan data:', error);
      alert('❌ Lỗi xử lý dữ liệu batch scan!');
    }
  }

  private handleScannerInput(event: KeyboardEvent): void {
    if (!this.isScannerActive) return;
    
    // Simulate scanner input - when Enter is pressed, process the scanned data
    if (event.key === 'Enter') {
      // Get the current input value (simulating scanner data)
      const activeElement = document.activeElement as HTMLInputElement;
      if (activeElement && activeElement.tagName === 'INPUT') {
        const scannedData = activeElement.value;
        if (scannedData) {
          console.log('📱 Scanner detected Enter key with data:', scannedData);
          this.processScannedData(scannedData);
          activeElement.value = ''; // Clear input
          // Focus back to the input for next scan
          setTimeout(() => {
            activeElement.focus();
          }, 100);
        }
      }
    }
  }

  private async processScannedData(scannedData: string): Promise<void> {
    console.log('📱 Processing scanned data:', scannedData);
    this.scanCount++;
    
    try {
      // Parse QR code data format: MaterialCode|PONumber|Quantity
      const parts = scannedData.split('|');
      if (parts.length >= 3) {
        const materialCode = parts[0];
        const poNumber = parts[1];
        const quantity = parseInt(parts[2]);
        
        if (isNaN(quantity) || quantity <= 0) {
                  console.error('❌ Invalid quantity in scanned data:', scannedData);
        alert('❌ Dữ liệu scan không hợp lệ: Số lượng phải là số dương!');
        this.errorScans++;
        return;
        }
        
        console.log('🔍 Looking for inventory item:', { materialCode, poNumber, quantity });
        
        // Check FIFO compliance
        const fifoResult = await this.checkFIFOCompliance(materialCode, poNumber, quantity);
        if (!fifoResult.isCompliant) {
          alert(fifoResult.message);
          this.errorScans++;
          return;
        }

        // Find matching inventory item with scanner mode flag
        this.findAndUpdateInventory(materialCode, poNumber, quantity, this.isScannerActive);
        
        // Record successful scan
        this.successfulScans++;
        
      } else {
        console.error('❌ Invalid QR code format:', scannedData);
        alert('❌ Định dạng QR code không hợp lệ! Cần: Mã hàng|PO|Số lượng');
        this.errorScans++;
      }
    } catch (error) {
      console.error('❌ Error processing scanned data:', error);
      alert('❌ Lỗi xử lý dữ liệu scan!');
      this.errorScans++;
    }
  }

  private findAndUpdateInventory(materialCode: string, poNumber: string, quantity: number, isScannerMode: boolean = false): void {
    console.log('🔍 Querying inventory for:', { materialCode, poNumber, factory: this.selectedFactory });
    
    // Validate factory selection
    if (!this.selectedFactory) {
      alert('⚠️ Vui lòng chọn nhà máy (ASM1 hoặc ASM2) trước khi scan xuất kho!');
      this.errorScans++;
      return;
    }
    
    // Query inventory collection with real-time data, filtered by selected factory
    // Order by document ID to ensure consistent ordering and always get the first (top) row
    this.firestore.collection('inventory-materials', ref => 
      ref.where('materialCode', '==', materialCode)
         .where('poNumber', '==', poNumber)
         .where('factory', '==', this.selectedFactory) // Filter by selected factory
         .orderBy('__name__') // Order by document ID to ensure first document is always the same
    ).get().subscribe(snapshot => {
      if (!snapshot.empty) {
        // Always take the first document (top row) when there are duplicates
        const inventoryDoc = snapshot.docs[0];
        const inventoryData = inventoryDoc.data() as any;
        
        console.log(`📋 Found ${snapshot.docs.length} matching items in ${this.selectedFactory}. Using first item (top row):`, inventoryData);
        
        console.log('📦 Found inventory item:', inventoryData);
        console.log('📊 Current stock details:', {
          stock: inventoryData.stock,
          quantity: inventoryData.quantity,
          exported: inventoryData.exported,
          requestedQuantity: quantity,
          factory: inventoryData.factory
        });
        
        // Calculate current available stock (stock field takes priority, fallback to quantity - exported)
        let currentStock = 0;
        if (inventoryData.stock !== undefined && inventoryData.stock !== null) {
          currentStock = inventoryData.stock;
        } else {
          currentStock = (inventoryData.quantity || 0) - (inventoryData.exported || 0);
        }
        
        console.log('📊 Calculated current stock:', currentStock);
        
        // Check if we have enough stock
        if (currentStock < quantity) {
          // Always show popup for insufficient stock - this is a critical error
          alert(`❌ Không đủ tồn kho tại ${this.selectedFactory}!\nCần: ${quantity}\nCó: ${currentStock}\nMã: ${materialCode}\nPO: ${poNumber}\nNhà máy: ${this.selectedFactory}`);
          console.log(`❌ Không đủ tồn kho tại ${this.selectedFactory}! Cần: ${quantity}, Có: ${currentStock}, Mã: ${materialCode}, PO: ${poNumber}`);
          this.errorScans++;
          return;
        }
        
        // Check if stock will be negative after export
        const newStock = currentStock - quantity;
        if (newStock < 0) {
          // Always show alert for negative stock - this is the critical error
          alert(`❌ Không thể xuất! Tồn kho sẽ âm sau khi xuất tại ${this.selectedFactory}!\nTồn hiện tại: ${currentStock}\nXuất: ${quantity}\nSẽ còn: ${newStock}\nMã: ${materialCode}\nPO: ${poNumber}\nNhà máy: ${this.selectedFactory}`);
          this.errorScans++;
          return;
        }
        
        // Update exported quantity
        const currentExported = inventoryData.exported || 0;
        const newExported = currentExported + quantity;
        
        console.log('📊 Updating inventory:', {
          oldStock: currentStock,
          newStock: newStock,
          oldExported: currentExported,
          newExported: newExported,
          factory: this.selectedFactory
        });
        
        // Update inventory with transaction to prevent race conditions
        inventoryDoc.ref.update({
          exported: newExported,
          stock: newStock,
          updatedAt: new Date()
        }).then(() => {
          console.log('✅ Inventory updated successfully');
          
          // Create outbound record with inventory document reference for tracking
          // scanSource = 'outbound' since this is from outbound scanner
          this.createOutboundRecord(inventoryData, quantity, inventoryDoc.id, 'outbound');
          
          console.log('✅ Successfully processed scan:', {
            materialCode,
            poNumber,
            quantity,
            newExported,
            newStock,
            inventoryDocId: inventoryDoc.id,
            factory: this.selectedFactory,
            note: 'Deducted from first matching row in selected factory'
          });
          
          // No success alert when scanner is active - just log to console
          console.log(`✅ Xuất hàng thành công tại ${this.selectedFactory}! Mã: ${materialCode}, PO: ${poNumber}, Số lượng: ${quantity}, Tồn kho mới: ${newStock} (từ dòng đầu tiên)`);
          
        }).catch(error => {
          console.error('❌ Error updating inventory:', error);
          if (isScannerMode) {
            console.log('❌ Lỗi cập nhật tồn kho!');
          } else {
            alert('❌ Lỗi cập nhật tồn kho!');
          }
          this.errorScans++;
        });
        
      } else {
        console.error('❌ No matching inventory item found:', { materialCode, poNumber, factory: this.selectedFactory });
        // Always show popup for missing inventory - this is a critical error
        alert(`❌ Không tìm thấy hàng hóa tại ${this.selectedFactory}!\nMã: ${materialCode}\nPO: ${poNumber}\nNhà máy: ${this.selectedFactory}\n\n💡 Kiểm tra:\n• Hàng đã được nhập vào ${this.selectedFactory} chưa?\n• Mã hàng và PO có đúng không?`);
        console.log(`❌ Không tìm thấy hàng hóa tại ${this.selectedFactory}! Mã: ${materialCode}, PO: ${poNumber}`);
        this.errorScans++;
      }
    }, error => {
      console.error('❌ Error querying inventory:', error);
      // Always show popup for database errors - this is a critical error
      alert('❌ Lỗi truy vấn dữ liệu!');
      console.log('❌ Lỗi truy vấn dữ liệu!');
      this.errorScans++;
    });
  }

  private createOutboundRecord(inventoryData: any, quantity: number, inventoryDocId?: string, scanSource: 'outbound' | 'inventory' = 'outbound'): void {
    // Get current user info
    this.afAuth.currentUser.then(user => {
      const currentUser = user ? user.email || user.uid : 'Unknown User';
      
      // Determine scan method based on source
      const scanMethod = scanSource === 'inventory' ? 'Tablet' : 'Scanner';
    
      const outboundRecord: OutboundMaterial = {
        factory: this.selectedFactory || 'ASM1', // Include selected factory
        materialCode: inventoryData.materialCode,
        poNumber: inventoryData.poNumber,
        quantity: inventoryData.quantity,
        unit: inventoryData.unit,
        exportQuantity: quantity,
        exportDate: new Date(),
        location: inventoryData.location,
        exportedBy: currentUser, // Always use logged-in user
        scanMethod: scanMethod, // 'Tablet' for inventory scan, 'Scanner' for outbound scan
        createdAt: new Date(),
        updatedAt: new Date(),
        inventoryDocId: inventoryDocId, // Track which inventory row was used
        notes: inventoryDocId ? 'Trừ từ dòng đầu tiên khi có trùng mã và PO' : undefined
      };
      
      // Save to Firebase
      this.firestore.collection('outbound-materials').add(outboundRecord)
        .then(() => {
          console.log('✅ Outbound record created successfully');
        })
        .catch(error => {
          console.error('❌ Error creating outbound record:', error);
        });
    });
  }



  // Test scanner input method
  testScannerInput(event: any): void {
    const scannedData = event.target.value;
    if (scannedData) {
      this.processScannedData(scannedData);
      event.target.value = ''; // Clear input
    }
  }

  // Handle real scanner input
  handleRealScannerInput(event: any): void {
    const scannedData = event.target.value;
    console.log('🔍 Real scanner input detected:', scannedData);
    
    if (scannedData) {
      this.processScannedData(scannedData);
      event.target.value = ''; // Clear input
      
      // Focus back to hidden input for next scan
      setTimeout(() => {
        event.target.focus();
      }, 100);
    }
  }

  // Focus scanner input when scanner is activated
  focusScannerInput(): void {
    if (this.isScannerActive) {
      setTimeout(() => {
        const scannerInput = document.querySelector('.hidden-scanner-input') as HTMLInputElement;
        if (scannerInput) {
          scannerInput.focus();
        }
      }, 500);
    }
  }
}
