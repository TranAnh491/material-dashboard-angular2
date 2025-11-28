import { Component, OnInit, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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
  numberOfRolls: number; // Tổng số cuộn (giữ lại để tính tổng)
  evenRolls: number; // Cuộn chẵn (phần nguyên)
  oddRolls: number; // Cuộn lẻ (phần thập phân)
  oddQuantity: number; // Lượng lẻ = cuộn lẻ × standard packing
  totalWeight: number;
  locations: string[]; // Danh sách các vị trí
  lastActionDate: Date | null; // Ngày import/cập nhật gần nhất
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

  ngOnInit(): void {
    console.log('🚀 ManageComponent initialized');
    // Check if password was already entered in this session
    const passwordEntered = sessionStorage.getItem('manage-password-entered');
    if (passwordEntered === 'true') {
      this.showPasswordModal = false;
    } else {
      this.showPasswordModal = true;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFactoryChange(): void {
    console.log('🏭 Factory changed to:', this.selectedFactory);
    this.searchMaterial();
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
          
          this.materials.push({
            id: doc.id,
            ...data,
            importDate: importDate,
            unitWeight: data.unitWeight || catalogItem?.unitWeight || 0,
            standardPacking: data.standardPacking || catalogItem?.standardPacking || 1
          });
        });
      }

      console.log(`✅ Found ${this.materials.length} records for location ${this.locationSearch}`);
      this.calculateSummary();
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
          
          this.materials.push({
            id: doc.id,
            ...data,
            importDate: importDate,
            unitWeight: data.unitWeight || catalogItem?.unitWeight || 0,
            standardPacking: data.standardPacking || catalogItem?.standardPacking || 1
          });
        });
      }

      console.log(`✅ Found ${this.materials.length} records for material ${this.materialCode}`);
      this.calculateSummary();
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
    const openingStock = material.openingStock !== null && material.openingStock !== undefined ? material.openingStock : 0;
    const quantity = material.quantity || 0;
    const exported = material.exported || 0;
    const xt = material.xt || 0;
    return openingStock + quantity - exported - xt;
  }

  calculateSummary(): void {
    const summaryMap = new Map<string, MaterialSummary>();

    this.materials.forEach(material => {
      const stock = this.calculateStock(material);
      if (stock <= 0) return; // Skip materials with zero or negative stock

      const imd = this.getDisplayIMD(material);
      const key = `${material.poNumber}_${imd}`;
      
      // Lấy standardPacking và unitWeight từ catalog (giống tab utilization)
      const materialCode = material.materialCode.toUpperCase().trim();
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
        existing.stock += stock;
        existing.numberOfRolls = existing.stock / existing.standardPacking;
        // Tính lại cuộn chẵn và lẻ
        existing.evenRolls = Math.floor(existing.numberOfRolls);
        existing.oddRolls = existing.numberOfRolls - existing.evenRolls;
        existing.oddQuantity = existing.oddRolls * existing.standardPacking;
        // Tính lại totalWeight với unitWeight từ catalog
        existing.totalWeight = existing.stock * unitWeight;
        // Thêm location nếu chưa có
        if (material.location && !existing.locations.includes(material.location)) {
          existing.locations.push(material.location);
        }
        // Cập nhật lastActionDate nếu ngày mới hơn
        if (lastActionDate && (!existing.lastActionDate || lastActionDate > existing.lastActionDate)) {
          existing.lastActionDate = lastActionDate;
        }
      } else {
        summaryMap.set(key, {
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          imd: imd,
          stock: stock,
          standardPacking: standardPacking, // Từ catalog
          numberOfRolls: numberOfRolls,
          evenRolls: evenRolls,
          oddRolls: oddRolls,
          oddQuantity: oddQuantity,
          totalWeight: stock * unitWeight, // Từ catalog (giống tab utilization)
          locations: material.location ? [material.location] : [],
          lastActionDate: lastActionDate
        });
      }
    });

    this.summaryData = Array.from(summaryMap.values());
    
    // Sắp xếp: nếu search theo vị trí thì sắp xếp theo ngày import (cũ nhất lên trên)
    // Nếu search theo mã thì sắp xếp theo PO và IMD
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

    console.log(`📊 Summary calculated: ${this.summaryData.length} unique PO/IMD combinations`);
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

  onPasswordKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.checkPassword();
    }
  }
}

