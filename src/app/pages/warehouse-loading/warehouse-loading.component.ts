import { Component, OnInit, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';

interface LocationStats {
  location: string;
  normalizedLocation: string; // Vị trí đã chuẩn hóa (3 hoặc 4 chữ)
  warehouseType: 'Kho thường' | 'Kho lạnh'; // Phân loại kho
  totalItems: number;
  totalQuantity: number;
  materials: string[]; // List of material codes
  originalLocations: string[]; // Danh sách vị trí gốc được gom lại
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
  
  // Separated location stats by warehouse type
  normalWarehouseStats: LocationStats[] = [];
  coldWarehouseStats: LocationStats[] = [];
  
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

  // 🔧 FIX: Chuẩn hóa vị trí theo quy tắc mới
  private normalizeLocation(location: string): { normalized: string; warehouseType: 'Kho thường' | 'Kho lạnh' } {
    if (!location || location.trim() === '') {
      return { normalized: 'Unknown', warehouseType: 'Kho thường' };
    }

    // Loại bỏ khoảng trắng và chuyển thành chữ hoa
    const cleanLocation = location.trim().toUpperCase();
    
    // Lấy ký tự đầu tiên
    const firstChar = cleanLocation.charAt(0);
    
    // 🔧 FIX: Bỏ tất cả dấu chấm, dấu phẩy, dấu đóng mở ngoặc và khoảng trắng
    const withoutSpecialChars = cleanLocation.replace(/[.,()\[\]\s]/g, '');
    
    // 🔧 FIX: Xử lý đặc biệt cho K và J - chỉ lấy ký tự K hoặc J
    if (firstChar === 'K' || firstChar === 'J') {
      const normalized = firstChar;
      const warehouseType = 'Kho lạnh'; // K và J là kho lạnh
      console.log(`📍 Normalized (Special): "${location}" → "${normalized}" (${warehouseType})`);
      return { normalized, warehouseType };
    }
    
    // Xác định loại kho và số ký tự cần lấy
    // A-G: Kho thường (3 ký tự)
    // H-W (trừ K, J): Kho lạnh (4 ký tự chữ và số)
    const isNormalWarehouse = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(firstChar);
    const charCount = isNormalWarehouse ? 3 : 4;
    
    // Lấy số ký tự đầu tiên (chữ và số) sau khi đã bỏ dấu đặc biệt
    let normalized = '';
    let charCountCollected = 0;
    
    for (let i = 0; i < withoutSpecialChars.length && charCountCollected < charCount; i++) {
      const char = withoutSpecialChars[i];
      // Chỉ lấy chữ và số
      if (/[A-Z0-9]/.test(char)) {
        normalized += char;
        charCountCollected++;
      }
    }
    
    // Đảm bảo có đủ ký tự (nếu thiếu thì pad với số 0)
    if (normalized.length < charCount) {
      normalized = normalized.padEnd(charCount, '0');
    }
    
    const warehouseType = isNormalWarehouse ? 'Kho thường' : 'Kho lạnh';
    
    console.log(`📍 Normalized: "${location}" → "${normalized}" (${warehouseType}, ${charCount} chars)`);
    
    return { normalized, warehouseType };
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

      // 🔧 FIX: Process data với chuẩn hóa vị trí và gom nhóm
      const locationMap = new Map<string, LocationStats>();
      let totalQuantity = 0;

      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const originalLocation = data.location || 'Unknown';
        const materialCode = data.materialCode || '';
        const quantity = data.quantity || 0;

        totalQuantity += quantity;

        // Chuẩn hóa vị trí
        const { normalized, warehouseType } = this.normalizeLocation(originalLocation);
        
        // Sử dụng vị trí đã chuẩn hóa làm key
        if (!locationMap.has(normalized)) {
          locationMap.set(normalized, {
            location: normalized, // Hiển thị vị trí đã chuẩn hóa
            normalizedLocation: normalized,
            warehouseType: warehouseType,
            totalItems: 0,
            totalQuantity: 0,
            materials: [],
            originalLocations: [] // Lưu danh sách vị trí gốc
          });
        }

        const stats = locationMap.get(normalized)!;
        stats.totalItems++;
        stats.totalQuantity += quantity;
        if (!stats.materials.includes(materialCode)) {
          stats.materials.push(materialCode);
        }
        // Thêm vị trí gốc vào danh sách (không trùng lặp)
        if (!stats.originalLocations.includes(originalLocation)) {
          stats.originalLocations.push(originalLocation);
        }
      });

      // Convert to array and sort
      const locationStats = Array.from(locationMap.values())
        .sort((a, b) => {
          // Sắp xếp theo loại kho trước (Kho thường trước, Kho lạnh sau)
          if (a.warehouseType !== b.warehouseType) {
            return a.warehouseType === 'Kho thường' ? -1 : 1;
          }
          // Sau đó sắp xếp theo ABC (theo vị trí)
          return a.location.localeCompare(b.location);
        });

      // Calculate stats
      const usedLocations = locationStats.length;
      
      // Estimate total locations (you can configure this based on actual warehouse)
      // For now, let's assume total possible locations
      const totalLocations = this.estimateTotalLocations(usedLocations);
      const emptyLocations = totalLocations - usedLocations;
      const utilizationRate = totalLocations > 0 ? (usedLocations / totalLocations) * 100 : 0;

      // Separate by warehouse type
      this.normalWarehouseStats = locationStats
        .filter(stat => stat.warehouseType === 'Kho thường')
        .sort((a, b) => a.location.localeCompare(b.location)); // Sort ABC
      
      this.coldWarehouseStats = locationStats
        .filter(stat => stat.warehouseType === 'Kho lạnh')
        .sort((a, b) => a.location.localeCompare(b.location)); // Sort ABC

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
        'Vị trí (đã gom)': stat.location,
        'Loại kho': stat.warehouseType,
        'Số lượng mã hàng': stat.totalItems,
        'Tổng số lượng': stat.totalQuantity,
        'Vị trí gốc': stat.originalLocations.join(', '),
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
    this.normalWarehouseStats = [];
    this.coldWarehouseStats = [];
  }
}

