import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';

export interface OutboundMaterial {
  id?: string;
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
  
  // Search and filter
  searchTerm = '';
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  
  // Loading state
  isLoading = false;
  
  // Scanner properties
  isScannerActive = false;
  showScannerModal = false;
  scanCount = 0;
  successfulScans = 0;
  errorScans = 0;
  scanRate = 0;
  recentScans: any[] = [];
  private scannerInterval: any;
  private lastScanTime = 0;
  private scanTimes: number[] = [];
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth
  ) {}

  ngOnInit(): void {
    this.loadOutboundMaterialsFromFirebase();
    this.cleanupOldRecords(); // Clean up records older than 6 months
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

  // Apply filters
  applyFilters(): void {
    this.filteredOutbound = this.outboundMaterials.filter(material => {
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
  }

  // Search change handler
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
    this.applyFilters();
  }

  // Date range filter
  applyDateRangeFilter(): void {
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

  // Scanner Mode Methods
  startScannerMode(): void {
    console.log('🚀 Starting scanner mode...');
    this.isScannerActive = true;
    this.scanCount = 0;
    this.successfulScans = 0;
    this.errorScans = 0;
    this.recentScans = [];
    this.scanTimes = [];
    
    // Start listening for keyboard input (simulating scanner input)
    this.startKeyboardListener();
    
    // Start rate calculation
    this.scannerInterval = setInterval(() => {
      this.calculateScanRate();
    }, 1000);
    
    // Focus scanner input after a short delay
    setTimeout(() => {
      this.focusScannerInput();
    }, 1000);
    
    // Log to console instead of showing alert
    console.log('🟢 Scanner đã được bật!\n\n📋 Hướng dẫn:\n• Máy scan sẽ tự động gửi dữ liệu\n• Hệ thống sẽ xử lý liên tục\n• Kiểm tra trạng thái để theo dõi\n\n💡 Tip: Click vào bất kỳ đâu trên trang để focus scanner input');
  }

  stopScannerMode(): void {
    console.log('🛑 Stopping scanner mode...');
    this.isScannerActive = false;
    
    if (this.scannerInterval) {
      clearInterval(this.scannerInterval);
      this.scannerInterval = null;
    }
    
    // Stop keyboard listener
    this.stopKeyboardListener();
    
    // Log statistics to console instead of showing alert
    console.log('🔴 Scanner đã dừng!\n\n📊 Thống kê:\n• Tổng quét: ' + this.scanCount + '\n• Thành công: ' + this.successfulScans + '\n• Lỗi: ' + this.errorScans);
  }

  showScannerStatus(): void {
    this.showScannerModal = true;
  }

  closeScannerModal(): void {
    this.showScannerModal = false;
  }

  private startKeyboardListener(): void {
    // Listen for keyboard input (simulating scanner)
    document.addEventListener('keydown', this.handleScannerInput.bind(this));
  }

  private stopKeyboardListener(): void {
    document.removeEventListener('keydown', this.handleScannerInput.bind(this));
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

  private processScannedData(scannedData: string): void {
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
          throw new Error('Invalid quantity');
        }
        
        console.log('🔍 Looking for inventory item:', { materialCode, poNumber, quantity });
        
        // Find matching inventory item with scanner mode flag
        this.findAndUpdateInventory(materialCode, poNumber, quantity, this.isScannerActive);
        
        // Record successful scan
        this.successfulScans++;
        this.recordScan(scannedData, true);
        
      } else {
        throw new Error('Invalid QR code format - expected: MaterialCode|PO|Quantity');
      }
    } catch (error) {
      console.error('❌ Error processing scanned data:', error);
      this.errorScans++;
      this.recordScan(scannedData, false);
      if (this.isScannerActive) {
        console.log('❌ Lỗi xử lý dữ liệu: ' + error.message);
      } else {
        alert('❌ Lỗi xử lý dữ liệu: ' + error.message);
      }
    }
    
    // Update scan time for rate calculation
    const now = Date.now();
    this.scanTimes.push(now);
    this.lastScanTime = now;
    
    // Keep only last 60 seconds for rate calculation
    this.scanTimes = this.scanTimes.filter(time => now - time <= 60000);
  }

  private findAndUpdateInventory(materialCode: string, poNumber: string, quantity: number, isScannerMode: boolean = false): void {
    console.log('🔍 Querying inventory for:', { materialCode, poNumber });
    
    // Query inventory collection with real-time data
    // Order by document ID to ensure consistent ordering and always get the first (top) row
    this.firestore.collection('inventory-materials', ref => 
      ref.where('materialCode', '==', materialCode)
         .where('poNumber', '==', poNumber)
         .orderBy('__name__') // Order by document ID to ensure first document is always the same
    ).get().subscribe(snapshot => {
      if (!snapshot.empty) {
        // Always take the first document (top row) when there are duplicates
        const inventoryDoc = snapshot.docs[0];
        const inventoryData = inventoryDoc.data() as any;
        
        console.log(`📋 Found ${snapshot.docs.length} matching items. Using first item (top row):`, inventoryData);
        
        console.log('📦 Found inventory item:', inventoryData);
        console.log('📊 Current stock details:', {
          stock: inventoryData.stock,
          quantity: inventoryData.quantity,
          exported: inventoryData.exported,
          requestedQuantity: quantity
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
          alert(`❌ Không đủ tồn kho!\nCần: ${quantity}\nCó: ${currentStock}\nMã: ${materialCode}\nPO: ${poNumber}`);
          console.log(`❌ Không đủ tồn kho! Cần: ${quantity}, Có: ${currentStock}, Mã: ${materialCode}, PO: ${poNumber}`);
          this.errorScans++;
          return;
        }
        
        // Check if stock will be negative after export
        const newStock = currentStock - quantity;
        if (newStock < 0) {
          // Always show alert for negative stock - this is the critical error
          alert(`❌ Không thể xuất! Tồn kho sẽ âm sau khi xuất!\nTồn hiện tại: ${currentStock}\nXuất: ${quantity}\nSẽ còn: ${newStock}\nMã: ${materialCode}\nPO: ${poNumber}`);
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
          newExported: newExported
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
            note: 'Deducted from first matching row'
          });
          
          // No success alert when scanner is active - just log to console
          console.log(`✅ Xuất hàng thành công! Mã: ${materialCode}, PO: ${poNumber}, Số lượng: ${quantity}, Tồn kho mới: ${newStock} (từ dòng đầu tiên)`);
          
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
        console.error('❌ No matching inventory item found:', { materialCode, poNumber });
        // Always show popup for missing inventory - this is a critical error
        alert(`❌ Không tìm thấy hàng hóa!\nMã: ${materialCode}\nPO: ${poNumber}`);
        console.log(`❌ Không tìm thấy hàng hóa! Mã: ${materialCode}, PO: ${poNumber}`);
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

  private recordScan(data: string, success: boolean): void {
    const scanRecord = {
      data: data,
      success: success,
      timestamp: new Date()
    };
    
    this.recentScans.unshift(scanRecord);
    
    // Keep only last 20 scans
    if (this.recentScans.length > 20) {
      this.recentScans = this.recentScans.slice(0, 20);
    }
  }

  private calculateScanRate(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Count scans in last minute
    const recentScans = this.scanTimes.filter(time => time >= oneMinuteAgo);
    this.scanRate = recentScans.length;
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
