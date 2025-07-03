import { Component, OnInit, OnDestroy } from '@angular/core';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';
import { MaterialLifecycle, MaterialStatus, MaterialTransaction, TransactionType } from '../../models/material-lifecycle.model';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-inbound-materials',
  templateUrl: './inbound-materials.component.html',
  styleUrls: ['./inbound-materials.component.scss']
})
export class InboundMaterialsComponent implements OnInit, OnDestroy {
  Object = Object;
  materials: MaterialLifecycle[] = [];
  filteredMaterials: MaterialLifecycle[] = [];
  recentTransactions: MaterialTransaction[] = [];
  
  // Filters
  searchTerm: string = '';
  statusFilter: MaterialStatus | 'all' = 'all';
  locationFilter: string = 'all';
  
  // Summary data
  todayInbound: number = 0;
  pendingItems: number = 0;
  totalQuantity: number = 0;
  activeLocations: number = 0;
  
  // Form data for new inbound
  newMaterial: Partial<MaterialLifecycle> = {
    materialCode: '',
    materialName: '',
    quantity: 0,
    location: '',
    batchNumber: '',
    supplier: '',
    status: MaterialStatus.ACTIVE
  };
  
  isAddingMaterial: boolean = false;
  availableLocations: string[] = [];
  
  private destroy$ = new Subject<void>();

  constructor(private materialService: MaterialLifecycleService) {}

  ngOnInit(): void {
    this.loadMaterials();
    this.loadRecentTransactions();
    this.loadAvailableLocations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMaterials(): void {
    this.materialService.getMaterials()
      .pipe(takeUntil(this.destroy$))
      .subscribe(materials => {
        this.materials = materials;
        this.applyFilters();
        this.calculateSummary();
      });
  }

  loadRecentTransactions(): void {
    this.materialService.getTransactions()
      .pipe(takeUntil(this.destroy$))
      .subscribe(transactions => {
        this.recentTransactions = transactions
          .filter(t => t.transactionType === TransactionType.INBOUND)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 10);
      });
  }

  loadAvailableLocations(): void {
    // Define warehouse locations from the SVG layout
    this.availableLocations = [
      'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A12',
      'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9',
      'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9',
      'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9',
      'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9',
      'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9',
      'Inbound Stage', 'IQC', 'WO', 'Quality', 'Secured WH'
    ];
  }

  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      const matchesSearch = !this.searchTerm || 
        material.materialCode.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        material.materialName.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        material.location.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      const matchesStatus = this.statusFilter === 'all' || material.status === this.statusFilter;
      const matchesLocation = this.locationFilter === 'all' || material.location === this.locationFilter;
      
