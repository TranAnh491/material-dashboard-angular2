import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GoogleSheetService, MaterialsLifecycleItem } from '../../services/google-sheet.service';

@Component({
  selector: 'app-shelf-life',
  templateUrl: './shelf-life.component.html',
  styleUrls: ['./shelf-life.component.scss']
})
export class ShelfLifeComponent implements OnInit, OnDestroy {
  
  // Data properties
  materialsData: MaterialsLifecycleItem[] = [];
  filteredMaterials: MaterialsLifecycleItem[] = [];
  
  // Loading and status
  isLoading = false;
  lastSyncTime: Date | null = null;
  
  // Search and filter
  searchTerm = '';
  sortBy = 'materialCode';
  sortDirection: 'asc' | 'desc' = 'asc';
  
  // Statistics will be calculated via getters
  
  private subscriptions: Subscription[] = [];

  constructor(
    private googleSheetService: GoogleSheetService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadMaterialsData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  // Load materials data from Google Sheets
  async loadMaterialsData(): Promise<void> {
    try {
      this.isLoading = true;
      console.log('🔄 Loading Materials Lifecycle data...');
      
      const subscription = this.googleSheetService.fetchMaterialsLifecycleData().subscribe({
        next: (data) => {
          this.materialsData = data;
          this.filteredMaterials = [...data];
          this.lastSyncTime = new Date();
          
      this.snackBar.open(
            `Loaded ${data.length} materials successfully`,
        'Close',
            {
              duration: 3000,
              panelClass: ['success-snackbar']
            }
          );
        },
        error: (error) => {
          console.error('❌ Error loading materials:', error);
          this.snackBar.open(
            'Error loading materials data. Please try again.',
            'Close',
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
        },
        complete: () => {
          this.isLoading = false;
        }
      });
      
      this.subscriptions.push(subscription);
      
    } catch (error) {
      console.error('❌ Error in loadMaterialsData:', error);
      this.isLoading = false;
    }
  }

  // Apply search and sort filters
  applyFilters(): void {
    let filtered = [...this.materialsData];

    // Apply search filter
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase().trim();
      filtered = filtered.filter(material =>
        material.materialCode.toLowerCase().includes(term) ||
        material.description.toLowerCase().includes(term) ||
        material.poNumber.toLowerCase().includes(term)
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (this.sortBy) {
        case 'materialCode':
          aValue = a.materialCode;
          bValue = b.materialCode;
          break;
        case 'description':
          aValue = a.description;
          bValue = b.description;
          break;
        case 'stockQuantity':
          aValue = a.stockQuantity;
          bValue = b.stockQuantity;
          break;
        case 'ageInMonths':
          aValue = a.ageInMonths;
          bValue = b.ageInMonths;
          break;
        case 'expiryDate':
          // Sắp xếp theo hạn sử dụng
          aValue = a.expiryDate ? a.expiryDate.getTime() : 0;
          bValue = b.expiryDate ? b.expiryDate.getTime() : 0;
          break;
        case 'shelfLifeMonths':
          // Sắp xếp theo shelf life (tháng)
          aValue = a.shelfLifeMonths;
          bValue = b.shelfLifeMonths;
          break;

        default:
          aValue = a[this.sortBy];
          bValue = b[this.sortBy];
      }
      
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (aValue < bValue) return this.sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    this.filteredMaterials = filtered;
  }

  // Statistics are now calculated automatically via getters

  // Event handlers
  onSearch(): void {
    this.applyFilters();
  }

  onSort(column: string): void {
    if (this.sortBy === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = column;
      this.sortDirection = 'asc';
    }
    this.applyFilters();
  }

  onRefresh(): void {
    this.loadMaterialsData();
  }

  // Sync data to Firebase (if needed in the future)
  async syncToFirebase(): Promise<void> {
    try {
      this.isLoading = true;
      const result = await this.googleSheetService.syncMaterialsLifecycleToFirebase();
      
      if (result.success) {
        this.snackBar.open(
          `Sync successful: ${result.data?.totalProcessed || 0} materials synced to Firebase`,
          'Close',
          {
            duration: 3000,
            panelClass: ['success-snackbar']
          }
        );
      } else {
        this.snackBar.open(
          `Sync failed: ${result.message}`,
          'Close',
          {
            duration: 5000,
            panelClass: ['error-snackbar']
          }
        );
      }
    } catch (error) {
      console.error('❌ Error syncing to Firebase:', error);
      this.snackBar.open('Error syncing to Firebase', 'Close', { duration: 5000 });
    } finally {
      this.isLoading = false;
    }
  }

  // Utility method to get material status
  getMaterialStatus(material: MaterialsLifecycleItem): 'good' | 'warning' | 'critical' | 'expired' {
    // Nếu có hạn sử dụng (expiryDate) thì tính theo ngày
    if (material.expiryDate) {
      const daysRemaining = this.getDaysRemaining(material.expiryDate);
      
      if (daysRemaining < 0) {
        return 'expired'; // Quá hạn
      } else if (daysRemaining <= 7) {
        return 'critical'; // Sắp hết hạn (7 ngày)
      } else if (daysRemaining <= 30) {
        return 'warning'; // Cảnh báo (30 ngày)
        } else {
        return 'good'; // Còn tốt
      }
    }
    
    // Nếu không có hạn sử dụng nhưng có shelf life thì tính theo tháng
    if (material.shelfLifeMonths > 0) {
      const agePercentage = (material.ageInMonths / material.shelfLifeMonths) * 100;
      
      if (agePercentage >= 100) {
        return 'expired'; // Quá hạn
      } else if (agePercentage >= 90) {
        return 'critical'; // Sắp hết hạn (90% tuổi)
      } else if (agePercentage >= 70) {
        return 'warning'; // Cảnh báo (70% tuổi)
      } else {
        return 'good'; // Còn tốt
      }
    }
    
    // Trường hợp không có dữ liệu
    return 'good';
  }

  // Get days remaining or overdue
  getDaysRemaining(expiryDate: Date): number {
    const today = new Date();
    const timeDiff = expiryDate.getTime() - today.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  // Format remaining time in English
  formatRemainingTime(material: MaterialsLifecycleItem): string {
    if (!material.expiryDate) return 'No expiry date';
    
    const daysRemaining = this.getDaysRemaining(material.expiryDate);
    
    if (daysRemaining < 0) {
      return `${Math.abs(daysRemaining)} days overdue`;
    } else if (daysRemaining === 0) {
      return 'Expires today';
    } else {
      return `${daysRemaining} days left`;
    }
  }

  // Format shelf life display
  formatShelfLife(material: MaterialsLifecycleItem): string {
    return `${material.shelfLifeMonths} months`;
  }

  // Format expiry date display
  formatExpiryDate(material: MaterialsLifecycleItem): string {
    if (!material.expiryDate) return 'N/A';
    return material.expiryDate.toLocaleDateString('en-US');
  }

  // Calculate progress percentage (0-100)
  getProgressPercentage(material: MaterialsLifecycleItem): number {
    // Nếu có hạn sử dụng thì tính theo ngày
    if (material.expiryDate) {
      const daysRemaining = this.getDaysRemaining(material.expiryDate);
      const totalShelfLifeDays = material.shelfLifeMonths * 30; // Ước tính 30 ngày/tháng
      
      if (daysRemaining < 0) return 100; // Quá hạn = 100%
      
      const usedDays = totalShelfLifeDays - daysRemaining;
      const percentage = (usedDays / totalShelfLifeDays) * 100;
      
      return Math.max(0, Math.min(100, percentage));
    }
    
    // Nếu không có hạn sử dụng thì tính theo tuổi hàng vs shelf life
    if (material.shelfLifeMonths > 0) {
      const agePercentage = (material.ageInMonths / material.shelfLifeMonths) * 100;
      return Math.max(0, Math.min(100, agePercentage));
    }
    
    return 0;
  }

  // Get status text in English
  getStatusText(status: 'good' | 'warning' | 'critical' | 'expired'): string {
    switch (status) {
      case 'good': return 'Good';
      case 'warning': return 'Warning';
      case 'critical': return 'Critical';
      case 'expired': return 'Expired';
      default: return 'Unknown';
    }
  }

  // Get status display content for table
  getStatusDisplay(material: MaterialsLifecycleItem): string {
    // Nếu có hạn sử dụng thì hiển thị số ngày
    if (material.expiryDate) {
      return this.formatRemainingTime(material);
    }
    
    // Nếu không có hạn sử dụng thì hiển thị % tuổi hàng
    if (material.shelfLifeMonths > 0) {
      const agePercentage = (material.ageInMonths / material.shelfLifeMonths) * 100;
      const remaining = Math.max(0, material.shelfLifeMonths - material.ageInMonths);
      
      if (agePercentage >= 100) {
        return 'Expired';
      } else {
        return `Remaining ${remaining.toFixed(1)} months`;
      }
    }
    
    return 'No data';
  }

  // Check if material has expiry date (to determine display type)
  hasExpiryDate(material: MaterialsLifecycleItem): boolean {
    return !!material.expiryDate;
  }

  // Utility method for date formatting
  formatDate(date: Date | null): string {
    if (!date) return 'Never';
    return date.toLocaleDateString('en-US') + ' ' + date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Getters for template
  get totalMaterials(): number {
    return this.materialsData.length;
  }

  get materialsWithExpiryDate(): number {
    return this.materialsData.filter(material => !!material.expiryDate).length;
  }

  get averageAge(): number {
    if (this.materialsData.length === 0) return 0;
    const totalAge = this.materialsData.reduce((sum, material) => sum + material.ageInMonths, 0);
    return totalAge / this.materialsData.length;
  }

  get criticalItems(): number {
    return this.materialsData.filter(material => {
      const status = this.getMaterialStatus(material);
      return status === 'critical' || status === 'expired';
    }).length;
  }

}
