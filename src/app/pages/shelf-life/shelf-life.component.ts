import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Observable, Subscription, combineLatest } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { 
  MaterialLifecycle, 
  MaterialAlert, 
  MaterialStatus, 
  AlertLevel, 
  TransactionType 
} from '../../models/material-lifecycle.model';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';

@Component({
  selector: 'app-shelf-life',
  templateUrl: './shelf-life.component.html',
  styleUrls: ['./shelf-life.component.scss']
})
export class ShelfLifeComponent implements OnInit, OnDestroy {
  materials$: Observable<MaterialLifecycle[]>;
  alerts$: Observable<MaterialAlert[]>;
  summary$: Observable<any>;
  
  materials: MaterialLifecycle[] = [];
  filteredMaterials: MaterialLifecycle[] = [];
  alerts: MaterialAlert[] = [];
  summary: any = {};
  
  searchTerm = '';
  selectedStatus = '';
  selectedLocation = '';
  showAddForm = false;
  editingMaterial: MaterialLifecycle | null = null;
  
  materialForm: FormGroup;
  
  // Enums for template
  MaterialStatus = MaterialStatus;
  AlertLevel = AlertLevel;
  
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
    private fb: FormBuilder,
    private snackBar: MatSnackBar
  ) {
    this.initializeForm();
  }

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeForm(): void {
    this.materialForm = this.fb.group({
      materialCode: ['', [Validators.required]],
      materialName: ['', [Validators.required]],
      batchNumber: ['', [Validators.required]],
      expiryDate: ['', [Validators.required]],
      manufacturingDate: ['', [Validators.required]],
      location: ['', [Validators.required]],
      quantity: ['', [Validators.required, Validators.min(0)]],
      supplier: ['', [Validators.required]],
      costCenter: ['', [Validators.required]],
      unitOfMeasure: ['', [Validators.required]],
      notes: ['']
    });
  }

  private loadData(): void {
    // Load materials
    this.materials$ = this.materialService.getMaterials();
    const materialsSub = this.materials$.subscribe(materials => {
      this.materials = materials;
      this.applyFilters();
    });
    this.subscriptions.push(materialsSub);

    // Load alerts
    this.alerts$ = this.materialService.getUnreadAlerts();
    const alertsSub = this.alerts$.subscribe(alerts => {
      this.alerts = alerts;
    });
    this.subscriptions.push(alertsSub);

    // Load summary
    this.summary$ = this.materialService.getMaterialsSummary();
    const summarySub = this.summary$.subscribe(summary => {
      this.summary = summary;
    });
    this.subscriptions.push(summarySub);
  }

  applyFilters(): void {
    let filtered = [...this.materials];

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(material =>
        material.materialCode.toLowerCase().includes(term) ||
        material.materialName.toLowerCase().includes(term) ||
        material.batchNumber.toLowerCase().includes(term)
      );
    }

    if (this.selectedStatus) {
      filtered = filtered.filter(material => material.status === this.selectedStatus);
    }

    if (this.selectedLocation) {
      filtered = filtered.filter(material => material.location === this.selectedLocation);
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

  showAddMaterialForm(): void {
    this.showAddForm = true;
    this.editingMaterial = null;
    this.materialForm.reset();
  }

  editMaterial(material: MaterialLifecycle): void {
    this.editingMaterial = material;
    this.showAddForm = true;
    
    // Convert dates for form
    const expiryDate = new Date(material.expiryDate);
    const manufacturingDate = new Date(material.manufacturingDate);
    
    this.materialForm.patchValue({
      ...material,
      expiryDate: expiryDate.toISOString().split('T')[0],
      manufacturingDate: manufacturingDate.toISOString().split('T')[0]
    });
  }

  cancelForm(): void {
    this.showAddForm = false;
    this.editingMaterial = null;
    this.materialForm.reset();
  }

  async saveMaterial(): Promise<void> {
    if (this.materialForm.valid) {
      try {
        const formValue = this.materialForm.value;
        const materialData: MaterialLifecycle = {
          ...formValue,
          expiryDate: new Date(formValue.expiryDate),
          manufacturingDate: new Date(formValue.manufacturingDate),
          createdBy: 'Current User' // Replace with actual user
        };

        if (this.editingMaterial) {
          await this.materialService.updateMaterial(this.editingMaterial.id!, materialData);
          this.snackBar.open('Material updated successfully', 'Close', { duration: 3000 });
        } else {
          await this.materialService.addMaterial(materialData);
          this.snackBar.open('Material added successfully', 'Close', { duration: 3000 });
        }

        this.cancelForm();
      } catch (error) {
        this.snackBar.open('Error saving material', 'Close', { duration: 3000 });
        console.error('Error saving material:', error);
      }
    }
  }

  async deleteMaterial(material: MaterialLifecycle): Promise<void> {
    if (confirm(`Are you sure you want to delete ${material.materialCode}?`)) {
      try {
        await this.materialService.deleteMaterial(material.id!);
        this.snackBar.open('Material deleted successfully', 'Close', { duration: 3000 });
      } catch (error) {
        this.snackBar.open('Error deleting material', 'Close', { duration: 3000 });
        console.error('Error deleting material:', error);
      }
    }
  }

  async markAlertAsRead(alert: MaterialAlert): Promise<void> {
    try {
      await this.materialService.markAlertAsRead(alert.id!);
    } catch (error) {
      console.error('Error marking alert as read:', error);
    }
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
        return 'alert-success';
      case AlertLevel.YELLOW:
        return 'alert-warning';
      case AlertLevel.RED:
        return 'alert-danger';
      default:
        return 'alert-info';
    }
  }

  getDaysUntilExpiry(expiryDate: Date): number {
    const today = new Date();
    const expiry = new Date(expiryDate);
    return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString();
  }
}
