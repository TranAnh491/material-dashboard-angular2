import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export interface TraceEvent {
  id: string;
  type: 'inbound' | 'outbound' | 'inventory' | 'qc';
  date: Date;
  materialCode: string;
  poNumber: string;
  quantity?: number;
  exportQuantity?: number;
  employeeId?: string;
  employeeIds?: string[];
  iqcStatus?: string;
  qcCheckedBy?: string; // Người Pass từ QC
  qcCheckedAt?: Date; // Thời gian Pass
  productionOrder?: string;
  location?: string;
  notes?: string;
  batchNumber?: string;
  importDate?: Date;
}

export interface TraceRow {
  date: Date;
  type: 'inbound' | 'outbound' | 'inventory' | 'qc';
  materialCode: string;
  poNumber?: string;
  imd?: string;
  batch?: string;
  quantityIn?: number;
  quantityOut?: number;
  productionOrder?: string;
  stock?: number;
  qc?: string;
  employee?: string;
  sortOrder?: number; // For sorting QC after inbound
}

@Component({
  selector: 'app-trace-back',
  templateUrl: './trace-back.component.html',
  styleUrls: ['./trace-back.component.scss']
})
export class TraceBackComponent implements OnInit, OnDestroy {
  selectedFactory: 'ASM1' | 'ASM2' = 'ASM1';
  scanInput: string = '';
  isScanning: boolean = false;
  isLoading: boolean = false;
  
  traceEvents: TraceEvent[] = [];
  traceRows: TraceRow[] = [];
  materialCode: string = '';
  materialName: string = '';
  currentStock: number = 0;
  
  // Inbound information for display
  inboundInfo: {
    materialCode: string;
    poNumber: string;
    imd: string;
    quantity: number;
    employeeIds: string[];
    rollsOrBags: number;
    batchNumber: string;
    importDate: Date;
    qcWaitTime: string; // Thời gian chờ QC pass
  } | null = null;
  