      return matchesSearch && matchesStatus && matchesLocation;
    });
  }

  calculateSummary(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    this.todayInbound = this.materials.filter(m => {
      const lastUpdated = new Date(m.lastUpdated);
      lastUpdated.setHours(0, 0, 0, 0);
      return lastUpdated.getTime() === today.getTime() && m.status === MaterialStatus.ACTIVE;
    }).length;
    
    this.pendingItems = this.materials.filter(m => 
      m.status === MaterialStatus.QUARANTINE
    ).length;
    
    this.totalQuantity = this.materials.reduce((sum, m) => sum + m.quantity, 0);
    
    const locations = new Set(this.materials.map(m => m.location));
    this.activeLocations = locations.size;
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  onStatusFilterChange(): void {
    this.applyFilters();
  }

  onLocationFilterChange(): void {
    this.applyFilters();
  }

  addNewMaterial(): void {
    if (this.isValidMaterial()) {
      const material: Partial<MaterialLifecycle> = {
        ...this.newMaterial,
        manufacturingDate: new Date(),
        lastUpdated: new Date(),
        expiryDate: this.calculateExpiryDate(),
        status: MaterialStatus.ACTIVE,
        costCenter: 'INBOUND',
        unitOfMeasure: 'PC'
      };

      this.materialService.addMaterial(material as MaterialLifecycle)
        .then(() => {
          this.resetForm();
          this.isAddingMaterial = false;
        })
        .catch(error => {
          console.error('Error adding material:', error);
        });
    }
  }

  private isValidMaterial(): boolean {
    return !!(
      this.newMaterial.materialCode &&
      this.newMaterial.materialName &&
      this.newMaterial.quantity && this.newMaterial.quantity > 0 &&
      this.newMaterial.location &&
      this.newMaterial.batchNumber &&
      this.newMaterial.supplier
    );
  }

  private calculateExpiryDate(): Date {
    // Default 1 year expiry from today
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    return expiryDate;
  }

  resetForm(): void {
    this.newMaterial = {
      materialCode: '',
      materialName: '',
      quantity: 0,
      location: '',
      batchNumber: '',
      supplier: '',
      status: MaterialStatus.ACTIVE
    };
  }

  updateMaterialStatus(material: MaterialLifecycle, newStatus: MaterialStatus): void {
    const updatedMaterial = { ...material, status: newStatus, lastUpdated: new Date() };
    
    this.materialService.updateMaterial(material.id!, updatedMaterial)
      .then(() => {
        // Create transaction record for status change
        const transaction: Partial<MaterialTransaction> = {
          materialId: material.id!,
          transactionType: TransactionType.ADJUSTMENT,
          quantity: material.quantity,
          location: material.location,
          timestamp: new Date(),
          performedBy: 'System',
          notes: `Status changed from ${material.status} to ${newStatus}`
        };
        
        return this.materialService.addTransaction(transaction as MaterialTransaction);
      })
      .catch(error => {
        console.error('Error updating material status:', error);
      });
  }

  deleteMaterial(material: MaterialLifecycle): void {
    if (confirm(`Are you sure you want to delete ${material.materialCode}?`)) {
      this.materialService.deleteMaterial(material.id!)
        .then(() => {
          // Record deletion transaction
          const transaction: Partial<MaterialTransaction> = {
            materialId: material.id!,
            transactionType: TransactionType.OUTBOUND,
            quantity: material.quantity,
            location: material.location,
            timestamp: new Date(),
            performedBy: 'System',
            notes: `Material ${material.materialCode} deleted from inbound`
          };
          
          return this.materialService.addTransaction(transaction as MaterialTransaction);
        })
        .catch(error => {
          console.error('Error deleting material:', error);
        });
    }
  }

  getStatusClass(status: MaterialStatus): string {
    switch (status) {
      case MaterialStatus.ACTIVE: return 'status-active';
      case MaterialStatus.EXPIRING_SOON: return 'status-expiring';
      case MaterialStatus.EXPIRED: return 'status-expired';
      case MaterialStatus.CONSUMED: return 'status-consumed';
      case MaterialStatus.QUARANTINE: return 'status-quarantine';
      default: return '';
    }
  }

  getLocationKeys(): string[] {
    return Object.keys(this.getLocationSummary());
  }

  getLocationSummary(): { [key: string]: number } {
    const summary: { [key: string]: number } = {};
    this.filteredMaterials.forEach(material => {
      summary[material.location] = (summary[material.location] || 0) + 1;
    });
    return summary;
  }

  getLocationCount(location: string): number {
    return this.getLocationSummary()[location] || 0;
  }

  exportToCSV(): void {
    const headers = ['Material Code', 'Material Name', 'Quantity', 'Location', 'Batch Number', 'Supplier', 'Status', 'Last Updated'];
    const csvContent = [
      headers.join(','),
      ...this.filteredMaterials.map(material => [
        material.materialCode,
        material.materialName,
        material.quantity,
        material.location,
        material.batchNumber,
        material.supplier,
        material.status,
        new Date(material.lastUpdated).toLocaleDateString()
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inbound-materials-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
