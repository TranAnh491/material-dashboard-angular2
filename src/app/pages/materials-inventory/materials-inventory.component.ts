import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { TabPermissionService } from '../../services/tab-permission.service';

export interface InventoryMaterial {
  id?: string;
  factory?: string; // Factory identifier (ASM1, ASM2, etc.)
  importDate: Date;
  receivedDate?: Date; // Ngày nhập vào inventory (khi tick đã nhận)
  batchNumber: string;
  materialCode: string;
  materialName?: string; // Added for catalog mapping
  poNumber: string;
  quantity: number;
  unit: string;
  exported?: number; // Added for export tracking
  stock?: number; // Added for stock tracking
  location: string;
  type: string;
  expiryDate: Date;
  qualityCheck: boolean;
  isReceived: boolean;
  notes: string;
  rollsOrBags: string;
  supplier: string;
  remarks: string;
  isCompleted: boolean;
  isDuplicate?: boolean; // Added for duplicate marking
  importStatus?: string; // "Import" for items imported from stock file
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CatalogItem {
  materialCode: string;
  materialName: string;
  unit: string;
}

export interface StockItem {
  factory?: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  type: string;
  location: string;
}

export interface FIFOViolationReport {
  id?: string;
  factory?: string; // Factory identifier (ASM1, ASM2, etc.)
  materialCode: string;
  actualPO: string; // PO that was actually scanned
  correctFIFOPO: string; // PO that should have been scanned (FIFO)
  exportQuantity: number;
  exportDate: Date;
  exportedBy: string;
  location: string;
  materialName?: string;
  notes?: string;
  createdAt: Date;
}

@Component({
  selector: 'app-materials-inventory',
  templateUrl: './materials-inventory.component.html',
  styleUrls: ['./materials-inventory.component.scss']
})
export class MaterialsInventoryComponent implements OnInit, OnDestroy, AfterViewInit {
  // Data properties
  inventoryMaterials: InventoryMaterial[] = [];
  filteredInventory: InventoryMaterial[] = [];
  
  // Loading state
  isLoading = false;
  isCatalogLoading = false; // Separate loading state for catalog
  
  // Catalog cache for faster access
  private catalogCache = new Map<string, CatalogItem>();
  public catalogLoaded = false;
  
  // Search and filter
  searchTerm = '';
  
  // Factory filter
  selectedFactory: string = '';
  availableFactories: string[] = ['ASM1', 'ASM2'];
  
  // Dropdown state
  isDropdownOpen = false;
  
  // Show completed items
  showCompleted = true;
  
  // QR Scanner properties
  isScanning = false;
  scanner: Html5Qrcode | null = null;
  currentScanningMaterial: InventoryMaterial | null = null;
  
  // Location change scanning
  isScanningLocationChange = false;
  currentLocationChangeMaterial: InventoryMaterial | null = null;
  
  // FIFO checking
  fifoCheckResult: {isValid: boolean, firstRowPO?: string} | null = null;
  
  private destroy$ = new Subject<void>();

  // Permission properties
  canExport = false;
  canDelete = false;
  canEditHSD = false;

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef,
    private tabPermissionService: TabPermissionService
  ) {}

  ngOnInit(): void {
    // Load catalog first, then inventory to ensure names are available
    this.loadCatalogFromFirebase().then(() => {
      this.loadInventoryFromFirebase();
    });
    this.loadPermissions();
    // Disable auto-sync to prevent deleted items from reappearing
    // Use manual sync button instead
  }

  ngAfterViewInit(): void {
    // Auto-resize notes column for existing data after view initialization
    setTimeout(() => {
      this.autoResizeNotesColumn();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.stopScanning();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load inventory data from Firebase with catalog integration
  loadInventoryFromFirebase(): void {
    console.log('📦 Loading inventory from Firebase...');
    this.isLoading = true;
    
    this.firestore.collection('inventory-materials')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        this.inventoryMaterials = actions
          .map(action => {
            const data = action.payload.doc.data() as any;
            const id = action.payload.doc.id;
            const material = {
              id: id,
              ...data,
              importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
              receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date()
            };
            
            // Apply catalog data instantly if available
            if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
              const catalogItem = this.catalogCache.get(material.materialCode)!;
              material.materialName = catalogItem.materialName;
              material.unit = catalogItem.unit;
            }
            
            return material;
          });
        
        console.log('📊 Raw inventory data loaded:', this.inventoryMaterials.length, 'items');
        
        // Apply filters and sorting initially
        this.applyFilters();
        console.log('✅ Inventory loaded and processed from Firebase');
        this.isLoading = false;
        this.cdr.detectChanges();
      });
  }

  // Sync received materials from inbound to inventory (one-time only)
  private syncFromInboundMaterials(): void {
    console.log('Starting one-time sync from inbound to inventory for factory:', this.selectedFactory || 'All');
    
    // Build query based on selected factory
    let query: any;
    
    // If a factory is selected, filter by it
    if (this.selectedFactory) {
      query = this.firestore.collection('inbound-materials', ref => ref.where('factory', '==', this.selectedFactory));
    } else {
      query = this.firestore.collection('inbound-materials');
    }
    
    query.get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((snapshot) => {
        const receivedMaterials = snapshot.docs
          .map(doc => {
            const data = doc.data() as any;
            return {
              id: doc.id,
              ...data,
              importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : null // Để trống nếu inbound không có HSD
            };
          })
          .filter(material => material.isReceived === true);

        console.log(`Found ${receivedMaterials.length} received materials for factory: ${this.selectedFactory || 'All'}`);

        // Get current inventory items and deleted items for the selected factory
        Promise.all([
          this.firestore.collection('inventory-materials', ref => 
            this.selectedFactory ? ref.where('factory', '==', this.selectedFactory) : ref
          ).get().toPromise(),
          this.firestore.collection('inventory-deleted-items', ref => 
            this.selectedFactory ? ref.where('factory', '==', this.selectedFactory) : ref
          ).get().toPromise()
        ]).then(([inventorySnapshot, deletedSnapshot]) => {
          const existingInventoryCodes = new Set<string>();
          const deletedItemCodes = new Set<string>();

          // Get existing inventory items
          inventorySnapshot.docs.forEach(doc => {
            const data = doc.data() as any;
            const key = `${data.materialCode}_${data.poNumber}`;
            existingInventoryCodes.add(key);
          });

          // Get deleted items
          deletedSnapshot.docs.forEach(doc => {
            const data = doc.data() as any;
            const key = `${data.materialCode}_${data.poNumber}`;
            deletedItemCodes.add(key);
          });

          console.log(`Existing inventory items for factory ${this.selectedFactory || 'All'}:`, existingInventoryCodes.size);
          console.log(`Deleted items for factory ${this.selectedFactory || 'All'}:`, deletedItemCodes.size);

          // Allow duplicates but check if item was previously deleted
          let addedCount = 0;
          let skippedCount = 0;
          let deletedCount = 0;

          receivedMaterials.forEach(inboundMaterial => {
            const key = `${inboundMaterial.materialCode}_${inboundMaterial.poNumber}`;
            
            if (deletedItemCodes.has(key)) {
              console.log(`Skipped ${inboundMaterial.materialCode} - was previously deleted`);
              deletedCount++;
            } else {
              // Add to inventory collection (allow duplicates)
              const inventoryData = {
                ...inboundMaterial,
                id: undefined, // Remove the inbound ID
                createdAt: new Date(),
                updatedAt: new Date()
              };
              delete inventoryData.id;

              this.firestore.collection('inventory-materials').add(inventoryData)
                .then((docRef) => {
                  console.log(`Added ${inboundMaterial.materialCode} to inventory with ID: ${docRef.id} for factory: ${inboundMaterial.factory || 'ASM1'}`);
                  addedCount++;
                })
                .catch(error => {
                  console.error('Error adding material to inventory:', error);
                });
            }
          });

          console.log(`Sync completed for factory ${this.selectedFactory || 'All'}. Added: ${addedCount}, Skipped (existing): ${skippedCount}, Skipped (deleted): ${deletedCount}`);
        });
      });
  }



