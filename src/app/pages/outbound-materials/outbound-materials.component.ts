import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface OutboundMaterial {
  id?: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  exportQuantity: number;
  exportDate: Date;
  location: string;
  notes: string;
  exportedBy: string;
  scanMethod?: string; // 'QR_SCAN' or 'MANUAL'
  createdAt?: Date;
  updatedAt?: Date;
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
  
  // QR Code scanning
  scannedQRData: string = '';
  scannedMaterial: any = null;
  isScanning: boolean = false;
  
  // Export form
  exportQuantity: number = 0;
  exportNotes: string = '';
  exportLocation: string = '';
  
  // Search and filter
  searchTerm = '';
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  
  // Loading state
  isLoading = false;
  
  private destroy$ = new Subject<void>();

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.loadOutboundMaterialsFromFirebase();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
      const exportDate = new Date(material.exportDate);
      const isInDateRange = exportDate >= this.startDate && exportDate <= this.endDate;
      if (!isInDateRange) return false;
      
      return true;
    });

    // Sort by export date (newest first)
    this.filteredOutbound.sort((a, b) => new Date(b.exportDate).getTime() - new Date(a.exportDate).getTime());
  }

  // Start QR code scanning
  startQRScanning(): void {
    this.isScanning = true;
    this.scannedQRData = '';
    this.scannedMaterial = null;
    
    // Simulate QR code scanning (in real app, this would use camera API)
    console.log('Starting QR code scanning...');
  }

  // Process scanned QR code
  processScannedQR(qrData: string): void {
    console.log('Processing QR code:', qrData);
    
    // Parse QR data: MaterialCode|PONumber|Quantity
    const parts = qrData.split('|');
    if (parts.length >= 3) {
      const materialCode = parts[0];
      const poNumber = parts[1];
      const quantity = parseInt(parts[2]);
      
      this.scannedMaterial = {
        materialCode: materialCode,
        poNumber: poNumber,
        quantity: quantity
      };
      
      console.log('Scanned material:', this.scannedMaterial);
      
      // Check inventory for this material
      this.checkInventoryForMaterial(materialCode, poNumber);
    } else {
      alert('QR code không hợp lệ! Vui lòng quét lại.');
    }
  }

  // Check inventory for material
  private checkInventoryForMaterial(materialCode: string, poNumber: string): void {
    this.firestore.collection('inventory-materials', ref => 
      ref.where('materialCode', '==', materialCode)
         .where('poNumber', '==', poNumber)
    ).get().toPromise().then(snapshot => {
      if (snapshot && !snapshot.empty) {
        const inventoryItem = snapshot.docs[0].data() as any;
        console.log('Found in inventory:', inventoryItem);
        
        // Set max export quantity
        this.exportQuantity = Math.min(inventoryItem.stock || inventoryItem.quantity, this.scannedMaterial.quantity);
        this.exportLocation = inventoryItem.location || '';
        
        alert(`Tìm thấy hàng trong kho!\nMã: ${materialCode}\nPO: ${poNumber}\nTồn kho: ${inventoryItem.stock || inventoryItem.quantity}`);
      } else {
        alert('Không tìm thấy hàng trong kho!');
        this.scannedMaterial = null;
      }
    }).catch(error => {
      console.error('Error checking inventory:', error);
      alert('Lỗi khi kiểm tra kho!');
    });
  }

  // Export material
  exportMaterial(): void {
    if (!this.scannedMaterial) {
      alert('Vui lòng quét QR code trước!');
      return;
    }
    
    if (this.exportQuantity <= 0) {
      alert('Vui lòng nhập số lượng xuất!');
      return;
    }
    
    // Create outbound material
    const outboundMaterial: OutboundMaterial = {
      materialCode: this.scannedMaterial.materialCode,
      poNumber: this.scannedMaterial.poNumber,
      quantity: this.scannedMaterial.quantity,
      unit: 'PCS', // Default unit
      exportQuantity: this.exportQuantity,
      exportDate: new Date(),
      location: this.exportLocation,
      notes: this.exportNotes,
      exportedBy: 'Current User', // TODO: Get from auth
      scanMethod: 'MANUAL',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Save to Firebase
    this.firestore.collection('outbound-materials').add(outboundMaterial)
      .then((docRef) => {
        console.log('Outbound material saved with ID:', docRef.id);
        
        // Update inventory stock
        this.updateInventoryStock(outboundMaterial);
        
        // Reset form
        this.resetExportForm();
        
        alert('Xuất hàng thành công!');
      })
      .catch(error => {
        console.error('Error saving outbound material:', error);
        alert('Lỗi khi xuất hàng!');
      });
  }

  // Update inventory stock
  private updateInventoryStock(outboundMaterial: OutboundMaterial): void {
    this.firestore.collection('inventory-materials', ref => 
      ref.where('materialCode', '==', outboundMaterial.materialCode)
         .where('poNumber', '==', outboundMaterial.poNumber)
    ).get().toPromise().then(snapshot => {
      if (snapshot && !snapshot.empty) {
        const docRef = snapshot.docs[0].ref;
        const currentData = snapshot.docs[0].data() as any;
        const newStock = Math.max(0, (currentData.stock || currentData.quantity) - outboundMaterial.exportQuantity);
        const newExported = (currentData.exported || 0) + outboundMaterial.exportQuantity;
        
        docRef.update({
          stock: newStock,
          exported: newExported,
          updatedAt: new Date()
        }).then(() => {
          console.log('Inventory stock updated successfully');
        }).catch(error => {
          console.error('Error updating inventory stock:', error);
        });
      }
    }).catch(error => {
      console.error('Error updating inventory stock:', error);
    });
  }

  // Reset export form
  private resetExportForm(): void {
    this.scannedMaterial = null;
    this.scannedQRData = '';
    this.exportQuantity = 0;
    this.exportNotes = '';
    this.exportLocation = '';
    this.isScanning = false;
  }

  // Manual QR code input (for testing)
  manualQRInput(): void {
    const qrData = prompt('Nhập QR code data (format: MaterialCode|PONumber|Quantity):');
    if (qrData) {
      this.processScannedQR(qrData);
    }
  }

  // Search functionality
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
    this.applyFilters();
  }

  // Date range filter
  applyDateRangeFilter(): void {
    this.applyFilters();
  }
}
