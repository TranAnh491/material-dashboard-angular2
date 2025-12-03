import { Component, OnInit, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';

export interface InventoryMaterial {
  id?: string;
  factory?: string;
  importDate: Date;
  batchNumber: string;
  materialCode: string;
  poNumber: string;
  openingStock: number | null;
  quantity: number;
  exported?: number;
  xt?: number;
  location: string;
  standardPacking?: number;
  unitWeight?: number;
}

export interface MaterialSummary {
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  standardPacking: number;
  unitWeight: number; // Thêm unitWeight để tính totalWeight đúng
  numberOfRolls: number; // Tổng số cuộn (giữ lại để tính tổng)
  evenRolls: number; // Cuộn chẵn (phần nguyên)
  oddRolls: number; // Cuộn lẻ (phần thập phân)
  oddQuantity: number; // Lượng lẻ = cuộn lẻ × standard packing
  totalWeight: number;
  locations: string[]; // Danh sách các vị trí
  lastActionDate: Date | null; // Ngày import/cập nhật gần nhất
  lastActivity: MaterialActivity | null; // Hoạt động gần nhất
  materialValue?: number; // Giá trị = stock * unitPrice
  unitPrice?: number; // Đơn giá đơn vị từ file import
}

export interface MaterialActivity {
  id?: string;
  materialCode: string;
  poNumber?: string;
  activityType: 'INBOUND' | 'OUTBOUND' | 'LOCATION_CHANGE';
  activityDate: Date;
  quantity?: number;
  location?: string;
  previousLocation?: string;
  newLocation?: string;
  factory?: string;
  performedBy?: string;
  notes?: string;
}

export interface MaterialPrice {
  materialCode: string;
  materialName: string;
  unit: string; // Đvt
  endingStock: number; // Tồn cuối kỳ
  endingBalance: number; // Số dư cuối kỳ
  unitPrice: number; // Đơn giá đơn vị = Số dư cuối kỳ / Tồn cuối kỳ
  importedAt: Date;
}

@Component({
  selector: 'app-manage',
  templateUrl: './manage.component.html',
  styleUrls: ['./manage.component.scss']
})
export class ManageComponent implements OnInit, OnDestroy {
  selectedFactory: string = 'ASM1';
  materialCode: string = '';
  locationSearch: string = '';
  materials: InventoryMaterial[] = [];
  summaryData: MaterialSummary[] = [];
  isLoading: boolean = false;
  catalogCache: Map<string, { unitWeight: number, standardPacking: number }> = new Map();
  
  // Modal for location details
  showLocationModal: boolean = false;
  selectedLocation: string = '';
  locationMaterials: InventoryMaterial[] = [];
  
  // Activity History
  activityHistory: MaterialActivity[] = [];
  isLoadingActivities: boolean = false;
  showActivityHistory: boolean = false;
  activityLimit: number = 50; // Số lượng hoạt động hiển thị
  
  // Material Prices
  materialPrices: Map<string, MaterialPrice> = new Map();
  topFilter: number | null = null; // null, 20, 30, 50
  originalSummaryData: MaterialSummary[] = []; // Lưu dữ liệu gốc để filter
  
  // Password protection
  showPasswordModal: boolean = true;
  password: string = '';
  passwordError: string = '';
  private readonly CORRECT_PASSWORD = '0110';
  
  // Tổng số cuộn
  get totalEvenRolls(): number {
    return this.summaryData.reduce((sum, item) => sum + item.evenRolls, 0);
  }
  
  get totalOddRolls(): number {
    return this.summaryData.reduce((sum, item) => sum + item.oddRolls, 0);
  }
  
  private destroy$ = new Subject<void>();

  constructor(private firestore: AngularFirestore) {}

  async ngOnInit(): Promise<void> {
    console.log('🚀 ManageComponent initialized');
    // Always show password modal when component initializes
    // Clear session storage to ensure password is required each time
    sessionStorage.removeItem('manage-password-entered');
    this.showPasswordModal = true;
    this.password = '';
    this.passwordError = '';
    
    // Load material prices
    await this.loadMaterialPrices();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load activity history for all materials
  async loadActivityHistory(): Promise<void> {
    this.isLoadingActivities = true;
    this.showActivityHistory = true;
    
    try {
      const activities: MaterialActivity[] = [];
      
      // Load Inbound activities
      const inboundSnapshot = await this.firestore.collection('inbound-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
          .where('isReceived', '==', true)
          .orderBy('updatedAt', 'desc')
          .limit(this.activityLimit)
      ).get().toPromise();
      
      if (inboundSnapshot) {
        inboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          const activityDate = data.updatedAt?.toDate ? data.updatedAt.toDate() : 
                              (data.updatedAt instanceof Date ? data.updatedAt : new Date(data.updatedAt));
          
          activities.push({
            id: doc.id,
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            activityType: 'INBOUND',
            activityDate: activityDate,
            quantity: data.quantity || 0,
            location: data.location || '',
            factory: data.factory || this.selectedFactory,
            performedBy: data.employeeIds?.[0] || 'System',
            notes: `Nhập kho - Lô: ${data.batchNumber || ''}`
          });
        });
      }
      
      // Load Outbound activities
      const outboundSnapshot = await this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
          .orderBy('exportDate', 'desc')
          .limit(this.activityLimit)
      ).get().toPromise();
      
      if (outboundSnapshot) {
        outboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          const activityDate = data.exportDate?.toDate ? data.exportDate.toDate() : 
                              (data.exportDate instanceof Date ? data.exportDate : new Date(data.exportDate));
          
          activities.push({
            id: doc.id,
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            activityType: 'OUTBOUND',
            activityDate: activityDate,
            quantity: data.exportQuantity || data.quantity || 0,
            location: data.location || '',
            factory: data.factory || this.selectedFactory,
            performedBy: data.exportedBy || data.employeeId || 'System',
            notes: `Xuất kho - PO: ${data.productionOrder || ''}`
          });
        });
      }
      
      // Load Location Change activities from inventory-materials
      // Note: Location changes are tracked via lastModified field in inventory-materials
      const inventorySnapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
          .where('lastModified', '!=', null)
          .orderBy('lastModified', 'desc')
          .limit(this.activityLimit)
      ).get().toPromise();
      
      if (inventorySnapshot) {
        inventorySnapshot.forEach(doc => {
          const data = doc.data() as any;
          if (data.lastModified && data.modifiedBy === 'location-change-scanner') {
            const activityDate = data.lastModified?.toDate ? data.lastModified.toDate() : 
                                (data.lastModified instanceof Date ? data.lastModified : new Date(data.lastModified));
            
            activities.push({
              id: doc.id,
              materialCode: data.materialCode || '',
              poNumber: data.poNumber || '',
              activityType: 'LOCATION_CHANGE',
              activityDate: activityDate,
              location: data.location || '',
              factory: data.factory || this.selectedFactory,
              performedBy: data.modifiedBy || 'System',
              notes: `Đổi vị trí sang: ${data.location || ''}`
            });
          }
        });
      }
      
      // Sort all activities by date (newest first)
      activities.sort((a, b) => b.activityDate.getTime() - a.activityDate.getTime());
      
      // Limit to most recent activities
      this.activityHistory = activities.slice(0, this.activityLimit);
      
      console.log(`✅ Loaded ${this.activityHistory.length} activities`);
    } catch (error) {
      console.error('❌ Error loading activity history:', error);
      alert('Lỗi khi tải lịch sử hoạt động: ' + error.message);
    } finally {
      this.isLoadingActivities = false;
    }
  }
  
  toggleActivityHistory(): void {
    this.showActivityHistory = !this.showActivityHistory;
    if (this.showActivityHistory && this.activityHistory.length === 0) {
      this.loadActivityHistory();
    }
  }
  
  getActivityTypeLabel(type: string): string {
    switch (type) {
      case 'INBOUND':
        return '📥 Nhập kho';
      case 'OUTBOUND':
        return '📤 Xuất kho';
      case 'LOCATION_CHANGE':
        return '📍 Đổi vị trí';
      default:
        return type;
    }
  }
  
  getActivityTypeClass(type: string): string {
    switch (type) {
      case 'INBOUND':
        return 'activity-inbound';
      case 'OUTBOUND':
        return 'activity-outbound';
      case 'LOCATION_CHANGE':
        return 'activity-location';
      default:
        return '';
    }
  }

  // Load last activity for each material in summary
  async loadLastActivitiesForSummary(): Promise<void> {
    try {
      // Load all recent activities and group by material code
      const activitiesByMaterial = new Map<string, MaterialActivity>();
      
      // Load inbound activities (simplified - get all, filter and sort in code)
      try {
        const inboundSnapshot = await this.firestore.collection('inbound-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
            .limit(500)
        ).get().toPromise();
        
        if (inboundSnapshot) {
          inboundSnapshot.forEach(doc => {
            const data = doc.data() as any;
            // Only process if isReceived is true
            if (!data.isReceived) return;
            
            const materialCode = (data.materialCode || '').toUpperCase().trim();
            if (!materialCode) return;
            
            const activityDate = data.updatedAt?.toDate ? data.updatedAt.toDate() : 
                                (data.updatedAt instanceof Date ? data.updatedAt : new Date(data.updatedAt));
            
            const key = materialCode;
            if (!activitiesByMaterial.has(key) || 
                activitiesByMaterial.get(key)!.activityDate < activityDate) {
              activitiesByMaterial.set(key, {
                id: doc.id,
                materialCode: materialCode,
                poNumber: data.poNumber || '',
                activityType: 'INBOUND',
                activityDate: activityDate,
                quantity: data.quantity || 0,
                location: data.location || '',
                factory: data.factory || this.selectedFactory,
                performedBy: data.employeeIds?.[0] || 'System',
                notes: `Nhập kho - Lô: ${data.batchNumber || ''}`
              });
            }
          });
        }
      } catch (error) {
        console.warn('⚠️ Could not load inbound activities:', error);
      }
      
      // Load outbound activities (get all, sort in code)
      try {
        const outboundSnapshot = await this.firestore.collection('outbound-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
            .limit(500)
        ).get().toPromise();
        
        if (outboundSnapshot) {
          outboundSnapshot.forEach(doc => {
            const data = doc.data() as any;
            const materialCode = (data.materialCode || '').toUpperCase().trim();
            if (!materialCode) return;
            
            const activityDate = data.exportDate?.toDate ? data.exportDate.toDate() : 
                                (data.exportDate instanceof Date ? data.exportDate : new Date(data.exportDate));
            
            const key = materialCode;
            const existing = activitiesByMaterial.get(key);
            if (!existing || existing.activityDate < activityDate) {
              activitiesByMaterial.set(key, {
                id: doc.id,
                materialCode: materialCode,
                poNumber: data.poNumber || '',
                activityType: 'OUTBOUND',
                activityDate: activityDate,
                quantity: data.exportQuantity || data.quantity || 0,
                location: data.location || '',
                factory: data.factory || this.selectedFactory,
                performedBy: data.exportedBy || data.employeeId || 'System',
                notes: `Xuất kho - PO: ${data.productionOrder || ''}`
              });
            }
          });
        }
      } catch (error) {
        console.warn('⚠️ Could not load outbound activities:', error);
      }
      
      // Map activities to summary items
      this.summaryData.forEach(item => {
        const activity = activitiesByMaterial.get(item.materialCode.toUpperCase().trim());
        item.lastActivity = activity || null;
      });
      
      console.log(`✅ Loaded activities for ${activitiesByMaterial.size} materials`);
    } catch (error) {
      console.error('❌ Error loading last activities:', error);
      // Don't throw - just log error, activities are optional
    }
  }

  onFactoryChange(): void {
    console.log('🏭 Factory changed to:', this.selectedFactory);
    if (this.materialCode.trim()) {
      this.searchMaterial();
    } else if (this.locationSearch.trim()) {
      this.searchByLocation();
    }
  }

  onMaterialCodeChange(): void {
    // Clear location search when searching by material code
    if (this.materialCode.trim()) {
      this.locationSearch = '';
      this.searchMaterial();
    } else {
      this.summaryData = [];
    }
  }

  onLocationSearch(): void {
    // Clear material code search when searching by location
    if (this.locationSearch.trim()) {
      this.materialCode = '';
      this.searchByLocation();
    } else {
      this.summaryData = [];
    }
  }

  async searchByLocation(): Promise<void> {
    if (!this.locationSearch.trim()) {
      this.summaryData = [];
      return;
    }

    this.isLoading = true;
    try {
      // Load catalog data
      await this.loadCatalogData();
      
      // Search by location
      console.log(`🔍 Searching in inventory-materials for factory: ${this.selectedFactory}, location: ${this.locationSearch}`);
      
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
          .where('location', '==', this.locationSearch.toUpperCase().trim())
      ).get().toPromise();

      this.materials = [];
      if (snapshot) {
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          const materialCode = data.materialCode.toUpperCase().trim();
          
          // Get unitWeight and standardPacking from catalog
          const catalogItem = this.catalogCache.get(materialCode);
          
          // Convert Firestore Timestamp to Date
          let importDate: Date;
          if (data.importDate) {
            if (data.importDate.toDate && typeof data.importDate.toDate === 'function') {
              importDate = data.importDate.toDate();
            } else if (data.importDate instanceof Date) {
              importDate = data.importDate;
            } else {
              importDate = new Date(data.importDate);
            }
          } else {
            importDate = new Date();
          }
          
           // Đảm bảo các field số được parse đúng
           const openingStock = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
           const quantity = Number(data.quantity) || 0;
           const exported = Number(data.exported) || 0;
           const xt = Number(data.xt) || 0;
           
           this.materials.push({
             id: doc.id,
             ...data,
             importDate: importDate,
             openingStock: openingStock,
             quantity: quantity,
             exported: exported,
             xt: xt,
             unitWeight: data.unitWeight || catalogItem?.unitWeight || 0,
             standardPacking: data.standardPacking || catalogItem?.standardPacking || 1
           });
           
           // Debug log để kiểm tra
           const calculatedStock = openingStock + quantity - exported - xt;
           console.log(`📊 Material ${materialCode}: openingStock=${openingStock}, quantity=${quantity}, exported=${exported}, xt=${xt}, stock=${calculatedStock}`);
         });
       }

       console.log(`✅ Found ${this.materials.length} records for location ${this.locationSearch}`);
      await this.calculateSummary();
    } catch (error) {
      console.error('❌ Error searching by location:', error);
      alert(`Lỗi khi tìm kiếm: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  async showLocationDetails(location: string): Promise<void> {
    this.selectedLocation = location;
    this.isLoading = true;
    try {
      // Load catalog data
      await this.loadCatalogData();
      
      // Get all materials at this location
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
          .where('location', '==', location.toUpperCase().trim())
      ).get().toPromise();

      this.locationMaterials = [];
      if (snapshot) {
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          const stock = (data.openingStock || 0) + (data.quantity || 0) - (data.exported || 0) - (data.xt || 0);
          
          // Only show materials with stock > 0
          if (stock > 0) {
            const materialCode = data.materialCode.toUpperCase().trim();
            const catalogItem = this.catalogCache.get(materialCode);
            
            // Convert Firestore Timestamp to Date
            let importDate: Date;
            if (data.importDate) {
              if (data.importDate.toDate && typeof data.importDate.toDate === 'function') {
                importDate = data.importDate.toDate();
              } else if (data.importDate instanceof Date) {
                importDate = data.importDate;
              } else {
                importDate = new Date(data.importDate);
              }
            } else {
              importDate = new Date();
            }
            
            this.locationMaterials.push({
              id: doc.id,
              ...data,
              importDate: importDate,
              unitWeight: data.unitWeight || catalogItem?.unitWeight || 0,
              standardPacking: data.standardPacking || catalogItem?.standardPacking || 1
            });
          }
        });
      }

      // Sort by material code
      this.locationMaterials.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
      
      this.showLocationModal = true;
      console.log(`✅ Found ${this.locationMaterials.length} materials at location ${location}`);
    } catch (error) {
      console.error('❌ Error loading location details:', error);
      alert(`Lỗi khi tải chi tiết vị trí: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  closeLocationModal(): void {
    this.showLocationModal = false;
    this.selectedLocation = '';
    this.locationMaterials = [];
  }

  async searchMaterial(): Promise<void> {
    if (!this.materialCode.trim()) {
      this.summaryData = [];
      return;
    }

    this.isLoading = true;
    try {
      // Load catalog data for unitWeight and standardPacking (giống tab utilization)
      await this.loadCatalogData();
      
      // Load từ inventory-materials (giống tab materials-asm1)
      console.log(`🔍 Searching in inventory-materials for factory: ${this.selectedFactory}, material: ${this.materialCode}`);
      
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
          .where('materialCode', '==', this.materialCode.toUpperCase().trim())
      ).get().toPromise();

       this.materials = [];
       if (snapshot) {
         snapshot.forEach(doc => {
           const data = doc.data() as any;
           const materialCode = data.materialCode.toUpperCase().trim();
           
           // Get unitWeight and standardPacking from catalog
           const catalogItem = this.catalogCache.get(materialCode);
           
           // Convert Firestore Timestamp to Date
           let importDate: Date;
           if (data.importDate) {
             if (data.importDate.toDate && typeof data.importDate.toDate === 'function') {
               importDate = data.importDate.toDate();
             } else if (data.importDate instanceof Date) {
               importDate = data.importDate;
             } else {
               importDate = new Date(data.importDate);
             }
           } else {
             importDate = new Date();
           }
           
           // Đảm bảo các field số được parse đúng
           const openingStock = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
           const quantity = Number(data.quantity) || 0;
           const exported = Number(data.exported) || 0;
           const xt = Number(data.xt) || 0;
           
           this.materials.push({
             id: doc.id,
             ...data,
             importDate: importDate,
             openingStock: openingStock,
             quantity: quantity,
             exported: exported,
             xt: xt,
             unitWeight: data.unitWeight || catalogItem?.unitWeight || 0,
             standardPacking: data.standardPacking || catalogItem?.standardPacking || 1
           });
           
           // Debug log để kiểm tra
           const calculatedStock = openingStock + quantity - exported - xt;
           console.log(`📊 Material ${materialCode}: openingStock=${openingStock}, quantity=${quantity}, exported=${exported}, xt=${xt}, stock=${calculatedStock}`);
         });
       }

       console.log(`✅ Found ${this.materials.length} records for material ${this.materialCode}`);
      await this.calculateSummary();
    } catch (error) {
      console.error('❌ Error searching material:', error);
      alert(`Lỗi khi tìm kiếm: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  private async loadCatalogData(): Promise<void> {
    try {
      // Load catalog từ collection 'materials' (giống tab utilization)
      const catalogSnapshot = await this.firestore.collection('materials').get().toPromise();
      this.catalogCache.clear();
      
      if (catalogSnapshot) {
        catalogSnapshot.forEach(doc => {
          const data = doc.data();
          // Lấy materialCode từ field hoặc document ID
          const materialCode = (data['materialCode'] || doc.id).toString().trim().toUpperCase();
          this.catalogCache.set(materialCode, {
            unitWeight: data['unitWeight'] || data['unit_weight'] || 0,
            standardPacking: data['standardPacking'] || data['standard_packing'] || 1
          });
        });
      }
      
      console.log(`📚 Loaded ${this.catalogCache.size} items from catalog (materials collection)`);
    } catch (error) {
      console.error('❌ Error loading catalog data:', error);
    }
  }

  getDisplayIMD(material: InventoryMaterial): string {
    if (!material.importDate) return 'N/A';
    
    const baseDate = material.importDate.toLocaleDateString('en-GB').split('/').join('');
    
    // Check if batchNumber has correct format
    if (material.batchNumber && material.batchNumber !== baseDate) {
      // Only process if batchNumber starts with baseDate and only has sequence number added
      if (material.batchNumber.startsWith(baseDate)) {
        const suffix = material.batchNumber.substring(baseDate.length);
        // Only accept suffix if it contains only numbers and has length <= 2
        if (/^\d{1,2}$/.test(suffix)) {
          return material.batchNumber;
        }
      }
    }
    
    return baseDate;
  }

  calculateStock(material: InventoryMaterial): number {
    // Đảm bảo tất cả đều là số
    const openingStock = material.openingStock !== null && material.openingStock !== undefined ? Number(material.openingStock) : 0;
    const quantity = Number(material.quantity) || 0;
    const exported = Number(material.exported) || 0;
    const xt = Number(material.xt) || 0;
    const stock = openingStock + quantity - exported - xt;
    
    // Debug log nếu có vấn đề
    if (isNaN(stock)) {
      console.error(`❌ Invalid stock calculation for ${material.materialCode}:`, {
        openingStock: material.openingStock,
        quantity: material.quantity,
        exported: material.exported,
        xt: material.xt
      });
    }
    
    return stock;
  }

  async calculateSummary(): Promise<void> {
    const summaryMap = new Map<string, MaterialSummary>();

    this.materials.forEach(material => {
      const stock = this.calculateStock(material);
      
      // Debug log cho mã B041788
      const materialCode = material.materialCode.toUpperCase().trim();
      const isDebugMaterial = materialCode === 'B041788' && 
                               material.poNumber === 'KZPO0825/0355';
      
      if (isDebugMaterial) {
        console.log(`🔍 DEBUG B041788 - Material detail:`, {
          id: material.id,
          materialCode: materialCode,
          poNumber: material.poNumber,
          openingStock: material.openingStock,
          quantity: material.quantity,
          exported: material.exported,
          xt: material.xt,
          calculatedStock: stock,
          location: material.location,
          batchNumber: material.batchNumber,
          importDate: material.importDate
        });
      }
      
      if (stock <= 0) return; // Skip materials with zero or negative stock

      const imd = this.getDisplayIMD(material);
      // Key phải bao gồm materialCode để tránh gộp nhầm các materials khác nhau
      // Khi search theo vị trí, có thể có nhiều materials khác mã ở cùng vị trí
      const key = `${materialCode}_${material.poNumber}_${imd}`;
      
      // Lấy standardPacking và unitWeight từ catalog (giống tab utilization)
      const catalogItem = this.catalogCache.get(materialCode);
      
      const standardPacking = catalogItem?.standardPacking || material.standardPacking || 1;
      const unitWeight = catalogItem?.unitWeight || material.unitWeight || 0;
      
      // Tính số cuộn
      const numberOfRolls = stock / standardPacking;
      const evenRolls = Math.floor(numberOfRolls); // Cuộn chẵn (phần nguyên)
      const oddRolls = numberOfRolls - evenRolls; // Cuộn lẻ (phần thập phân)
      const oddQuantity = oddRolls * standardPacking; // Lượng lẻ
      
      // Lấy ngày import/cập nhật gần nhất
      let lastActionDate: Date | null = null;
      if (material.importDate) {
        lastActionDate = material.importDate instanceof Date ? material.importDate : new Date(material.importDate);
      } else if ((material as any).lastUpdated) {
        const lastUpdated = (material as any).lastUpdated;
        if (lastUpdated?.toDate && typeof lastUpdated.toDate === 'function') {
          lastActionDate = lastUpdated.toDate();
        } else if (lastUpdated instanceof Date) {
          lastActionDate = lastUpdated;
        } else {
          lastActionDate = new Date(lastUpdated);
        }
      } else if ((material as any).createdAt) {
        const createdAt = (material as any).createdAt;
        if (createdAt?.toDate && typeof createdAt.toDate === 'function') {
          lastActionDate = createdAt.toDate();
        } else if (createdAt instanceof Date) {
          lastActionDate = createdAt;
        } else {
          lastActionDate = new Date(createdAt);
        }
      }
      
      if (summaryMap.has(key)) {
        const existing = summaryMap.get(key)!;
        const oldStock = existing.stock;
        existing.stock += stock;
        existing.numberOfRolls = existing.stock / existing.standardPacking;
        // Tính lại cuộn chẵn và lẻ
        existing.evenRolls = Math.floor(existing.numberOfRolls);
        existing.oddRolls = existing.numberOfRolls - existing.evenRolls;
        existing.oddQuantity = existing.oddRolls * existing.standardPacking;
        // Cập nhật unitWeight nếu có từ catalog (ưu tiên catalog)
        if (catalogItem?.unitWeight) {
          existing.unitWeight = catalogItem.unitWeight;
        }
        // Tính lại totalWeight với unitWeight đã lưu
        existing.totalWeight = existing.stock * existing.unitWeight;
        // Thêm location nếu chưa có
        if (material.location && !existing.locations.includes(material.location)) {
          existing.locations.push(material.location);
        }
        // Cập nhật lastActionDate nếu ngày mới hơn
        if (lastActionDate && (!existing.lastActionDate || lastActionDate > existing.lastActionDate)) {
          existing.lastActionDate = lastActionDate;
        }
        // Cập nhật giá trị nếu có price data
        const price = this.materialPrices.get(materialCode);
        if (price && price.unitPrice > 0) {
          existing.unitPrice = price.unitPrice;
          existing.materialValue = existing.stock * price.unitPrice;
        }
        
        if (isDebugMaterial) {
          console.log(`🔍 DEBUG B041788 - After merge:`, {
            key: key,
            oldStock: oldStock,
            addedStock: stock,
            newTotalStock: existing.stock,
            standardPacking: existing.standardPacking,
            numberOfRolls: existing.numberOfRolls,
            evenRolls: existing.evenRolls,
            oddRolls: existing.oddRolls
          });
        }
      } else {
        summaryMap.set(key, {
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          imd: imd,
          stock: stock,
          standardPacking: standardPacking, // Từ catalog
          unitWeight: unitWeight, // Từ catalog
          numberOfRolls: numberOfRolls,
          evenRolls: evenRolls,
          oddRolls: oddRolls,
          oddQuantity: oddQuantity,
          totalWeight: stock * unitWeight, // Từ catalog (giống tab utilization)
          locations: material.location ? [material.location] : [],
          lastActionDate: lastActionDate,
          lastActivity: null, // Will be loaded later
          materialValue: undefined, // Will be calculated after loading prices
          unitPrice: undefined
        });
        
        // Calculate material value if price is available
        const price = this.materialPrices.get(materialCode);
        if (price && price.unitPrice > 0) {
          const summaryItem = summaryMap.get(key)!;
          summaryItem.unitPrice = price.unitPrice;
          summaryItem.materialValue = stock * price.unitPrice;
        }
        
        if (isDebugMaterial) {
          console.log(`🔍 DEBUG B041788 - New entry:`, {
            key: key,
            stock: stock,
            standardPacking: standardPacking,
            numberOfRolls: numberOfRolls,
            evenRolls: evenRolls,
            oddRolls: oddRolls
          });
        }
      }
    });

    this.summaryData = Array.from(summaryMap.values());
    
    // Load last activity for each material
    await this.loadLastActivitiesForSummary();
    
    // Update with prices if available
    this.updateSummaryWithPrices();
    
    // Debug log cho B041788 sau khi tính xong
    const debugSummary = this.summaryData.find(s => 
      s.materialCode === 'B041788' && s.poNumber === 'KZPO0825/0355'
    );
    if (debugSummary) {
      console.log(`🔍 DEBUG B041788 - Final summary:`, {
        materialCode: debugSummary.materialCode,
        poNumber: debugSummary.poNumber,
        imd: debugSummary.imd,
        stock: debugSummary.stock,
        standardPacking: debugSummary.standardPacking,
        numberOfRolls: debugSummary.numberOfRolls,
        evenRolls: debugSummary.evenRolls,
        oddRolls: debugSummary.oddRolls,
        oddQuantity: debugSummary.oddQuantity,
        totalWeight: debugSummary.totalWeight,
        locations: debugSummary.locations,
        materialValue: debugSummary.materialValue
      });
    }
    
    // Sắp xếp: nếu search theo vị trí thì sắp xếp theo ngày import (cũ nhất lên trên)
    // Nếu search theo mã thì sắp xếp theo PO và IMD
    // NHƯNG nếu đang filter theo Top N, thì không sort lại (để giữ nguyên thứ tự theo giá trị)
    if (this.topFilter === null || this.topFilter === 0) {
      if (this.locationSearch && !this.materialCode) {
        // Search theo vị trí: sắp xếp theo ngày import (cũ nhất lên trên)
        this.summaryData.sort((a, b) => {
          if (!a.lastActionDate && !b.lastActionDate) return 0;
          if (!a.lastActionDate) return 1; // Không có ngày thì xuống dưới
          if (!b.lastActionDate) return -1; // Không có ngày thì xuống dưới
          return a.lastActionDate.getTime() - b.lastActionDate.getTime(); // Cũ nhất lên trên
        });
        console.log(`📊 Sorted by import date (oldest first) for location search`);
      } else {
        // Search theo mã: sắp xếp theo PO và IMD
        this.summaryData.sort((a, b) => {
          if (a.poNumber !== b.poNumber) {
            return a.poNumber.localeCompare(b.poNumber);
          }
          return a.imd.localeCompare(b.imd);
        });
      }
    }

    console.log(`📊 Summary calculated: ${this.summaryData.length} unique PO/IMD combinations`);
    console.log(`💰 Materials with value: ${this.summaryData.filter(m => m.materialValue && m.materialValue > 0).length}`);
    
    // Save original data for filtering (always update original data - deep copy để tránh reference)
    this.originalSummaryData = this.summaryData.map(item => ({ ...item }));
    
    // Apply filter if active
    if (this.topFilter !== null && this.topFilter > 0) {
      this.applyTopFilter(this.topFilter);
    }
  }

  checkPassword(): void {
    if (this.password === this.CORRECT_PASSWORD) {
      this.showPasswordModal = false;
      this.passwordError = '';
      this.password = '';
      // Save to session storage
      sessionStorage.setItem('manage-password-entered', 'true');
    } else {
      this.passwordError = 'Mật khẩu không đúng!';
      this.password = '';
    }
  }

  reloadData(): void {
    if (this.materialCode.trim()) {
      this.searchMaterial();
    } else if (this.locationSearch.trim()) {
      this.searchByLocation();
    }
  }

  // Import Price File
  importPriceFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls,.csv';
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processPriceFile(file);
      }
    };
    fileInput.click();
  }

  async processPriceFile(file: File): Promise<void> {
    try {
      this.isLoading = true;
      console.log('📁 Processing price file:', file.name);

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

      console.log('📦 Parsed', jsonData.length, 'rows from Excel');

      if (jsonData.length === 0) {
        alert('❌ File không có dữ liệu!');
        this.isLoading = false;
        return;
      }

      // Parse price data - Template format: Mã vật tư, Tên vật tư, Đvt, Tồn cuối kỳ, Số dư cuối kỳ
      const prices: MaterialPrice[] = [];
      for (const row of jsonData) {
        // Read columns exactly as in template
        const materialCode = (row['Mã vật tư'] || row['Mã Vật Tư'] || row['Mã vật tư'] || row['materialCode'] || '').toString().trim().toUpperCase();
        const materialName = (row['Tên vật tư'] || row['Tên Vật Tư'] || row['Tên vật tư'] || row['materialName'] || '').toString().trim();
        const unit = (row['Đvt'] || row['ĐVT'] || row['unit'] || '').toString().trim();
        const endingStock = this.parseNumber(row['Tồn cuối kỳ'] || row['Tồn Cuối Kỳ'] || row['Tồn cuối kỳ'] || row['endingStock'] || 0);
        const endingBalance = this.parseNumber(row['Số dư cuối kỳ'] || row['Số Dư Cuối Kỳ'] || row['Số dư cuối kỳ'] || row['endingBalance'] || 0);

        // Skip empty rows
        if (!materialCode || materialCode === '') continue;

        // Calculate unit price = Số dư cuối kỳ / Tồn cuối kỳ
        const unitPrice = endingStock > 0 ? endingBalance / endingStock : 0;

        prices.push({
          materialCode: materialCode,
          materialName: materialName,
          unit: unit,
          endingStock: endingStock,
          endingBalance: endingBalance,
          unitPrice: unitPrice,
          importedAt: new Date()
        });
      }

      console.log(`✅ Parsed ${prices.length} price records`);

      // Save to Firebase (overwrite)
      await this.savePricesToFirebase(prices);

      // Reload prices
      await this.loadMaterialPrices();

      // Reload and update summary with prices
      if (this.materialCode.trim()) {
        await this.searchMaterial();
      } else if (this.locationSearch.trim()) {
        await this.searchByLocation();
      } else {
        // If no search, just update existing summary
        this.updateSummaryWithPrices();
      }

      alert(`✅ Đã import thành công ${prices.length} giá vật tư!`);
    } catch (error) {
      console.error('❌ Error importing price file:', error);
      alert(`❌ Lỗi khi import file: ${error.message || error}`);
    } finally {
      this.isLoading = false;
    }
  }

  parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    let valueStr = String(value).trim();
    if (!valueStr) return 0;
    
    // Excel format: numbers with comma as thousands separator (e.g., "145,485.00" or "1,881,160,087")
    // Remove all commas (thousands separator) first
    valueStr = valueStr.replace(/,/g, '');
    
    // Remove any non-numeric characters except decimal point and negative sign
    valueStr = valueStr.replace(/[^\d.-]/g, '');
    
    const num = parseFloat(valueStr);
    return isNaN(num) ? 0 : num;
  }

  async savePricesToFirebase(prices: MaterialPrice[]): Promise<void> {
    try {
      // Delete all existing prices first (overwrite)
      const existingSnapshot = await this.firestore.collection('material-prices').get().toPromise();
      if (existingSnapshot && existingSnapshot.docs.length > 0) {
        const batch = this.firestore.firestore.batch();
        existingSnapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`🗑️ Deleted ${existingSnapshot.docs.length} existing price records`);
      }

      // Add new prices
      const batchSize = 500;
      for (let i = 0; i < prices.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const batchPrices = prices.slice(i, i + batchSize);
        
        batchPrices.forEach(price => {
          const docRef = this.firestore.collection('material-prices').doc(price.materialCode).ref;
          batch.set(docRef, price);
        });
        
        await batch.commit();
        console.log(`💾 Saved batch ${Math.floor(i / batchSize) + 1} with ${batchPrices.length} prices`);
      }

      console.log(`✅ Saved ${prices.length} price records to Firebase`);
    } catch (error) {
      console.error('❌ Error saving prices to Firebase:', error);
      throw error;
    }
  }

  async loadMaterialPrices(): Promise<void> {
    try {
      const snapshot = await this.firestore.collection('material-prices').get().toPromise();
      this.materialPrices.clear();
      
      if (snapshot) {
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          const price: MaterialPrice = {
            materialCode: data.materialCode || doc.id,
            materialName: data.materialName || '',
            unit: data.unit || '',
            endingStock: data.endingStock || 0,
            endingBalance: data.endingBalance || 0,
            unitPrice: data.unitPrice || 0,
            importedAt: data.importedAt?.toDate ? data.importedAt.toDate() : new Date(data.importedAt || Date.now())
          };
          this.materialPrices.set(price.materialCode.toUpperCase().trim(), price);
        });
      }
      
      console.log(`✅ Loaded ${this.materialPrices.size} material prices`);
    } catch (error) {
      console.error('❌ Error loading material prices:', error);
    }
  }

  updateSummaryWithPrices(): void {
    this.summaryData.forEach(item => {
      const price = this.materialPrices.get(item.materialCode.toUpperCase().trim());
      if (price) {
        item.unitPrice = price.unitPrice;
        item.materialValue = item.stock * price.unitPrice;
      } else {
        item.unitPrice = undefined;
        item.materialValue = undefined;
      }
    });
  }

  applyTopFilter(limit: number | null): void {
    console.log(`🔝 applyTopFilter called with limit: ${limit}`);
    console.log(`📊 originalSummaryData length: ${this.originalSummaryData.length}`);
    console.log(`📊 current summaryData length: ${this.summaryData.length}`);
    
    this.topFilter = limit;
    
    if (limit === null || limit === 0) {
      // Show all - restore original data
      this.summaryData = [...this.originalSummaryData];
      console.log(`✅ Restored all data: ${this.summaryData.length} materials`);
    } else {
      // Filter to top N by material value
      // Only show materials that have materialValue
      const dataWithValue = [...this.originalSummaryData].filter(item => {
        const hasValue = item.materialValue !== undefined && item.materialValue !== null && item.materialValue > 0;
        if (!hasValue) {
          console.log(`⚠️ Material ${item.materialCode} (PO: ${item.poNumber}) has no materialValue:`, item.materialValue);
        }
        return hasValue;
      });
      
      console.log(`📦 Materials with value: ${dataWithValue.length} out of ${this.originalSummaryData.length}`);
      
      if (dataWithValue.length === 0) {
        alert(`⚠️ Không có material nào có giá trị (materialValue) để lọc!\n\nVui lòng import file giá trước.`);
        this.summaryData = [...this.originalSummaryData];
        this.topFilter = null;
        return;
      }
      
      // Sort by material value (descending - highest first)
      const sortedData = dataWithValue.sort((a, b) => {
        const valueA = a.materialValue || 0;
        const valueB = b.materialValue || 0;
        return valueB - valueA; // Descending
      });
      
      // Take top N
      this.summaryData = sortedData.slice(0, limit);
      
      console.log(`🔝 Filtered to top ${limit}: ${this.summaryData.length} materials`);
      console.log(`📊 Top materials:`, this.summaryData.slice(0, 5).map(m => ({
        code: m.materialCode,
        po: m.poNumber,
        value: m.materialValue
      })));
    }
    
    // Update total material value after filtering
    this.updateTotalMaterialValue();
  }

  updateTotalMaterialValue(): void {
    const total = this.summaryData.reduce((sum, item) => sum + (item.materialValue || 0), 0);
    console.log(`💰 Total material value: ${total}`);
  }

  get totalMaterialValue(): number {
    return this.summaryData.reduce((sum, item) => sum + (item.materialValue || 0), 0);
  }

  onPasswordKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.checkPassword();
    }
  }

  downloadReport(): void {
    if (this.summaryData.length === 0) {
      alert('Không có dữ liệu để tải xuống!');
      return;
    }

    try {
      // Prepare data for Excel
      const excelData = this.summaryData.map((item, index) => ({
        'STT': index + 1,
        'Mã nguyên liệu': item.materialCode,
        'PO': item.poNumber,
        'IMD': item.imd,
        'Vị trí': item.locations.join('; '),
        'Tồn kho': item.stock,
        'Standard Packing': item.standardPacking,
        'Cuộn chẵn': item.evenRolls,
        'Cuộn lẻ': item.oddRolls.toFixed(3),
        'Lượng lẻ': item.oddQuantity.toFixed(2),
        'Trọng lượng cuộn (g)': item.totalWeight.toFixed(2),
        'Ngày import': item.lastActionDate ? item.lastActionDate.toLocaleDateString('vi-VN') : 'N/A'
      }));

      // Add total row
      excelData.push({
        'STT': 0,
        'Mã nguyên liệu': 'TỔNG',
        'PO': '',
        'IMD': '',
        'Vị trí': '',
        'Tồn kho': 0,
        'Standard Packing': 0,
        'Cuộn chẵn': this.totalEvenRolls,
        'Cuộn lẻ': this.totalOddRolls.toFixed(3),
        'Lượng lẻ': '',
        'Trọng lượng cuộn (g)': '',
        'Ngày import': ''
      });

      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');

      // Generate filename
      const factory = this.selectedFactory;
      const searchType = this.materialCode ? `Material_${this.materialCode}` : `Location_${this.locationSearch}`;
      const date = new Date().toISOString().split('T')[0];
      const filename = `Manage_Report_${factory}_${searchType}_${date}.xlsx`;

      // Write and download
      XLSX.writeFile(wb, filename);
      console.log(`✅ Report downloaded: ${filename}`);
    } catch (error) {
      console.error('❌ Error downloading report:', error);
      alert(`Lỗi khi tải xuống report: ${error}`);
    }
  }
}