  // Compare material codes using natural sort (alphabetical + numerical)
  private compareMaterialCodes(codeA: string, codeB: string): number {
    // Split the codes into parts (letters and numbers)
    const partsA = codeA.match(/[A-Za-z]+|\d+/g) || [];
    const partsB = codeB.match(/[A-Za-z]+|\d+/g) || [];
    
    const maxLength = Math.max(partsA.length, partsB.length);
    
    for (let i = 0; i < maxLength; i++) {
      const partA = partsA[i] || '';
      const partB = partsB[i] || '';
      
      // If both parts are numbers, compare numerically
      const isNumberA = /^\d+$/.test(partA);
      const isNumberB = /^\d+$/.test(partB);
      
      if (isNumberA && isNumberB) {
        const numA = parseInt(partA);
        const numB = parseInt(partB);
        if (numA !== numB) {
          return numA - numB;
        }
      } else {
        // Compare as strings (case-insensitive)
        const comparison = partA.toLowerCase().localeCompare(partB.toLowerCase());
        if (comparison !== 0) {
          return comparison;
        }
      }
    }
    
    // If all parts are equal, shorter code comes first
    return partsA.length - partsB.length;
  }

  // Compare PO numbers (format: XXXX/XXXX where first 4 digits are month/year)
  private comparePONumbers(poA: string, poB: string): number {
    const extractPOInfo = (po: string) => {
      const match = po.match(/(\d{4})\/(\d{4})/);
      if (!match) return { year: 0, month: 0, sequence: 0 };
      
      const firstPart = match[1];
      const secondPart = match[2];
      
      // First 4 digits: MMYY format
      const month = parseInt(firstPart.substring(0, 2));
      const year = parseInt(firstPart.substring(2, 4));
      const sequence = parseInt(secondPart);
      
      return { year, month, sequence };
    };

    const infoA = extractPOInfo(poA);
    const infoB = extractPOInfo(poB);

    // Compare by year (oldest first)
    if (infoA.year !== infoB.year) {
      return infoA.year - infoB.year;
    }
    
    // If same year, compare by month
    if (infoA.month !== infoB.month) {
      return infoA.month - infoB.month;
    }
    
    // If same month, compare by sequence
    return infoA.sequence - infoB.sequence;
  }

  // Refresh inventory data
  refreshInventory(): void {
    console.log('Refreshing inventory...');
    this.loadInventoryFromFirebase();
  }

  // Manual sync from inbound materials
  syncFromInbound(): void {
    console.log('Manual sync from inbound materials...');
    this.syncFromInboundMaterials();
  }



  // Reload catalog from Firebase
  reloadCatalog(): void {
    console.log('Reloading catalog from Firebase...');
    this.loadCatalogFromFirebase();
  }

  // Force refresh catalog (clear cache and reload)
  forceRefreshCatalog(): void {
    console.log('Force refreshing catalog from Firebase...');
    
    // Clear any cached data first
    this.inventoryMaterials.forEach(material => {
      material.materialName = undefined;
      material.unit = undefined;
    });
    
    // Force reload after a short delay
    setTimeout(() => {
      this.loadCatalogFromFirebase();
    }, 100);
  }

  // Test save catalog with sample data
  testSaveCatalog(): void {
    console.log('Testing catalog save with sample data...');
    const sampleCatalogItems: CatalogItem[] = [
      { materialCode: 'B001800', materialName: 'Dây điện (wire) UL1232/UL1283/UL1346/UL10269 6AWG', unit: 'M' },
      { materialCode: 'B001801', materialName: 'Dây điện (wire) UL1028/UL1032/UL1231/UL1344 8AWG', unit: 'M' },
      { materialCode: 'B016106', materialName: 'Đầu nối Connector TE P/N: 3-641435-2 RoHS2.0', unit: 'PCS' },
      { materialCode: 'B024075', materialName: 'Cầu chì Fuse 250V 3.15A Littelfuse P/N: 02153.15M', unit: 'PCS' }
    ];
    
    this.saveCatalogToFirebase(sampleCatalogItems);
  }

  // Check catalog status in Firebase
  checkCatalogStatus(): void {
    console.log('=== CHECKING CATALOG STATUS ===');
    
    // Check metadata
    this.firestore.collection('inventory-catalog').doc('metadata').get()
      .subscribe(metadataDoc => {
        if (metadataDoc.exists) {
          const metadata = metadataDoc.data() as any;
          console.log('Metadata found:', metadata);
          
          // Check each chunk
          for (let i = 0; i < metadata.totalChunks; i++) {
            this.firestore.collection('inventory-catalog').doc(`chunk_${i}`).get()
              .subscribe(chunkDoc => {
                if (chunkDoc.exists) {
                  const chunkData = chunkDoc.data() as any;
                  console.log(`Chunk ${i} exists with ${chunkData.items?.length || 0} items`);
                } else {
                  console.log(`Chunk ${i} does not exist`);
                }
              });
          }
        } else {
          console.log('No metadata found');
        }
      });
  }

  // Check if item was previously deleted from inventory
  private isItemDeletedFromInventory(materialCode: string, poNumber: string): boolean {
    // Check if this item was previously deleted by looking at deletion history
    // For now, we'll use a simple approach: check if it exists in current inventory
    const exists = this.inventoryMaterials.some(
      item => item.materialCode === materialCode && item.poNumber === poNumber
    );
    return !exists;
  }

  // Mark duplicate items (same material code + PO number)
  private markDuplicates(): void {
    const duplicateMap = new Map<string, number>();
    
    // Count occurrences of each material code + PO combination within the selected factory
    this.filteredInventory.forEach(material => {
      const key = `${material.materialCode}_${material.poNumber}`;
      duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
    });

    // Mark items as duplicate if they appear more than once within the same factory
    this.filteredInventory.forEach(material => {
      const key = `${material.materialCode}_${material.poNumber}`;
      material.isDuplicate = duplicateMap.get(key) > 1;
    });
    
    console.log('🔍 Duplicate marking completed for factory:', this.selectedFactory || 'All');
  }

  // Debug method to check inventory data
  debugInventoryData(): void {
    console.log('=== DEBUG INVENTORY DATA ===');
    console.log('Total inventory materials:', this.inventoryMaterials.length);
    console.log('Filtered inventory:', this.filteredInventory.length);
    console.log('Search term:', this.searchTerm);
    console.log('Inventory materials:', this.inventoryMaterials);
    console.log('Filtered inventory:', this.filteredInventory);
    
    // Check stock calculations
    console.log('=== DEBUG STOCK CALCULATIONS ===');
    this.filteredInventory.forEach((material, index) => {
      const calculatedStock = this.calculateCurrentStock(material);
      
      console.log(`Item ${index + 1}:`, {
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        quantity: material.quantity,
        exported: material.exported,
        stockField: material.stock,
        calculatedStock: calculatedStock,
        isNegative: calculatedStock < 0,
        formula: `${material.quantity || 0} - ${material.exported || 0} = ${calculatedStock}`
      });
    });
    
    // Check Firebase directly for received materials
    this.firestore.collection('inbound-materials', ref => ref.where('isReceived', '==', true))
      .get()
      .subscribe(snapshot => {
        console.log('Raw Firebase received materials:', snapshot.docs.map(doc => ({
          id: doc.id,
          data: doc.data()
        })));
      });

    // Debug specific material code B024075
    console.log('=== B024075 DEBUG ===');
    const b024075Items = this.filteredInventory.filter(item => item.materialCode === 'B024075');
    console.log('B024075 items found:', b024075Items.length);
    b024075Items.forEach((item, index) => {
      console.log(`B024075 item ${index + 1}:`, {
        materialCode: item.materialCode,
        poNumber: item.poNumber,
        quantity: item.quantity,
        exported: item.exported,
        stock: item.stock,
        calculatedStock: this.calculateCurrentStock(item),
        hasNegativeStock: this.hasNegativeStock(item),
        location: item.location,
        formula: `${item.quantity} - ${item.exported} = ${this.calculateCurrentStock(item)}`
      });
    });

    // Check catalog data
    this.firestore.collection('inventory-catalog').doc('metadata').get()
      .subscribe(metadataDoc => {
        if (metadataDoc.exists) {
          console.log('=== DEBUG CATALOG DATA ===');
          const metadata = metadataDoc.data() as any;
          console.log('Catalog metadata:', metadata);
          
          // Check first few chunks
          const checkChunks = Math.min(3, metadata.totalChunks);
          for (let i = 0; i < checkChunks; i++) {
            this.firestore.collection('inventory-catalog').doc(`chunk_${i}`).get()
              .subscribe(chunkDoc => {
                if (chunkDoc.exists) {
                  const chunkData = chunkDoc.data() as any;
                  console.log(`Chunk ${i} data:`, {
                    itemsCount: chunkData.items?.length || 0,
                    chunkIndex: chunkData.chunkIndex,
                    totalChunks: chunkData.totalChunks
                  });
                }
              });
          }
        } else {
          console.log('=== DEBUG CATALOG DATA ===');
          console.log('No catalog metadata found');
        }
      });
  }



