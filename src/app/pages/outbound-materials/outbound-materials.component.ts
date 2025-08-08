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
}