  private destroy$ = new Subject<void>();
  private scannerTimeout: any = null;
  private scannerBuffer: string = '';

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    console.log('🔍 Trace Back component initialized');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.scannerTimeout) {
      clearTimeout(this.scannerTimeout);
    }
  }

  onFactoryChange(factory: 'ASM1' | 'ASM2'): void {
    this.selectedFactory = factory;
    this.clearTrace();
    console.log(`🏭 Factory changed to: ${factory}`);
  }

  onScanInput(event: KeyboardEvent): void {
    // Handle physical scanner input (Enter key detection)
    if (event.key === 'Enter') {
      event.preventDefault();
      const scannedData = this.scanInput.trim();
      if (scannedData) {
        this.processScan(scannedData);
      }
      this.scanInput = '';
      return;
    }

    // Handle scanner buffer (fast typing detection)
    const now = Date.now();
    if (this.scannerTimeout) {
      clearTimeout(this.scannerTimeout);
    }

    this.scannerBuffer += event.key;
    
    this.scannerTimeout = setTimeout(() => {
      if (this.scannerBuffer.length > 5) {
        // Likely scanner input
        this.processScan(this.scannerBuffer.trim());
        this.scannerBuffer = '';
      }
      this.scannerBuffer = '';
    }, 100);
  }

  onScanInputChange(): void {
    // Manual input handling
    if (this.scanInput && this.scanInput.length > 5) {
      // Auto-process if input is long enough (likely scanned)
      setTimeout(() => {
        if (this.scanInput.trim()) {
          this.processScan(this.scanInput.trim());
        }
      }, 500);
    }
  }

  async processScan(scannedData: string): Promise<void> {
    console.log(`🔍 Processing scan: ${scannedData}`);
    
    // Clean scanned data - remove "Shift" if present
    let cleanedData = scannedData.replace(/Shift/gi, '');
    console.log(`🧹 Cleaned scan data: ${cleanedData}`);
    
    // Parse QR code format: MaterialCode|PO|Quantity|IMD
    const parts = cleanedData.split('|');
    let materialCode = '';
    let poNumber = '';
    
    if (parts.length >= 2) {
      materialCode = parts[0].trim();
      poNumber = parts[1].trim();
      console.log(`📋 Parsed: MaterialCode=${materialCode}, PO=${poNumber}`);
    } else {
      // Try to extract material code from scanned data
      materialCode = cleanedData.trim();
      console.log(`📋 Using full scan as materialCode: ${materialCode}`);
    }

    if (!materialCode) {
      alert('❌ Không thể đọc mã hàng từ dữ liệu scan!');
      return;
    }

    this.materialCode = materialCode;
    this.isLoading = true;
    this.traceEvents = [];

    try {
      await this.loadTraceData(materialCode, poNumber);
    } catch (error) {
      console.error('❌ Error loading trace data:', error);
      alert(`❌ Lỗi khi tải dữ liệu: ${error.message}`);
    } finally {
      this.isLoading = false;
      this.scanInput = '';
      this.cdr.detectChanges();
    }
  }

  private async loadTraceData(materialCode: string, poNumber?: string): Promise<void> {
    console.log(`📦 Loading trace data for: ${materialCode}${poNumber ? ` - PO: ${poNumber}` : ''}`);
    
    const events: TraceEvent[] = [];

    // 1. Load Inbound data
    try {
      console.log(`🔍 Querying inbound-materials: factory=${this.selectedFactory}, materialCode=${materialCode}${poNumber ? `, poNumber=${poNumber}` : ''}`);
      
      // Try with PO first if available
      let inboundSnapshot: any = null;
      
      if (poNumber && poNumber.trim()) {
        try {
          inboundSnapshot = await this.firestore.collection('inbound-materials', ref =>
            ref.where('factory', '==', this.selectedFactory)
               .where('materialCode', '==', materialCode)
               .where('poNumber', '==', poNumber)
          ).get().toPromise();
          console.log(`📦 Query with PO: Found ${inboundSnapshot?.size || 0} records`);
        } catch (error) {
          console.log(`⚠️ Query with PO failed, trying without PO:`, error);
        }
      }
      
      // Fallback: query without PO if no results or PO not provided
      if (!inboundSnapshot || inboundSnapshot.empty) {
        inboundSnapshot = await this.firestore.collection('inbound-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', '==', materialCode)
        ).get().toPromise();
        console.log(`📦 Query without PO: Found ${inboundSnapshot?.size || 0} records`);
      }
      
      if (inboundSnapshot && !inboundSnapshot.empty) {
        let firstInboundData: any = null;
        let firstImportDate: Date | null = null;
        
        inboundSnapshot.docs.forEach((doc, index) => {
          const data = doc.data() as any;
          let importDate: Date;
          
          if (data.importDate?.toDate) {
            importDate = data.importDate.toDate();
          } else if (data.importDate?.seconds) {
            importDate = new Date(data.importDate.seconds * 1000);
          } else if (data.importDate) {
            importDate = new Date(data.importDate);
          } else {
            importDate = new Date();
          }
          
          // Save first inbound for info box
          if (index === 0) {
            firstInboundData = data;
            firstImportDate = importDate;
          }
          
          events.push({
            id: doc.id,
            type: 'inbound',
            date: importDate,
            materialCode: data.materialCode || materialCode,
            poNumber: data.poNumber || poNumber || '',
            quantity: data.quantity || 0,
            employeeIds: data.employeeIds || [],
            iqcStatus: data.iqcStatus || 'Chờ kiểm',
            location: data.location || '',
            batchNumber: data.batchNumber || '',
            importDate: importDate,
            notes: data.notes || ''
          });
        });
        
        // Store inbound info for display (first inbound record)
        if (firstInboundData && firstImportDate) {
          const imd = firstImportDate.toLocaleDateString('en-GB').split('/').join('');
          this.inboundInfo = {
            materialCode: firstInboundData.materialCode || materialCode,
            poNumber: firstInboundData.poNumber || poNumber || '',
            imd: imd,
            quantity: firstInboundData.quantity || 0,
            employeeIds: firstInboundData.employeeIds || [],
            rollsOrBags: firstInboundData.rollsOrBags || 0,
            batchNumber: firstInboundData.batchNumber || '',
            importDate: firstImportDate,
            qcWaitTime: '' // Will be calculated later
          };
        }
        
        console.log(`✅ Added ${inboundSnapshot.docs.length} inbound events`);
      } else {
        console.log(`⚠️ No inbound records found for ${materialCode}`);
        this.inboundInfo = null;
      }
    } catch (error) {
      console.error('❌ Error loading inbound data:', error);
    }

    // 2. Load Outbound data
    try {
      console.log(`🔍 Querying outbound-materials: factory=${this.selectedFactory}, materialCode=${materialCode}${poNumber ? `, poNumber=${poNumber}` : ''}`);
      
      // Try with PO first if available
      let outboundSnapshot: any = null;
      
      if (poNumber && poNumber.trim()) {
        try {
          outboundSnapshot = await this.firestore.collection('outbound-materials', ref =>
            ref.where('factory', '==', this.selectedFactory)
               .where('materialCode', '==', materialCode)
               .where('poNumber', '==', poNumber)
          ).get().toPromise();
          console.log(`📤 Query with PO: Found ${outboundSnapshot?.size || 0} records`);
        } catch (error) {
          console.log(`⚠️ Query with PO failed, trying without PO:`, error);
        }
      }
      
      // Fallback: query without PO if no results or PO not provided
      if (!outboundSnapshot || outboundSnapshot.empty) {
        outboundSnapshot = await this.firestore.collection('outbound-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', '==', materialCode)
        ).get().toPromise();
        console.log(`📤 Query without PO: Found ${outboundSnapshot?.size || 0} records`);
      }
      
      if (outboundSnapshot && !outboundSnapshot.empty) {
        outboundSnapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          let exportDate: Date;
          
          if (data.exportDate?.toDate) {
            exportDate = data.exportDate.toDate();
          } else if (data.exportDate?.seconds) {
            exportDate = new Date(data.exportDate.seconds * 1000);
          } else if (data.exportDate) {
            exportDate = new Date(data.exportDate);
          } else {
            exportDate = new Date();
          }
          
          events.push({
            id: doc.id,
            type: 'outbound',
            date: exportDate,
            materialCode: data.materialCode || materialCode,
            poNumber: data.poNumber || poNumber || '',
            exportQuantity: data.exportQuantity || data.quantity || 0,
            employeeId: data.employeeId || data.exportedBy || '',
            productionOrder: data.productionOrder || '',
            location: data.location || '',
            notes: data.notes || ''
          });
        });
        console.log(`✅ Added ${outboundSnapshot.docs.length} outbound events`);
      } else {
        console.log(`⚠️ No outbound records found for ${materialCode}`);
      }
    } catch (error) {
      console.error('❌ Error loading outbound data:', error);
    }

    // 3. Load Inventory data (current stock and QC info)
    try {
      console.log(`🔍 Querying inventory-materials: factory=${this.selectedFactory}, materialCode=${materialCode}${poNumber ? `, poNumber=${poNumber}` : ''}`);
      
      // Try with PO first if available
      let inventorySnapshot: any = null;
      
      if (poNumber && poNumber.trim()) {
        try {
          inventorySnapshot = await this.firestore.collection('inventory-materials', ref =>
            ref.where('factory', '==', this.selectedFactory)
               .where('materialCode', '==', materialCode)
               .where('poNumber', '==', poNumber)
          ).get().toPromise();
          console.log(`📋 Query with PO: Found ${inventorySnapshot?.size || 0} records`);
        } catch (error) {
          console.log(`⚠️ Query with PO failed, trying without PO:`, error);
        }
      }
      
      // Fallback: query without PO if no results or PO not provided
      if (!inventorySnapshot || inventorySnapshot.empty) {
        inventorySnapshot = await this.firestore.collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', '==', materialCode)
        ).get().toPromise();
        console.log(`📋 Query without PO: Found ${inventorySnapshot?.size || 0} records`);
      }

      if (inventorySnapshot && !inventorySnapshot.empty) {
        inventorySnapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          let importDate: Date;
          
          if (data.importDate?.toDate) {
            importDate = data.importDate.toDate();
          } else if (data.importDate?.seconds) {
            importDate = new Date(data.importDate.seconds * 1000);
          } else if (data.importDate) {
            importDate = new Date(data.importDate);
          } else {
            importDate = new Date();
          }
          
          const openingStock = data.openingStock !== null ? data.openingStock : 0;
          const quantity = data.quantity || 0;
          const exported = data.exported || 0;
          const xt = data.xt || 0;
          const currentStock = openingStock + quantity - exported - xt;

          // Add inventory event
          events.push({
            id: doc.id,
            type: 'inventory',
            date: importDate,
            materialCode: data.materialCode || materialCode,
            poNumber: data.poNumber || poNumber || '',
            quantity: currentStock,
            location: data.location || '',
            notes: 'Tồn kho hiện tại'
          });

          // Add QC event if QC was checked
          if (data.qcCheckedBy && data.qcCheckedAt) {
            let qcDate: Date;
            if (data.qcCheckedAt?.toDate) {
              qcDate = data.qcCheckedAt.toDate();
            } else if (data.qcCheckedAt?.seconds) {
              qcDate = new Date(data.qcCheckedAt.seconds * 1000);
            } else {
              qcDate = new Date(data.qcCheckedAt);
            }
            
            events.push({
              id: `${doc.id}_qc`,
              type: 'qc',
              date: qcDate,
              materialCode: data.materialCode || materialCode,
              poNumber: data.poNumber || poNumber || '',
              iqcStatus: data.iqcStatus || 'CHỜ KIỂM',
              qcCheckedBy: data.qcCheckedBy,
              qcCheckedAt: qcDate,
              location: data.location || ''
            });
          } else if (data.iqcStatus && data.iqcStatus !== 'CHỜ KIỂM' && data.iqcStatus !== 'CHỜ XÁC NHẬN') {
            // If IQC status exists but no qcCheckedBy, use updatedAt as date
            let qcDate: Date;
            if (data.updatedAt?.toDate) {
              qcDate = data.updatedAt.toDate();
            } else if (data.updatedAt?.seconds) {
              qcDate = new Date(data.updatedAt.seconds * 1000);
            } else if (data.updatedAt) {
              qcDate = new Date(data.updatedAt);
            } else {
              qcDate = importDate;
            }
            
            events.push({
              id: `${doc.id}_qc`,
              type: 'qc',
              date: qcDate,
              materialCode: data.materialCode || materialCode,
              poNumber: data.poNumber || poNumber || '',
              iqcStatus: data.iqcStatus,
              location: data.location || ''
            });
          }
        });
        console.log(`✅ Added ${inventorySnapshot.docs.length} inventory events`);
      } else {
        console.log(`⚠️ No inventory records found for ${materialCode}`);
      }
    } catch (error) {
      console.error('❌ Error loading inventory data:', error);
    }

    // 4. Load Material name from catalog
    try {
      const catalogDoc = await this.firestore.collection('materials').doc(materialCode).get().toPromise();
      if (catalogDoc && catalogDoc.exists) {
        const catalogData = catalogDoc.data() as any;
        this.materialName = catalogData.materialName || materialCode;
      } else {
        this.materialName = materialCode;
      }
    } catch (error) {
      console.error('❌ Error loading material name:', error);
      this.materialName = materialCode;
    }

    // Sort events by date (oldest first)
    events.sort((a, b) => a.date.getTime() - b.date.getTime());

    this.traceEvents = events;
    
    // Calculate QC wait time if we have inbound info and QC event
    if (this.inboundInfo) {
      // Find first QC event for this material and PO
      const qcEvent = events.find(e => 
        e.type === 'qc' && 
        e.materialCode === this.inboundInfo!.materialCode &&
        e.poNumber === this.inboundInfo!.poNumber
      );
      
      if (qcEvent && qcEvent.qcCheckedAt) {
        const waitTimeMs = qcEvent.qcCheckedAt.getTime() - this.inboundInfo.importDate.getTime();
        
        if (waitTimeMs > 0) {
          const waitTimeDays = Math.floor(waitTimeMs / (1000 * 60 * 60 * 24));
          const waitTimeHours = Math.floor((waitTimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const waitTimeMinutes = Math.floor((waitTimeMs % (1000 * 60 * 60)) / (1000 * 60));
          
          if (waitTimeDays > 0) {
            this.inboundInfo.qcWaitTime = `${waitTimeDays} ngày ${waitTimeHours} giờ`;
          } else if (waitTimeHours > 0) {
            this.inboundInfo.qcWaitTime = `${waitTimeHours} giờ ${waitTimeMinutes} phút`;
          } else {
            this.inboundInfo.qcWaitTime = `${waitTimeMinutes} phút`;
          }
        } else {
          this.inboundInfo.qcWaitTime = 'Chưa QC';
        }
      } else {
        this.inboundInfo.qcWaitTime = 'Chưa QC';
      }
    }
    
    // Convert events to table rows
    this.convertEventsToRows(events);
    
    console.log(`✅ Loaded ${events.length} trace events, converted to ${this.traceRows.length} rows`);
    
    // Debug: Log summary
    const inboundCount = events.filter(e => e.type === 'inbound').length;
    const outboundCount = events.filter(e => e.type === 'outbound').length;
    const inventoryCount = events.filter(e => e.type === 'inventory').length;
    const qcCount = events.filter(e => e.type === 'qc').length;
    console.log(`📊 Summary: Inbound=${inboundCount}, Outbound=${outboundCount}, Inventory=${inventoryCount}, QC=${qcCount}`);
    
    if (events.length === 0) {
      console.warn(`⚠️ No trace events found for materialCode: ${materialCode}, factory: ${this.selectedFactory}`);
      console.log(`💡 Suggestions:`);
      console.log(`   - Check if materialCode exists in ${this.selectedFactory}`);
      console.log(`   - Try scanning without PO number`);
      console.log(`   - Verify factory selection (currently: ${this.selectedFactory})`);
    }
  }

  private convertEventsToRows(events: TraceEvent[]): void {
    this.traceRows = [];
    let runningStock = 0;
    
    // Separate QC events to process separately
    const qcEvents: TraceEvent[] = [];
    const nonQcEvents: TraceEvent[] = [];
    
    events.forEach(event => {
      if (event.type === 'qc') {
        qcEvents.push(event);
      } else {
        nonQcEvents.push(event);
      }
    });
    
    // Process non-QC events and calculate running stock
    nonQcEvents.forEach((event, index) => {
      if (event.type === 'inbound') {
        const quantity = event.quantity || 0;
        runningStock += quantity;
        
        const imd = event.importDate 
          ? event.importDate.toLocaleDateString('en-GB').split('/').join('')
          : event.date.toLocaleDateString('en-GB').split('/').join('');
        
        this.traceRows.push({
          date: event.date,
          type: 'inbound',
          materialCode: event.materialCode,
          poNumber: event.poNumber || undefined,
          imd: imd,
          batch: event.batchNumber || undefined,
          quantityIn: quantity,
          employee: event.employeeIds && event.employeeIds.length > 0 
            ? event.employeeIds.join(', ') 
            : undefined,
          sortOrder: index * 2 // Even numbers for inbound
        });
        
        // Add QC row right after this inbound if QC exists
        const relatedQc = qcEvents.find(qc => 
          qc.materialCode === event.materialCode &&
          qc.poNumber === event.poNumber &&
          Math.abs(qc.date.getTime() - event.date.getTime()) < 86400000 // Within 24 hours
        );
        
        if (relatedQc) {
          this.traceRows.push({
            date: relatedQc.qcCheckedAt || relatedQc.date,
            type: 'qc',
            materialCode: relatedQc.materialCode,
            poNumber: relatedQc.poNumber || undefined,
            qc: relatedQc.iqcStatus || relatedQc.qcCheckedBy || 'PASS',
            employee: relatedQc.qcCheckedBy || undefined,
            sortOrder: index * 2 + 1 // Odd numbers for QC (right after inbound)
          });
        }
      } else if (event.type === 'outbound') {
        const quantity = event.exportQuantity || 0;
        runningStock -= quantity;
        
        this.traceRows.push({
          date: event.date,
          type: 'outbound',
          materialCode: event.materialCode,
          poNumber: event.poNumber || undefined,
          quantityOut: quantity,
          productionOrder: event.productionOrder || undefined,
          employee: event.employeeId || undefined,
          sortOrder: this.traceRows.length * 2 // Continue numbering
        });
      }
    });
    
    // Sort rows: first by date, then by sortOrder (QC after inbound)
    this.traceRows.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
    
    // Calculate final stock from inventory events
    const inventoryEvent = events.find(e => e.type === 'inventory');
    if (inventoryEvent && inventoryEvent.quantity !== undefined) {
      this.currentStock = inventoryEvent.quantity;
    } else {
      this.currentStock = runningStock;
    }
    
    // Add stock row at the end if there are rows (only once)
    if (this.traceRows.length > 0) {
      this.traceRows.push({
        date: new Date(),
        type: 'inventory',
        materialCode: this.materialCode,
        stock: this.currentStock,
        sortOrder: 999999 // Always last
      });
    }
  }

  clearTrace(): void {
    this.traceEvents = [];
    this.traceRows = [];
    this.materialCode = '';
    this.materialName = '';
    this.currentStock = 0;
    this.inboundInfo = null;
    this.scanInput = '';
  }

  formatDate(date: Date): string {
    if (!date) return 'N/A';
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getEventTypeLabel(type: string): string {
    switch (type) {
      case 'inbound': return 'Nhập kho';
      case 'outbound': return 'Xuất kho';
      case 'inventory': return 'Tồn kho';
      case 'qc': return 'QC';
      default: return type;
    }
  }

  // Get available columns based on data
  getAvailableColumns(): string[] {
    const columns: string[] = ['date', 'type'];
    
    if (this.traceRows.some(r => r.materialCode)) columns.push('materialCode');
    if (this.traceRows.some(r => r.poNumber)) columns.push('poNumber');
    if (this.traceRows.some(r => r.imd)) columns.push('imd');
    if (this.traceRows.some(r => r.batch)) columns.push('batch');
    if (this.traceRows.some(r => r.quantityIn !== undefined)) columns.push('quantityIn');
    if (this.traceRows.some(r => r.quantityOut !== undefined)) columns.push('quantityOut');
    if (this.traceRows.some(r => r.productionOrder)) columns.push('productionOrder');
    if (this.traceRows.some(r => r.stock !== undefined)) columns.push('stock');
    // QC column always shown if there are QC rows
    if (this.traceRows.some(r => r.type === 'qc')) columns.push('qc');
    if (this.traceRows.some(r => r.employee)) columns.push('employee');
    
    return columns;
  }

  getColumnLabel(column: string): string {
    const labels: { [key: string]: string } = {
      'date': 'Ngày',
      'type': 'Loại',
      'materialCode': 'Mã hàng',
      'poNumber': 'PO',
      'imd': 'IMD',
      'batch': 'Batch',
      'quantityIn': 'Lượng nhập',
      'quantityOut': 'Lượng xuất',
      'productionOrder': 'Lệnh sản xuất',
      'stock': 'Tồn kho',
      'qc': 'QC',
      'employee': 'Người thực hiện'
    };
    return labels[column] || column;
  }
}

