import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { 
  MaterialLifecycle, 
  MaterialStatus, 
  AlertLevel 
} from '../../models/material-lifecycle.model';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';

@Component({
  selector: 'app-materials-inventory',
  templateUrl: './materials-inventory.component.html',
  styleUrls: ['./materials-inventory.component.scss']
})
export class MaterialsInventoryComponent implements OnInit, OnDestroy {
  materials$: Observable<MaterialLifecycle[]>;
  materials: MaterialLifecycle[] = [];
  filteredMaterials: MaterialLifecycle[] = [];
  
  // Search and filter
  searchTerm = '';
  selectedStatus = '';
  selectedLocation = '';
  selectedAlertLevel = '';
  
  // Loading state
  loading = false;
  
  // Enums for template
  MaterialStatus = MaterialStatus;
  AlertLevel = AlertLevel;
  
  // Expose Object for template
  Object = Object;
  
  private subscriptions: Subscription[] = [];
  
  // Location options from warehouse layout
  locationOptions = [
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9',
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9',
    'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9',
    'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9',
    'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9',
    'Q1', 'Q2', 'Q3', 'A12', 'K', 'VP', 'IQC', 'WO'
  ];

  constructor(
    private materialService: MaterialLifecycleService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadInventory();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private loadInventory(): void {
    this.loading = true;
    this.materials$ = this.materialService.getMaterials();
    
    const materialsSub = this.materials$.subscribe({
      next: (materials) => {
        this.materials = materials;
        this.applyFilters();
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open('Error loading inventory data', 'Close', { duration: 3000 });
        console.error('Error loading materials:', error);
      }
    });
    
    this.subscriptions.push(materialsSub);
  }

  applyFilters(): void {
    let filtered = [...this.materials];

    // Search filter
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(material =>
        material.materialCode.toLowerCase().includes(term) ||
        material.materialName.toLowerCase().includes(term) ||
        material.batchNumber.toLowerCase().includes(term) ||
        material.supplier.toLowerCase().includes(term)
      );
    }

    // Status filter
    if (this.selectedStatus) {
      filtered = filtered.filter(material => material.status === this.selectedStatus);
    }

    // Location filter
    if (this.selectedLocation) {
      filtered = filtered.filter(material => material.location === this.selectedLocation);
    }

    // Alert level filter
    if (this.selectedAlertLevel) {
      filtered = filtered.filter(material => material.alertLevel === this.selectedAlertLevel);
    }

    this.filteredMaterials = filtered;
  }

  onSearch(): void {
    this.applyFilters();
  }

  onStatusChange(): void {
    this.applyFilters();
  }

  onLocationChange(): void {
    this.applyFilters();
  }

  onAlertLevelChange(): void {
    this.applyFilters();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.selectedLocation = '';
    this.selectedAlertLevel = '';
    this.applyFilters();
  }

  refreshData(): void {
    this.loadInventory();
    this.snackBar.open('Inventory data refreshed', 'Close', { duration: 2000 });
  }

  getStatusBadgeClass(status: MaterialStatus): string {
    switch (status) {
      case MaterialStatus.ACTIVE:
        return 'badge-success';
      case MaterialStatus.EXPIRING_SOON:
        return 'badge-warning';
      case MaterialStatus.EXPIRED:
        return 'badge-danger';
      case MaterialStatus.QUARANTINE:
        return 'badge-secondary';
      case MaterialStatus.CONSUMED:
        return 'badge-info';
      default:
        return 'badge-light';
    }
  }

  getAlertLevelClass(alertLevel: AlertLevel): string {
    switch (alertLevel) {
      case AlertLevel.GREEN:
        return 'badge-success';
      case AlertLevel.YELLOW:
        return 'badge-warning';
      case AlertLevel.RED:
        return 'badge-danger';
      default:
        return 'badge-info';
    }
  }

  getDaysUntilExpiry(expiryDate: Date): number {
    const today = new Date();
    const expiry = new Date(expiryDate);
    return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  getDaysUntilExpiryClass(expiryDate: Date): string {
    const days = this.getDaysUntilExpiry(expiryDate);
    if (days < 0) return 'text-danger';
    if (days <= 7) return 'text-danger';
    if (days <= 30) return 'text-warning';
    return 'text-success';
  }

  isExpired(expiryDate: Date): boolean {
    return this.getDaysUntilExpiry(expiryDate) < 0;
  }

  isNotExpired(expiryDate: Date): boolean {
    return this.getDaysUntilExpiry(expiryDate) >= 0;
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString();
  }

  getTotalQuantity(): number {
    return this.filteredMaterials.reduce((total, material) => total + material.quantity, 0);
  }

  getTotalValue(): number {
    // Assuming you have price per unit in the future
    return this.filteredMaterials.length;
  }

  getAlertItemsCount(): number {
    return this.filteredMaterials.filter(m => m.alertLevel === AlertLevel.RED).length;
  }

  getActiveLocationsCount(): number {
    return Object.keys(this.getLocationCounts()).length;
  }

  isYellowAlert(material: MaterialLifecycle): boolean {
    return material.alertLevel === AlertLevel.YELLOW;
  }

  isRedAlert(material: MaterialLifecycle): boolean {
    return material.alertLevel === AlertLevel.RED;
  }

  isGreenAlert(material: MaterialLifecycle): boolean {
    return material.alertLevel === AlertLevel.GREEN;
  }

  getLocationCounts(): { [key: string]: number } {
    const counts: { [key: string]: number } = {};
    this.filteredMaterials.forEach(material => {
      counts[material.location] = (counts[material.location] || 0) + material.quantity;
    });
    return counts;
  }

  getLocationKeys(): string[] {
    return Object.keys(this.getLocationCounts());
  }

  getLocationCount(location: string): number {
    return this.getLocationCounts()[location] || 0;
  }

  exportToCSV(): void {
    const headers = ['Code', 'Name', 'Batch', 'Location', 'Quantity', 'Unit', 'Expiry Date', 'Status', 'Supplier'];
    const csvData = this.filteredMaterials.map(material => [
      material.materialCode,
      material.materialName,
      material.batchNumber,
      material.location,
      material.quantity,
      material.unitOfMeasure,
      this.formatDate(material.expiryDate),
      material.status,
      material.supplier
    ]);

    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `materials-inventory-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }
}