  // Toggle dropdown
  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  // Close dropdown when clicking outside
  @HostListener('document:click')
  onDocumentClick(): void {
    this.isDropdownOpen = false;
  }

  // Import catalog file
  importCatalog(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processCatalogFile(file);
      }
    };
    input.click();
  }

  // Save catalog to Firebase (split into chunks to avoid size limit)
  private saveCatalogToFirebase(catalogItems: CatalogItem[]): void {
    console.log('Saving catalog to Firebase:', catalogItems.length, 'items');
    
    // Split catalog into chunks of 1000 items each
    const chunkSize = 1000;
    const chunks = [];
    for (let i = 0; i < catalogItems.length; i += chunkSize) {
      chunks.push(catalogItems.slice(i, i + chunkSize));
    }
    
    console.log(`Splitting catalog into ${chunks.length} chunks of ${chunkSize} items each`);
    
    // Save metadata first
    const metadata = {
      totalItems: catalogItems.length,
      totalChunks: chunks.length,
      uploadedAt: new Date(),
      version: Date.now()
    };
    
    console.log('Saving metadata:', metadata);
    
    this.firestore.collection('inventory-catalog').doc('metadata').set(metadata)
      .then(() => {
        console.log('Catalog metadata saved successfully');
        
        // Save each chunk sequentially to avoid overwhelming Firebase
        let savedChunks = 0;
        const saveChunk = (index: number) => {
          if (index >= chunks.length) {
            console.log('All catalog chunks saved to Firebase successfully');
            // Wait a bit then reload catalog
            setTimeout(() => {
              console.log('Reloading catalog after save...');
              this.loadCatalogFromFirebase();
            }, 2000);
            return;
          }
          
          const chunkData = {
            items: chunks[index],
            chunkIndex: index,
            totalChunks: chunks.length
          };
          
          console.log(`Saving chunk ${index} with ${chunks[index].length} items`);
          
          this.firestore.collection('inventory-catalog').doc(`chunk_${index}`).set(chunkData)
            .then(() => {
              savedChunks++;
              console.log(`Chunk ${index} saved successfully (${savedChunks}/${chunks.length})`);
              // Add delay between chunks
              setTimeout(() => {
                saveChunk(index + 1);
              }, 500);
            })
            .catch(error => {
              console.error(`Error saving chunk ${index} to Firebase:`, error);
            });
        };
        
        // Start saving chunks
        saveChunk(0);
      })
      .catch(error => {
        console.error('Error saving catalog metadata to Firebase:', error);
      });
  }

  // Load catalog from Firebase with optimized loading
  private async loadCatalogFromFirebase(): Promise<void> {
    console.log('🚀 Loading catalog from Firebase with optimization...');
    this.isCatalogLoading = true;
    
    try {
      // First check metadata
      const metadataDoc = await this.firestore.collection('inventory-catalog').doc('metadata').get().toPromise();
      
      if (metadataDoc?.exists) {
        const metadata = metadataDoc.data() as any;
        console.log('📋 Catalog metadata found:', metadata);
        
        // Load all chunks in parallel for faster loading
        const chunkPromises: Promise<CatalogItem[]>[] = [];
        
        for (let i = 0; i < metadata.totalChunks; i++) {
          const chunkPromise = this.firestore.collection('inventory-catalog').doc(`chunk_${i}`).get().toPromise()
            .then(chunkDoc => {
              if (chunkDoc?.exists) {
                const chunkData = chunkDoc.data() as any;
                return chunkData.items || [];
              }
              return [];
            })
            .catch(error => {
              console.error(`❌ Error loading chunk ${i}:`, error);
              return [];
            });
          
          chunkPromises.push(chunkPromise);
        }
        
        // Wait for all chunks to load in parallel
        const chunkResults = await Promise.all(chunkPromises);
        
        // Combine all chunks
        const allCatalogItems: CatalogItem[] = [];
        chunkResults.forEach((chunk, index) => {
          allCatalogItems.push(...chunk);
          console.log(`✅ Chunk ${index} loaded: ${chunk.length} items`);
        });
        
        // Build catalog cache for instant lookup
        this.buildCatalogCache(allCatalogItems);
        
        console.log(`🎯 Total catalog items loaded: ${allCatalogItems.length}`);
        this.catalogLoaded = true;
        
      } else {
        console.log('⚠️ No catalog metadata found in Firebase');
        this.catalogLoaded = true; // Mark as loaded to prevent infinite waiting
      }
      
    } catch (error) {
      console.error('❌ Error loading catalog:', error);
      this.catalogLoaded = true; // Mark as loaded to prevent infinite waiting
    } finally {
      this.isCatalogLoading = false;
      this.cdr.detectChanges();
    }
  }

  // Build catalog cache for instant material name/unit lookup
  private buildCatalogCache(catalogItems: CatalogItem[]): void {
    console.log('🔧 Building catalog cache for fast lookup...');
    this.catalogCache.clear();
    
    catalogItems.forEach(item => {
      this.catalogCache.set(item.materialCode, item);
    });
    
    console.log(`💾 Catalog cache built with ${this.catalogCache.size} items`);
  }

  // Get material name from cache instantly
  getMaterialName(materialCode: string): string {
    const catalogItem = this.catalogCache.get(materialCode);
    return catalogItem?.materialName || 'N/A';
  }

  // Get material unit from cache instantly
  getMaterialUnit(materialCode: string): string {
    const catalogItem = this.catalogCache.get(materialCode);
    return catalogItem?.unit || 'PCS';
  }

  // Process catalog file
  private async processCatalogFile(file: File): Promise<void> {
    try {
      const catalogData = await this.readExcelFile(file);
      this.updateInventoryWithCatalog(catalogData);
      this.saveCatalogToFirebase(catalogData);
      console.log('Catalog imported and saved to Firebase successfully');
    } catch (error) {
      console.error('Error processing catalog file:', error);
    }
  }

  // Read Excel file
  private async readExcelFile(file: File): Promise<CatalogItem[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          const catalogItems: CatalogItem[] = [];
          // Skip header row
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i] as any[];
            if (row[0] && row[1] && row[2]) {
              catalogItems.push({
                materialCode: row[0].toString(),
                materialName: row[1].toString(),
                unit: row[2].toString()
              });
            }
          }
          resolve(catalogItems);
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // Update inventory with catalog data (optimized version)
  private updateInventoryWithCatalog(catalogItems: CatalogItem[]): void {
    console.log('🔄 Updating inventory with catalog data:', catalogItems.length, 'items');
    
    // Rebuild cache first
    this.buildCatalogCache(catalogItems);
    
    // Update inventory materials with catalog data
    let updatedCount = 0;
    this.inventoryMaterials.forEach(material => {
      const catalogItem = this.catalogCache.get(material.materialCode);
      if (catalogItem) {
        material.materialName = catalogItem.materialName;
        material.unit = catalogItem.unit;
        updatedCount++;
      }
    });

    this.applyFilters();
    console.log(`✅ Inventory updated with catalog data. Updated ${updatedCount} materials.`);
    this.cdr.detectChanges();
  }

  // Download catalog template
  downloadCatalogTemplate(): void {
    const templateData = [
      ['Mã hàng', 'Tên hàng', 'Đơn vị'],
      ['MAT001', 'Vải cotton', 'm'],
      ['MAT002', 'Chỉ may', 'cuộn'],
      ['MAT003', 'Khóa kéo', 'cái'],
      ['MAT004', 'Nút bấm', 'cái'],
      ['MAT005', 'Vải lót', 'm']
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Danh mục');
    
    XLSX.writeFile(workbook, 'Template_Danh_muc.xlsx');
    console.log('Catalog template downloaded');
  }

  // Import current stock
  importCurrentStock(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processStockFile(file);
      }
    };
    input.click();
  }

  // Process stock file
  private async processStockFile(file: File): Promise<void> {
    try {
      const stockData = await this.readStockFile(file);
      this.updateInventoryWithStock(stockData);
      console.log('Stock data imported successfully');
    } catch (error) {
      console.error('Error processing stock file:', error);
    }
  }

  // Read stock file
  private async readStockFile(file: File): Promise<StockItem[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          const stockItems: StockItem[] = [];
          // Skip header row
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i] as any[];
            if (row[1] && row[2] && row[3]) { // Factory, MaterialCode, PO required
              stockItems.push({
                factory: row[0]?.toString() || 'ASM1', // Factory column (new)
                materialCode: row[1].toString(),
                poNumber: row[2].toString(),
                quantity: Number(row[3]) || 0,
                type: row[4]?.toString() || '',
                location: row[5]?.toString()?.toUpperCase() || 'DEFAULT'
              });
            }
          }
          resolve(stockItems);
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // Update inventory with stock data
  private updateInventoryWithStock(stockItems: StockItem[]): void {
    // Add new inventory items from stock import
    stockItems.forEach(stockItem => {
      // Check if item already exists
      const existing = this.inventoryMaterials.find(material => 
        material.materialCode === stockItem.materialCode && 
        material.poNumber === stockItem.poNumber
      );

      if (!existing) {
        // Create new inventory item with "Import" status
        const newInventoryItem: InventoryMaterial = {
          factory: stockItem.factory || 'ASM1', // Include factory from stock item
          importDate: new Date(),
          receivedDate: new Date(),
          batchNumber: `IMPORT-${Date.now()}`,
          materialCode: stockItem.materialCode,
          materialName: stockItem.materialCode, // Use material code as name for now
          poNumber: stockItem.poNumber,
          quantity: stockItem.quantity,
          unit: 'PCS', // Default unit
          exported: 0,
          stock: stockItem.quantity,
          location: stockItem.location,
          type: stockItem.type,
          expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
          qualityCheck: false,
          isReceived: true,
          notes: '',
          rollsOrBags: '0',
          supplier: 'Import',
          remarks: '',
          isCompleted: false,
          isDuplicate: false,
          importStatus: 'Import', // Mark as Import status
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Add to Firebase
        this.firestore.collection('inventory-materials').add(newInventoryItem)
          .then((docRef) => {
            console.log('Added import item to inventory with ID:', docRef.id);
            // Add to local array
            this.inventoryMaterials.push(newInventoryItem);
            this.applyFilters();
          })
          .catch(error => {
            console.error('Error adding import item to inventory:', error);
          });
      }
    });

    console.log('Stock data imported successfully');
  }

  // Update inventory item in Firebase
  private updateInventoryInFirebase(material: InventoryMaterial): void {
    if (material.id) {
      const updateData = {
        ...material,
        importDate: material.importDate,
        expiryDate: material.expiryDate,
        updatedAt: new Date()
      };
      
      // Remove id field before updating Firebase
      delete updateData.id;
      
      this.firestore.collection('inventory-materials').doc(material.id).update(updateData)
        .then(() => {
          console.log('Inventory item updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating inventory item in Firebase:', error);
        });
    }
  }

  // Download stock template
  downloadStockTemplate(): void {
    const templateData = [
      ['Factory', 'Mã hàng', 'Số P.O', 'Lượng nhập', 'Loại hình', 'Vị trí'],
      ['ASM1', 'B001801', 'KZPO0725/0104', 300, 'Wire', 'D22'],
      ['ASM2', 'B001802', 'KZPO0725/0117', 700, 'Cable', 'IQC'],
      ['ASM1', 'A001803', 'KZPO0725/0118', 500, 'Component', 'E31'],
      ['ASM2', 'R001804', 'KZPO0725/0119', 200, 'Raw Material', 'F12']
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tồn kho');
    
    XLSX.writeFile(workbook, 'Template_Ton_kho_Factory.xlsx');
    console.log('Stock template with Factory downloaded');
  }

  // Download FIFO Report for ASM1
  downloadFIFOReportASM1(): void {
    this.downloadFIFOReportByFactory('ASM1');
  }

  // Download FIFO Report for ASM2
  downloadFIFOReportASM2(): void {
    this.downloadFIFOReportByFactory('ASM2');
  }

  // Generic method to download FIFO report by factory
  private downloadFIFOReportByFactory(factory: string): void {
    this.firestore.collection('fifo-violations', ref => 
      ref.orderBy('createdAt', 'desc')
    ).get().subscribe(snapshot => {
        if (snapshot.empty) {
          alert(`📊 Không có báo cáo vi phạm FIFO nào cho ${factory}.`);
          return;
        }

        // Filter by factory
        const filteredDocs = snapshot.docs.filter(doc => {
          const data = doc.data() as FIFOViolationReport;
          return (data as any).factory === factory || (!data.factory && factory === 'ASM1'); // Default to ASM1 if no factory
        });

        if (filteredDocs.length === 0) {
          alert(`📊 Không có báo cáo vi phạm FIFO nào cho ${factory}.`);
          return;
        }

        const fifoData: any[] = [];
        // Headers
        fifoData.push([
          'STT',
          'Factory',
          'Ngày vi phạm',
          'Mã hàng',
          'Tên hàng',
          'PO đã xuất (Sai)',
          'PO đúng (FIFO)',
          'Số lượng xuất',
          'Vị trí',
          'Người xuất',
          'Ghi chú'
        ]);

        // Data rows
        filteredDocs.forEach((doc, index) => {
          const data = doc.data() as FIFOViolationReport;
          fifoData.push([
            index + 1,
            (data as any).factory || 'ASM1',
            data.exportDate ? (data.exportDate as any).seconds ? new Date((data.exportDate as any).seconds * 1000).toLocaleDateString('vi-VN') : new Date(data.exportDate).toLocaleDateString('vi-VN') : '',
            data.materialCode || '',
            data.materialName || 'N/A',
            data.actualPO || '',
            data.correctFIFOPO || '',
            data.exportQuantity || 0,
            data.location || '',
            data.exportedBy || '',
            data.notes || ''
          ]);
        });

        // Create and download Excel file
        const ws = XLSX.utils.aoa_to_sheet(fifoData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'FIFO Violations');
        
        // Auto-size columns (updated for Factory column)
        const colWidths = [
          { wch: 5 },  // STT
          { wch: 8 },  // Factory
          { wch: 15 }, // Ngày
          { wch: 15 }, // Mã hàng
          { wch: 25 }, // Tên hàng
          { wch: 15 }, // PO sai
          { wch: 15 }, // PO đúng
          { wch: 12 }, // Số lượng
          { wch: 15 }, // Vị trí
          { wch: 20 }, // Người xuất
          { wch: 40 }  // Ghi chú
        ];
        ws['!cols'] = colWidths;

        const fileName = `FIFO_Violations_${factory}_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        console.log(`📊 Downloaded FIFO report for ${factory}: ${fileName} (${filteredDocs.length} violations)`);
      }, error => {
        console.error('❌ Error downloading FIFO report:', error);
        alert('❌ Lỗi khi tải báo cáo FIFO!');
      });
  }

  // Update methods for editable fields
  updateExported(material: InventoryMaterial): void {
    // Calculate stock properly: quantity - exported
    const calculatedStock = (material.quantity || 0) - (material.exported || 0);
    material.stock = calculatedStock; // Allow negative stock to be visible
    
    console.log('📊 Manual export update:', {
      materialCode: material.materialCode,
      quantity: material.quantity,
      exported: material.exported,
      calculatedStock: calculatedStock,
      finalStock: material.stock
    });
    
    this.updateInventoryInFirebase(material);
    this.applyFilters();
  }

  updateLocation(material: InventoryMaterial): void {
    console.log('Updated location for', material.materialCode, 'to', material.location);
    this.updateInventoryInFirebase(material);
  }

  updateType(material: InventoryMaterial): void {
    console.log('Updated type for', material.materialCode, 'to', material.type);
    this.updateInventoryInFirebase(material);
  }

  updateNotes(material: InventoryMaterial): void {
    console.log('Updated notes for', material.materialCode, 'to', material.notes);
    this.updateInventoryInFirebase(material);
    
    // Auto-resize notes column width based on content
    setTimeout(() => {
      this.autoResizeNotesColumn();
    }, 100);
  }

  // Auto-resize notes column to fit content
  private autoResizeNotesColumn(): void {
    try {
      const notesInputs = document.querySelectorAll('input[ng-reflect-model*="notes"]') as NodeListOf<HTMLInputElement>;
      notesInputs.forEach(input => {
        const content = input.value;
        if (content && content.length > 0) {
          // Calculate width based on content length
          const charWidth = 8; // Approximate character width in pixels
          const padding = 16; // Padding
          const minWidth = 100; // Minimum width
          const calculatedWidth = Math.max(minWidth, content.length * charWidth + padding);
          
          // Apply width to the input and its parent cell
          input.style.width = `${calculatedWidth}px`;
          if (input.parentElement) {
            input.parentElement.style.width = `${calculatedWidth}px`;
            input.parentElement.style.minWidth = `${calculatedWidth}px`;
          }
        }
      });
    } catch (error) {
      console.error('Error auto-resizing notes column:', error);
    }
  }

  updateRemarks(material: InventoryMaterial): void {
    console.log('Updated remarks for', material.materialCode, 'to', material.remarks);
    this.updateInventoryInFirebase(material);
  }

  updateHSD(material: InventoryMaterial): void {
    if (!this.canEditHSD) {
      alert('Bạn không có quyền chỉnh sửa HSD. Vui lòng liên hệ quản trị viên.');
      return;
    }
    console.log('Updated HSD for', material.materialCode, 'to', material.expiryDate);
    this.updateInventoryInFirebase(material);
  }

  onHSDChange(event: any, material: InventoryMaterial): void {
    if (!this.canEditHSD) {
      alert('Bạn không có quyền chỉnh sửa HSD. Vui lòng liên hệ quản trị viên.');
      return;
    }
    
    const newDate = event.target.value;
    if (newDate) {
      material.expiryDate = new Date(newDate);
    } else {
      material.expiryDate = null as any; // Allow empty HSD
    }
    
    this.updateHSD(material);
  }

  updateQualityCheck(material: InventoryMaterial, event: any): void {
    material.qualityCheck = event.checked;
    console.log('Updated qualityCheck for', material.materialCode, 'to', material.qualityCheck);
    this.updateInventoryInFirebase(material);
  }

  // Complete inventory - hide items with zero stock and delete from Firebase
  completeInventory(): void {
    this.showCompleted = !this.showCompleted;
    
    if (!this.showCompleted) {
      // Delete items with zero stock from Firebase
      const itemsToDelete = this.inventoryMaterials.filter(material => {
        const stock = material.stock || material.quantity || 0;
        return stock === 0;
      });
      
      itemsToDelete.forEach(material => {
        if (material.id) {
          this.firestore.collection('inventory-materials').doc(material.id).delete()
            .then(() => {
              console.log(`Deleted completed item from Firebase: ${material.materialCode}`);
            })
            .catch(error => {
              console.error('Error deleting completed item from Firebase:', error);
            });
        }
        
        // Add to deleted items collection
        const deletedItem = {
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          deletedAt: new Date(),
          reason: 'completed_zero_stock'
        };
        
        this.firestore.collection('inventory-deleted-items').add(deletedItem)
          .then(() => {
            console.log(`Added ${material.materialCode} to deleted items list (completed)`);
          })
          .catch(error => {
            console.error('Error adding to deleted items list:', error);
          });
      });
    }
    
    this.applyFilters();
    console.log('Inventory completion toggled:', this.showCompleted);
  }

  // Delete inventory item
  deleteInventoryItem(material: InventoryMaterial): void {
    if (confirm(`Xác nhận xóa item ${material.materialCode} khỏi Inventory?`)) {
      if (material.id) {
        // Delete from Firebase
        this.firestore.collection('inventory-materials').doc(material.id).delete()
          .then(() => {
            console.log('Inventory item deleted from Firebase successfully');
          })
          .catch(error => {
            console.error('Error deleting inventory item from Firebase:', error);
          });
      }
      
      // Add to deleted items collection to prevent re-adding
      const deletedItem = {
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        deletedAt: new Date(),
        reason: 'manual_delete'
      };
      
      this.firestore.collection('inventory-deleted-items').add(deletedItem)
        .then(() => {
          console.log(`Added ${material.materialCode} to deleted items list`);
        })
        .catch(error => {
          console.error('Error adding to deleted items list:', error);
        });
      
      // Remove from local array
      const index = this.inventoryMaterials.indexOf(material);
      if (index > -1) {
        this.inventoryMaterials.splice(index, 1);
        console.log(`Deleted inventory item: ${material.materialCode}`);
        this.applyFilters();
      }
    }
  }

  // Scan QR Code for inventory item
  async scanQRCode(material: InventoryMaterial): Promise<void> {
    try {
      // Check camera availability first
      const hasCamera = await this.checkCameraAvailability();
      if (!hasCamera) {
        alert('Không tìm thấy camera. Vui lòng sử dụng nút "Nhập thủ công" để nhập QR code.');
        return;
      }
      
      this.currentScanningMaterial = material;
      this.isScanning = true;
      
      // Wait for DOM to update and element to be created
      setTimeout(async () => {
        try {
          // Check if element exists
          const qrReaderElement = document.getElementById('qr-reader');
          if (!qrReaderElement) {
            console.error('QR reader element not found');
            alert('Lỗi: Không tìm thấy element camera. Vui lòng thử lại.');
            this.stopScanning();
            return;
          }
          
          // Initialize scanner
          this.scanner = new Html5Qrcode("qr-reader");
          
          // Start scanning
          await this.scanner.start(
            { facingMode: "environment" }, // Use back camera
            {
              fps: 15,
              qrbox: { width: 400, height: 400 },
              aspectRatio: 1.0
            },
            (decodedText, decodedResult) => {
              console.log('QR Code detected:', decodedText);
              this.onQRCodeScanned(decodedText, material);
            },
            (errorMessage) => {
              // Handle scan error
              console.log('QR scan error:', errorMessage);
            }
          ).catch(err => {
            console.error('Unable to start scanner:', err);
            if (err.message && err.message.includes('Permission')) {
              alert('Không có quyền truy cập camera. Vui lòng cho phép truy cập camera và thử lại.');
            } else {
              alert('Không thể khởi động camera. Vui lòng kiểm tra quyền truy cập camera.');
            }
            this.stopScanning();
          });
          
        } catch (error) {
          console.error('Error starting QR scanner:', error);
          alert('Có lỗi khi khởi động camera!');
          this.stopScanning();
        }
      }, 100); // Wait 100ms for DOM to update
      
    } catch (error) {
      console.error('Error in scanQRCode:', error);
      alert('Có lỗi khi khởi động camera!');
      this.stopScanning();
    }
  }

  // Scan QR Code for location change
  async scanLocationChange(material: InventoryMaterial): Promise<void> {
    try {
      // Check camera availability first
      const hasCamera = await this.checkCameraAvailability();
      if (!hasCamera) {
        alert('Không tìm thấy camera. Vui lòng sử dụng nút "Nhập thủ công" để nhập QR code.');
        return;
      }
      
      this.currentLocationChangeMaterial = material;
      this.isScanningLocationChange = true;
      
      // Wait for DOM to update and element to be created
      setTimeout(async () => {
        try {
          // Check if element exists
          const qrReaderElement = document.getElementById('qr-reader-location');
          if (!qrReaderElement) {
            console.error('QR reader location element not found');
            alert('Lỗi: Không tìm thấy element camera. Vui lòng thử lại.');
            this.stopLocationScanning();
            return;
          }
          
          // Initialize scanner
          this.scanner = new Html5Qrcode("qr-reader-location");
          
          // Start scanning
          await this.scanner.start(
            { facingMode: "environment" }, // Use back camera
            {
              fps: 15,
              qrbox: { width: 400, height: 400 },
              aspectRatio: 1.0
            },
            (decodedText, decodedResult) => {
              console.log('Location QR Code detected:', decodedText);
              this.onLocationQRCodeScanned(decodedText, material);
            },
            (errorMessage) => {
              // Handle scan error
              console.log('Location QR scan error:', errorMessage);
            }
          ).catch(err => {
            console.error('Unable to start location scanner:', err);
            if (err.message && err.message.includes('Permission')) {
              alert('Không có quyền truy cập camera. Vui lòng cho phép truy cập camera và thử lại.');
            } else {
              alert('Không thể khởi động camera. Vui lòng kiểm tra quyền truy cập camera.');
            }
            this.stopLocationScanning();
          });
          
        } catch (error) {
          console.error('Error starting location QR scanner:', error);
          alert('Có lỗi khi khởi động camera!');
          this.stopLocationScanning();
        }
      }, 100); // Wait 100ms for DOM to update
      
    } catch (error) {
      console.error('Error in scanLocationChange:', error);
      alert('Có lỗi khi khởi động camera!');
      this.stopLocationScanning();
    }
  }

  // Handle location QR code scan result
  private async onLocationQRCodeScanned(qrData: string, material: InventoryMaterial): Promise<void> {
    try {
      // Stop scanning
      this.stopLocationScanning();
      
      console.log('Scanned location QR data:', qrData);
      
      // Extract location from QR data
      // Assuming QR data contains location info or is the location itself
      let newLocation = qrData.trim();
      
      // If QR contains structured data, extract location
      if (qrData.includes('|')) {
        const parts = qrData.split('|');
        // Assume location is in a specific position, adjust as needed
        newLocation = parts[parts.length - 1] || qrData; // Use last part or full data
      }
      
      if (newLocation) {
        // Update material location
        const previousLocation = material.location;
        material.location = newLocation;
        
        // Save to Firebase
        await this.updateLocation(material);
        
        alert(`Vị trí đã được cập nhật từ "${previousLocation}" thành "${newLocation}"`);
        
        // Force UI update
        this.cdr.detectChanges();
        
      } else {
        alert('Không tìm thấy thông tin vị trí trong QR code!');
      }
      
    } catch (error) {
      console.error('Error processing location QR code:', error);
      alert('Có lỗi khi xử lý QR code vị trí!');
    }
  }

  // Stop location scanning
  private stopLocationScanning(): void {
    try {
      if (this.scanner) {
        this.scanner.stop().then(() => {
          console.log('Location scanner stopped');
          if (this.scanner) {
            this.scanner.clear();
            this.scanner = null;
          }
        }).catch(err => {
          console.error('Error stopping location scanner:', err);
          if (this.scanner) {
            this.scanner.clear();
            this.scanner = null;
          }
        });
      }
    } catch (error) {
      console.error('Error in stopLocationScanning:', error);
    }
    
    this.isScanningLocationChange = false;
    this.currentLocationChangeMaterial = null;
    this.cdr.detectChanges();
  }

  // Parse PO number to extract month, year, and sequence
  private parsePONumber(poNumber: string): {month: number, year: number, sequence: number, isValid: boolean} {
    try {
      // Expected format: PO + MMYY + / + NNNN (e.g., PO0222/0011, PO0323/0001)
      const regex = /^PO(\d{2})(\d{2})\/(\d{4})$/;
      const match = poNumber.match(regex);
      
      if (!match) {
        console.warn('⚠️ Invalid PO format:', poNumber);
        return { month: 0, year: 0, sequence: 0, isValid: false };
      }
      
      const month = parseInt(match[1]);
      const year = parseInt(match[2]) + 2000; // Convert YY to YYYY (22 -> 2022)
      const sequence = parseInt(match[3]);
      
      return { month, year, sequence, isValid: true };
    } catch (error) {
      console.error('❌ Error parsing PO number:', poNumber, error);
      return { month: 0, year: 0, sequence: 0, isValid: false };
    }
  }

  // Check FIFO rule - ensure scanning the first row for the material code based on PO sorting
  private async checkFIFORule(material: InventoryMaterial): Promise<{isValid: boolean, firstRowPO?: string}> {
    try {
      // Find all items with the same material code AND factory
      const snapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('materialCode', '==', material.materialCode)
           .where('factory', '==', this.selectedFactory || material.factory || 'ASM1') // Filter by selected factory
           .where('importStatus', '==', 'Import') // Only consider imported items
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('🔍 FIFO Check: No items found for material code:', material.materialCode, 'in factory:', this.selectedFactory || material.factory || 'ASM1');
        return { isValid: true }; // If no items found, allow the operation
      }
      
      // Convert to array and sort by FIFO logic
      const items = snapshot.docs.map(doc => {
        const data = doc.data() as InventoryMaterial;
        return {
          doc: doc,
          data: data,
          poInfo: this.parsePONumber(data.poNumber)
        };
      }).filter(item => item.poInfo.isValid); // Only valid PO formats
      
      if (items.length === 0) {
        console.log('🔍 FIFO Check: No valid PO formats found for material code:', material.materialCode, 'in factory:', this.selectedFactory || material.factory || 'ASM1');
        return { isValid: true };
      }
      
      // Sort by FIFO priority: Year ASC, Month ASC, Sequence ASC, then by document position
      items.sort((a, b) => {
        if (a.poInfo.year !== b.poInfo.year) {
          return a.poInfo.year - b.poInfo.year; // Earlier year first
        }
        if (a.poInfo.month !== b.poInfo.month) {
          return a.poInfo.month - b.poInfo.month; // Earlier month first
        }
        if (a.poInfo.sequence !== b.poInfo.sequence) {
          return a.poInfo.sequence - b.poInfo.sequence; // Lower sequence first
        }
        // If all are equal, use document ID for consistency (top row)
        return a.doc.id.localeCompare(b.doc.id);
      });
      
      // Get the first (FIFO) item after sorting
      const firstItem = items[0];
      
      console.log('🔍 FIFO Check:', {
        materialCode: material.materialCode,
        factory: this.selectedFactory || material.factory || 'ASM1',
        currentPO: material.poNumber,
        currentPOInfo: this.parsePONumber(material.poNumber),
        firstRowPO: firstItem.data.poNumber,
        firstPOInfo: firstItem.poInfo,
        totalItems: items.length,
        isValid: firstItem.data.poNumber === material.poNumber
      });
      
      // Check if the scanned item is the first (FIFO) item
      const isValid = firstItem.data.poNumber === material.poNumber;
      
      return {
        isValid: isValid,
        firstRowPO: firstItem.data.poNumber
      };
      
    } catch (error) {
      console.error('❌ Error checking FIFO rule:', error);
      // If error occurs, assume FIFO is valid to not block operations
      return { isValid: true };
    }
  }

  // Handle QR code scan result
  private async onQRCodeScanned(qrData: string, material: InventoryMaterial): Promise<void> {
    try {
      // Stop scanning
      this.stopScanning();
      
      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      
      console.log('Scanned QR data:', qrData);
      
      // Parse QR data: MaterialCode|PONumber|Quantity
      const parts = qrData.split('|');
      if (parts.length >= 3) {
        const scannedMaterialCode = parts[0];
        const scannedPONumber = parts[1];
        const scannedQuantity = parseInt(parts[2]);
        
        // Verify QR code matches the inventory item
        if (scannedMaterialCode !== material.materialCode || scannedPONumber !== material.poNumber) {
          alert('QR code không khớp với hàng trong kho!\n\nQR: ' + scannedMaterialCode + ' | ' + scannedPONumber + '\nKho: ' + material.materialCode + ' | ' + material.poNumber);
          return;
        }
        
        // Check FIFO rule - must scan the first (top) row for this material code
        const fifoCheckResult = await this.checkFIFORule(material);
        if (!fifoCheckResult.isValid) {
          const userConfirmed = confirm(`⚠️ CẢNH BÁO: VI PHẠM FIFO!\n\n` +
            `Mã hàng: ${material.materialCode}\n` +
            `PO hiện tại: ${material.poNumber}\n` +
            `PO đầu tiên (FIFO): ${fifoCheckResult.firstRowPO}\n\n` +
            `Bạn có muốn tiếp tục xuất hàng không?\n\n` +
            `⚠️ Lưu ý: Hành động này sẽ được ghi vào báo cáo vi phạm FIFO.`);
          
          if (!userConfirmed) {
            console.log('❌ User cancelled FIFO violation export');
            return;
          }
          
          // User confirmed FIFO violation - will log to FIFO report later
          console.log('⚠️ User confirmed FIFO violation export');
        }
        
        // Check if quantity is valid - use proper stock calculation
        const currentStock = this.calculateCurrentStock(material);
        
        console.log('📊 Inventory scan - Current stock details:', {
          stock: material.stock,
          quantity: material.quantity,
          exported: material.exported,
          calculatedStock: currentStock,
          requestedQuantity: scannedQuantity,
          formula: `${material.quantity || 0} - ${material.exported || 0} = ${currentStock}`
        });
        
        if (scannedQuantity > currentStock) {
          alert(`❌ Số lượng quét (${scannedQuantity}) lớn hơn tồn kho (${currentStock})!\nMã: ${material.materialCode}\nPO: ${material.poNumber}\nCông thức: ${material.quantity || 0} - ${material.exported || 0} = ${currentStock}`);
          return;
        }
        
        // Check if stock will be negative after export
        const newStock = currentStock - scannedQuantity;
        if (newStock < 0) {
          alert(`❌ Không thể xuất! Tồn kho sẽ âm sau khi xuất!\nTồn hiện tại: ${currentStock}\nXuất: ${scannedQuantity}\nSẽ còn: ${newStock}\nMã: ${material.materialCode}\nPO: ${material.poNumber}`);
          return;
        }
        
        const newExported = (material.exported || 0) + scannedQuantity;
        
        // Update inventory
        material.stock = newStock;
        material.exported = newExported;
        material.updatedAt = new Date();
        
        // Save to Firebase
        this.updateInventoryInFirebase(material);
        
        // Create outbound record
        const outboundRecord = {
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          quantity: material.quantity,
          unit: material.unit,
          exportQuantity: scannedQuantity,
          exportDate: new Date(),
          location: material.location,
          notes: `Quét QR từ Inventory - ${material.materialName || 'N/A'}`,
          exportedBy: currentUser, // Always logged-in user account
          scanMethod: 'Tablet', // Changed from 'QR_SCAN' to 'Tablet' for inventory scans
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Save to outbound-materials collection
        this.firestore.collection('outbound-materials').add(outboundRecord)
          .then((docRef) => {
            console.log('Outbound record saved with ID:', docRef.id);
            
            // If FIFO was violated, save to FIFO report
            if (!fifoCheckResult.isValid) {
              this.saveFIFOViolationReport(material, scannedQuantity, fifoCheckResult.firstRowPO!, currentUser);
            }
            
            alert(`✅ Xuất hàng thành công!\n\nMã: ${material.materialCode}\nSố lượng xuất: ${scannedQuantity}\nTồn kho mới: ${newStock}`);
          })
          .catch(error => {
            console.error('Error saving outbound record:', error);
            alert('Lỗi khi lưu record xuất hàng!');
          });
        
      } else {
        alert('QR code không hợp lệ! Vui lòng quét lại.');
      }
      
    } catch (error) {
      console.error('Error processing QR code:', error);
      alert('Có lỗi khi xử lý QR code!');
    }
  }

  // Save FIFO violation report
  private saveFIFOViolationReport(material: InventoryMaterial, exportQuantity: number, correctFIFOPO: string, exportedBy: string): void {
    const fifoReport: FIFOViolationReport = {
      factory: material.factory || 'ASM1', // Include factory information
      materialCode: material.materialCode,
      actualPO: material.poNumber,
      correctFIFOPO: correctFIFOPO,
      exportQuantity: exportQuantity,
      exportDate: new Date(),
      exportedBy: exportedBy,
      location: material.location,
      materialName: material.materialName,
      notes: `Vi phạm FIFO: Đã xuất PO ${material.poNumber} thay vì PO ${correctFIFOPO} (FIFO đúng)`,
      createdAt: new Date()
    };
    
    // Save to Firebase
    this.firestore.collection('fifo-violations').add(fifoReport)
      .then((docRef) => {
        console.log('✅ FIFO violation report saved with ID:', docRef.id);
        console.log('📋 FIFO Violation Details:', {
          materialCode: material.materialCode,
          actualPO: material.poNumber,
          correctFIFOPO: correctFIFOPO,
          exportQuantity: exportQuantity,
          exportedBy: exportedBy
        });
      })
      .catch(error => {
        console.error('❌ Error saving FIFO violation report:', error);
      });
  }

  // Stop scanning
  private stopScanning(): void {
    if (this.scanner && this.isScanning) {
      this.scanner.stop().then(() => {
        console.log('Scanner stopped successfully');
      }).catch(err => {
        console.error('Error stopping scanner:', err);
      }).finally(() => {
        this.cleanupScanner();
      });
    } else {
      this.cleanupScanner();
    }
  }

  // Cleanup scanner resources
  private cleanupScanner(): void {
    this.isScanning = false;
    this.currentScanningMaterial = null;
    this.scanner = null;
    
    // Force change detection
    this.cdr.detectChanges();
  }



  // Check camera availability
  private async checkCameraAvailability(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      return videoDevices.length > 0;
    } catch (error) {
      console.error('Error checking camera availability:', error);
      return false;
    }
  }

  // Search functionality
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value.toLowerCase();
    this.applyFilters();
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredInventory = this.inventoryMaterials.filter(material => {
      // Filter by search term
      if (this.searchTerm) {
        const searchableText = [
          material.materialCode,
          material.materialName,
          material.location,
          material.quantity?.toString(),
          material.stock?.toString(),
          material.poNumber
        ].filter(Boolean).join(' ').toLowerCase();
        
        if (!searchableText.includes(this.searchTerm)) {
          return false;
        }
      }
      
      // Filter by factory
      if (this.selectedFactory) {
        const materialFactory = material.factory || 'ASM1'; // Default to ASM1 if not set
        if (materialFactory !== this.selectedFactory) {
          return false;
        }
      }
      
      return true;
    });

    // Sort IQC items to bottom
    this.filteredInventory.sort((a, b) => {
      const aIsIQC = this.isIQCLocation(a.location);
      const bIsIQC = this.isIQCLocation(b.location);
      
      if (aIsIQC && !bIsIQC) return 1;
      if (!aIsIQC && bIsIQC) return -1;
      return 0;
    });
    
    // Mark duplicates within the selected factory
    this.markDuplicates();
    
    console.log('🔍 Filters applied for factory:', this.selectedFactory || 'All', 'Items found:', this.filteredInventory.length);
  }

  // Filter by ASM1
  filterByASM1(): void {
    console.log('Filtering by ASM1...');
    this.selectedFactory = 'ASM1';
    this.applyFilters(); // This will call markDuplicates for ASM1
  }

  // Filter by ASM2
  filterByASM2(): void {
    this.selectedFactory = 'ASM2';
    this.applyFilters();
    console.log('🔍 Filtered by ASM2');
  }

  filterByAll(): void {
    this.selectedFactory = '';
    this.applyFilters();
    console.log('🔍 Filtered by All factories');
  }

  // Format numbers with thousand separators and decimal places
  formatNumber(value: any): string {
    if (value === null || value === undefined || value === '') {
      return '0';
    }
    
    const num = parseFloat(value);
    if (isNaN(num)) {
      return '0';
    }
    
    // If it's a whole number, show without decimals
    if (num % 1 === 0) {
      return num.toLocaleString('vi-VN');
    } else {
      // If it has decimals, show with up to 2 decimal places
      return num.toLocaleString('vi-VN', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 2 
      });
    }
  }

  // Calculate current stock for display
  calculateCurrentStock(material: InventoryMaterial): number {
    // Always calculate from quantity - exported for accurate stock display
    const stock = (material.quantity || 0) - (material.exported || 0);
    return stock;
  }

  // Check if location is IQC
  isIQCLocation(location: string): boolean {
    return location && location.toUpperCase() === 'IQC';
  }

  // Check if material has duplicate PO within the same factory
  isDuplicatePO(material: InventoryMaterial): boolean {
    const duplicates = this.inventoryMaterials.filter(item => 
      item.materialCode === material.materialCode && 
      item.poNumber === material.poNumber &&
      (item.factory || 'ASM1') === (material.factory || 'ASM1') // Only check within same factory
    );
    return duplicates.length > 1;
  }

  // Check if material has negative stock within the same factory
  hasNegativeStock(material: InventoryMaterial): boolean {
    const stock = this.calculateCurrentStock(material);
    return stock < 0;
  }

  // Get count of IQC items
  getIQCCount(): number {
    return this.filteredInventory.filter(material => 
      this.isIQCLocation(material.location)
    ).length;
  }

  // Get count of negative stock items
  getNegativeStockCount(): number {
    return this.filteredInventory.filter(material => {
      const stock = this.calculateCurrentStock(material);
      return stock < 0;
    }).length;
  }

  // Load user permissions for inventory
  loadPermissions(): void {
    this.tabPermissionService.getCurrentUserTabPermissions()
      .pipe(takeUntil(this.destroy$))
      .subscribe(permissions => {
        this.canExport = permissions['inventory-export'] !== false;
        this.canDelete = permissions['inventory-delete'] !== false;
        this.canEditHSD = permissions['inventory-edit-hsd'] !== false;
        console.log('Inventory permissions loaded:', { 
          canExport: this.canExport, 
          canDelete: this.canDelete,
          canEditHSD: this.canEditHSD 
        });
      });
  }

  // Handle location change to uppercase
  onLocationChange(material: InventoryMaterial): void {
    if (material.location) {
      material.location = material.location.toUpperCase();
      this.updateLocation(material);
      this.applyFilters(); // Re-sort and re-mark duplicates after location change
    }
  }

  // Update rolls or bags
  updateRollsOrBags(material: InventoryMaterial): void {
    this.updateInventoryInFirebase(material);
  }

  // Print QR Code for import items - Updated to match Inbound style
  async printQRCode(material: InventoryMaterial): Promise<void> {
    if (!material.importStatus || material.importStatus !== 'Import') {
      alert('Chỉ có thể in QR code cho các item có trạng thái Import');
      return;
    }

    try {
      // Calculate quantity per roll/bag
      const rollsOrBags = parseFloat(material.rollsOrBags) || 1;
      const totalQuantity = material.stock || material.quantity;
      
      // Calculate how many full units we can make
      const fullUnits = Math.floor(totalQuantity / rollsOrBags);
      const remainingQuantity = totalQuantity % rollsOrBags;
      
      // Generate QR codes based on quantity per unit
      const qrCodes = [];
      
      // Add full units
      for (let i = 0; i < fullUnits; i++) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: rollsOrBags,
          qrData: `${material.materialCode}|${material.poNumber}|${rollsOrBags}`
        });
      }
      
      // Add remaining quantity if any
      if (remainingQuantity > 0) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: remainingQuantity,
          qrData: `${material.materialCode}|${material.poNumber}|${remainingQuantity}`
        });
      }

      if (qrCodes.length === 0) {
        alert('Vui lòng nhập số đơn vị trước khi tạo QR code!');
        return;
      }

      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const printDate = new Date().toLocaleDateString('vi-VN');
      const totalPages = qrCodes.length;
      
      // Generate QR code images
      const qrImages = await Promise.all(
        qrCodes.map(async (qr, index) => {
          const qrData = qr.qrData;
          const qrImage = await QRCode.toDataURL(qrData, {
            width: 240, // 30mm = 240px (8px/mm)
            margin: 1,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          return {
            ...qr,
            qrImage,
            index: index + 1,
            pageNumber: index + 1,
            totalPages: totalPages,
            printDate: printDate,
            printedBy: currentUser
          };
        })
      );

      // Create print window with real QR codes
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title></title>
              <style>
                * {
                  margin: 0 !important;
                  padding: 0 !important;
                  box-sizing: border-box !important;
                }
                
                body { 
                  font-family: Arial, sans-serif; 
                  margin: 0 !important; 
                  padding: 0 !important;
                  background: white !important;
                  overflow: hidden !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                .qr-container { 
                  display: flex !important; 
                  margin: 0 !important; 
                  padding: 0 !important; 
                  border: 1px solid #000 !important; 
                  width: 57mm !important; 
                  height: 32mm !important; 
                  page-break-inside: avoid !important;
                  background: white !important;
                  box-sizing: border-box !important;
                }
                
                .qr-section {
                  width: 30mm !important;
                  height: 30mm !important;
                  display: flex !important;
                  align-items: center !important;
                  justify-content: center !important;
                  border-right: 1px solid #ccc !important;
                  box-sizing: border-box !important;
                }
                
                .qr-image {
                  width: 28mm !important;
                  height: 28mm !important;
                  display: block !important;
                }
                
                .info-section {
                  flex: 1 !important;
                  padding: 1mm !important;
                  display: flex !important;
                  flex-direction: column !important;
                  justify-content: space-between !important;
                  font-size: 8px !important;
                  line-height: 1.1 !important;
                  box-sizing: border-box !important;
                }
                
                .info-row {
                  margin: 0.3mm 0 !important;
                  font-weight: bold !important;
                }
                
                .info-row.small {
                  font-size: 7px !important;
                  color: #666 !important;
                }
                
                .qr-grid {
                  text-align: center !important;
                  display: flex !important;
                  flex-direction: row !important;
                  flex-wrap: wrap !important;
                  align-items: flex-start !important;
                  justify-content: flex-start !important;
                  gap: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                @media print {
                  body { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    overflow: hidden !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  @page {
                    margin: 0 !important;
                    size: 57mm 32mm !important;
                    padding: 0 !important;
                  }
                  
                  .qr-container { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                    page-break-inside: avoid !important;
                    border: 1px solid #000 !important;
                  }
                  
                  .qr-section {
                    width: 30mm !important;
                    height: 30mm !important;
                  }
                  
                  .qr-image {
                    width: 28mm !important;
                    height: 28mm !important;
                  }
                  
                  .info-section {
                    font-size: 8px !important;
                    padding: 1mm !important;
                  }
                  
                  .info-row.small {
                    font-size: 7px !important;
                  }
                  
                  .qr-grid {
                    gap: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  /* Hide all browser elements */
                  @media screen {
                    body::before,
                    body::after,
                    header,
                    footer,
                    nav,
                    .browser-ui {
                      display: none !important;
                    }
                  }
                }
              </style>
            </head>
            <body>
              <div class="qr-grid">
                ${qrImages.map(qr => `
                  <div class="qr-container">
                    <div class="qr-section">
                      <img src="${qr.qrImage}" class="qr-image" alt="QR Code ${qr.index}">
                    </div>
                    <div class="info-section">
                      <div>
                        <div class="info-row">Mã: ${qr.materialCode}</div>
                        <div class="info-row">PO: ${qr.poNumber}</div>
                        <div class="info-row">Số ĐV: ${qr.unitNumber}</div>
                      </div>
                      <div>
                        <div class="info-row small">Ngày in: ${qr.printDate}</div>
                        <div class="info-row small">NV: ${qr.printedBy}</div>
                        <div class="info-row small">Trang: ${qr.pageNumber}/${qr.totalPages}</div>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
              <script>
                window.onload = function() {
                  // Remove all browser UI elements
                  document.title = '';
                  
                  // Hide browser elements
                  const style = document.createElement('style');
                  style.textContent = '@media print { body { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important; } @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; } body::before, body::after, header, footer, nav, .browser-ui { display: none !important; } }';
                  document.head.appendChild(style);
                  
                  // Remove any browser elements
                  const elementsToRemove = document.querySelectorAll('header, footer, nav, .browser-ui');
                  elementsToRemove.forEach(el => el.remove());
                  
                  setTimeout(() => {
                    window.print();
                  }, 500);
                }
              </script>
            </body>
          </html>
        `);
        newWindow.document.close();
      }
    } catch (error) {
      console.error('Error generating QR codes:', error);
      alert('Có lỗi khi tạo QR codes. Vui lòng thử lại.');
    }
  }
}
