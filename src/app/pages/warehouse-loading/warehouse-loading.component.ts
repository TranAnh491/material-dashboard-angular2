import { Component, OnInit, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';

interface LocationStats {
  location: string;
  totalItems: number;
  totalQuantity: number;
  materials: string[]; // List of material codes
}

interface WarehouseStats {
  totalLocations: number;
  usedLocations: number;
  emptyLocations: number;
  utilizationRate: number;
  totalMaterials: number;
  totalQuantity: number;
  locationStats: LocationStats[];
}

@Component({
  selector: 'app-warehouse-loading',
  templateUrl: './warehouse-loading.component.html',
  styleUrls: ['./warehouse-loading.component.scss']
})
export class WarehouseLoadingComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  // Factory selection
  selectedFactory: 'ASM1' | 'ASM2' | null = null;
  
  // Data
  warehouseStats: WarehouseStats | null = null;
  isLoading = false;
  
  // Chart data
  chartLabels: string[] = [];
  chartData: number[] = [];
  
  constructor(
    private firestore: AngularFirestore
  ) {}

  ngOnInit(): void {
    console.log('🏭 Warehouse Loading component initialized');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Select factory and load data
  selectFactory(factory: 'ASM1' | 'ASM2'): void {
    this.selectedFactory = factory;
    console.log(`📍 Factory selected: ${factory}`);
    this.loadWarehouseData();
  }

  // Load warehouse data from Firebase
  private async loadWarehouseData(): Promise<void> {
    if (!this.selectedFactory) return;

    this.isLoading = true;
    console.log(`📦 Loading warehouse data for ${this.selectedFactory}...`);

    try {
      // Load all inventory materials for selected factory
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        console.log(`⚠️ No data found for ${this.selectedFactory}`);
        this.warehouseStats = null;
        this.isLoading = false;
        return;
      }

      console.log(`✅ Loaded ${snapshot.docs.length} materials from ${this.selectedFactory}`);

      // Process data
      const locationMap = new Map<string, LocationStats>();
      let totalQuantity = 0;

      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const location = data.location || 'Unknown';
        const materialCode = data.materialCode || '';
        const quantity = data.quantity || 0;

        totalQuantity += quantity;

        if (!locationMap.has(location)) {
          locationMap.set(location, {
            location: location,
            totalItems: 0,
            totalQuantity: 0,
            materials: []
          });
        }

        const stats = locationMap.get(location)!;
        stats.totalItems++;
        stats.totalQuantity += quantity;
        if (!stats.materials.includes(materialCode)) {
          stats.materials.push(materialCode);
        }
      });

      // Convert to array and sort
      const locationStats = Array.from(locationMap.values())
        .sort((a, b) => b.totalItems - a.totalItems);

      // Calculate stats
      const usedLocations = locationStats.length;
      
      // Estimate total locations (you can configure this based on actual warehouse)
      // For now, let's assume total possible locations
      const totalLocations = this.estimateTotalLocations(usedLocations);
      const emptyLocations = totalLocations - usedLocations;
      const utilizationRate = totalLocations > 0 ? (usedLocations / totalLocations) * 100 : 0;

      this.warehouseStats = {
        totalLocations: totalLocations,
        usedLocations: usedLocations,
        emptyLocations: emptyLocations,
        utilizationRate: utilizationRate,
        totalMaterials: snapshot.docs.length,
        totalQuantity: totalQuantity,
        locationStats: locationStats
      };

      // Prepare chart data (top 20 locations)
      this.prepareChartData(locationStats.slice(0, 20));

      console.log('✅ Warehouse stats calculated:', this.warehouseStats);

    } catch (error) {
      console.error('❌ Error loading warehouse data:', error);
      alert(`❌ Lỗi khi tải dữ liệu: ${error.message}`);
    } finally {
      this.isLoading = false;
    }
  }

  // Estimate total locations based on naming pattern
  private estimateTotalLocations(usedLocations: number): number {
    // This is a simple estimation
    // You can customize this based on your actual warehouse layout
    // For example: if locations are like T1.1(L), T1.1(R), T1.2(L), etc.
    
    // For now, let's assume total capacity is 150% of used locations
    // Or set a fixed number like 200, 300, etc.
    const estimatedTotal = Math.max(usedLocations * 1.5, usedLocations + 50);
    return Math.ceil(estimatedTotal);
  }

  // Prepare data for charts
  private prepareChartData(topLocations: LocationStats[]): void {
    this.chartLabels = topLocations.map(stat => stat.location);
    this.chartData = topLocations.map(stat => stat.totalItems);
  }

  // Export to Excel
  exportToExcel(): void {
    if (!this.warehouseStats || !this.selectedFactory) {
      alert('❌ Không có dữ liệu để export');
      return;
    }

    try {
      // Prepare data for Excel
      const excelData = this.warehouseStats.locationStats.map(stat => ({
        'Vị trí': stat.location,
        'Số lượng mã hàng': stat.totalItems,
        'Tổng số lượng': stat.totalQuantity,
        'Mã hàng': stat.materials.join(', ')
      }));

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      
      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Warehouse Loading');

      // Generate filename
      const filename = `Warehouse_Loading_${this.selectedFactory}_${new Date().toISOString().split('T')[0]}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);

      console.log(`✅ Exported warehouse loading report: ${filename}`);

    } catch (error) {
      console.error('❌ Error exporting to Excel:', error);
      alert(`❌ Lỗi khi export: ${error.message}`);
    }
  }

  // Back to factory selection
  backToSelection(): void {
    this.selectedFactory = null;
    this.warehouseStats = null;
    this.chartLabels = [];
    this.chartData = [];
  }
}

