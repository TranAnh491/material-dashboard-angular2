import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { MatDialog } from '@angular/material/dialog';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { ExcelImportService } from '../../services/excel-import.service';
import { ImportProgressDialogComponent } from '../../components/import-progress-dialog/import-progress-dialog.component';

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
  private searchSubject = new Subject<string>();
  
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
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private excelImportService: ExcelImportService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    console.log('🚀 MaterialsInventoryComponent ngOnInit started');
    
    // Initialize search term
    this.searchTerm = '';
    
    // Load catalog first for material names mapping
    this.loadCatalogFromFirebase().then(() => {
      console.log('📚 Catalog loaded, inventory ready for search');
    });
    
    // Load permissions with debug
    console.log('🔐 Loading permissions...');
    this.loadPermissions();
    
    // Load factory access and set default factory
    this.loadFactoryAccess();
    
    // Load initial inventory data first, then setup search
    this.loadInitialInventoryAndSetupSearch();
    
    console.log('✅ MaterialsInventoryComponent ngOnInit completed - Search setup will happen after data loads');
  }

  // Load initial inventory and setup search mechanism
  private loadInitialInventoryAndSetupSearch(): void {
    console.log('📦 Setting up search mechanism without loading initial data...');
    
    // Don't load any data initially - only setup search
    this.inventoryMaterials = [];
    this.filteredInventory = [];
    
    // Setup search mechanism immediately
    console.log('🔍 Setting up search mechanism...');
    this.setupDebouncedSearch();
    console.log('✅ Search mechanism setup completed - No initial data loaded');
  }

  // Load factory access permissions and set default factory
  private loadFactoryAccess(): void {
    this.factoryAccessService.getCurrentUserFactoryAccess()
      .pipe(takeUntil(this.destroy$))
      .subscribe((access) => {
        // Update available factories based on user permissions
        this.availableFactories = access.availableFactories;
        
        // Set default factory if user has access
        if (access.defaultFactory && access.availableFactories.includes(access.defaultFactory)) {
          this.selectedFactory = access.defaultFactory;
        } else if (access.availableFactories.length > 0) {
          this.selectedFactory = access.defaultFactory;
        } else if (access.availableFactories.length > 0) {
          this.selectedFactory = access.availableFactories[0];
        }
        
        console.log('🏭 Factory access loaded:', {
          selectedFactory: this.selectedFactory,
          availableFactories: this.availableFactories
        });
      });
  }

  // Setup debounced search for better performance
  private setupDebouncedSearch(): void {
    console.log('🔍 Setting up debounced search with 1.5s delay');
    this.searchSubject.pipe(
      debounceTime(1500), // Đợi 1.5 giây sau khi user ngừng gõ (đợi nhập xong hết)
      distinctUntilChanged(), // Chỉ search khi search term thay đổi
      takeUntil(this.destroy$)
    ).subscribe(searchTerm => {
      console.log(`🔍 SearchSubject received: "${searchTerm}" (length: ${searchTerm.length})`);
      this.performSearch(searchTerm);
    });
    console.log('🔍 Debounced search setup completed');
  }

  // Kiểm tra user có thể chỉnh sửa inventory material của nhà máy cụ thể không
  canEditMaterial(material: InventoryMaterial): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Kiểm tra user có thể xem inventory material của nhà máy cụ thể không
  canViewMaterial(material: InventoryMaterial): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
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

  // Import current stock with optimized service
  async importCurrentStock(): Promise<void> {
    try {
      // Create file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.csv';
      
      input.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file
        const validation = this.excelImportService.validateFile(file);
        if (!validation.valid) {
          alert(validation.message);
          return;
        }

        try {
          // Show progress dialog
          const dialogRef = this.dialog.open(ImportProgressDialogComponent, {
            width: '500px',
            disableClose: true,
            data: { progress$: this.excelImportService.progress$ }
          });

          // Start import process
          const result = await this.excelImportService.importStockFile(file, 50);
          
          // Wait for dialog to close
          const dialogResult = await dialogRef.afterClosed().toPromise();
          
          // Show result
          if (result.success > 0) {
            alert(`✅ Import thành công ${result.success} items!`);
            
            // Refresh inventory data
            this.loadInventoryFromFirebase();
          }
          
          if (result.errors.length > 0) {
            console.warn('Import errors:', result.errors);
            if (result.errors.length <= 10) {
              alert(`⚠️ Có ${result.errors.length} lỗi:\n${result.errors.slice(0, 10).join('\n')}`);
            } else {
              alert(`⚠️ Có ${result.errors.length} lỗi. Xem console để biết chi tiết.`);
            }
          }
          
        } catch (error) {
          console.error('Import error:', error);
          alert(`❌ Lỗi import: ${error}`);
        }
      };
      
      input.click();
      
    } catch (error) {
      console.error('Error setting up file input:', error);
      alert('Có lỗi xảy ra khi mở file picker');
    }
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
    console.log('🗑️ deleteInventoryItem method called!');
    console.log(`🗑️ Attempting to delete inventory item: ${material.materialCode} (ID: ${material.id})`);
    console.log(`🔍 Material details:`, {
      id: material.id,
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      factory: material.factory,
      location: material.location,
      quantity: material.quantity,
      stock: material.stock
    });
    
    // Check if user has delete permission
    if (!this.canDelete) {
      console.error('❌ User does not have delete permission');
      alert('❌ Bạn không có quyền xóa item này. Vui lòng liên hệ admin để được cấp quyền.');
      return;
    }
    
    if (!material.id) {
      console.error('❌ Cannot delete item: No ID found');
      alert('❌ Không thể xóa item: Không tìm thấy ID');
      return;
    }
    
    if (confirm(`Xác nhận xóa item ${material.materialCode} khỏi Inventory?\n\nPO: ${material.poNumber}\nVị trí: ${material.location}\nSố lượng: ${material.quantity} ${material.unit}`)) {
      console.log(`✅ User confirmed deletion of ${material.materialCode}`);
      
      // Show loading state
      this.isLoading = true;
      
      // Delete from Firebase first
      console.log(`🔥 Deleting from Firebase collection 'inventory-materials' with ID: ${material.id}`);
      
      this.firestore.collection('inventory-materials').doc(material.id).delete()
        .then(() => {
          console.log('✅ Inventory item deleted from Firebase successfully');
          
          // Add to deleted items collection to prevent re-adding
          const deletedItem = {
            materialCode: material.materialCode,
            poNumber: material.poNumber,
            deletedAt: new Date(),
            reason: 'manual_delete',
            factory: material.factory || 'ASM1',
            originalQuantity: material.quantity,
            originalLocation: material.location
          };
          
          console.log(`📝 Adding to deleted items collection:`, deletedItem);
          return this.firestore.collection('inventory-deleted-items').add(deletedItem);
        })
        .then(() => {
          console.log(`✅ Added ${material.materialCode} to deleted items list`);
          
          // Remove from local array only after Firebase operations succeed
          const index = this.inventoryMaterials.indexOf(material);
          if (index > -1) {
            this.inventoryMaterials.splice(index, 1);
            console.log(`✅ Removed ${material.materialCode} from local array`);
            
            // Refresh the view
            this.applyFilters();
            
            // Show success message
            alert(`✅ Đã xóa thành công item ${material.materialCode} khỏi Inventory!\n\nPO: ${material.poNumber}\nVị trí: ${material.location}`);
          } else {
            console.warn(`⚠️ Item ${material.materialCode} not found in local array`);
          }
        })
        .catch((error) => {
          console.error('❌ Error during deletion process:', error);
          console.error('❌ Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          
          // Show error message to user
          let errorMessage = `❌ Lỗi khi xóa item ${material.materialCode}: `;
          
          if (error.code === 'permission-denied') {
            errorMessage += 'Không có quyền xóa item này. Vui lòng kiểm tra quyền truy cập Firebase.';
          } else if (error.code === 'not-found') {
            errorMessage += 'Item không tồn tại trong database.';
          } else if (error.code === 'unavailable') {
            errorMessage += 'Kết nối mạng không ổn định. Vui lòng thử lại.';
          } else if (error.code === 'failed-precondition') {
            errorMessage += 'Item đang được sử dụng bởi process khác. Vui lòng thử lại sau.';
          } else {
            errorMessage += error.message || 'Lỗi không xác định';
          }
          
          alert(errorMessage);
          
          // Log additional debug info
          console.log('🔍 Additional debug info:', {
            currentUser: this.afAuth.currentUser,
            canDelete: this.canDelete,
            materialId: material.id,
            collectionPath: 'inventory-materials'
          });
        })
        .finally(() => {
          this.isLoading = false;
        });
    } else {
      console.log(`❌ User cancelled deletion of ${material.materialCode}`);
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

  // New optimized search method
  onSearchInput(event: any): void {
    let searchTerm = event.target.value;
    console.log('🔍 Search input event:', { searchTerm, length: searchTerm.length });
    
    // Auto-convert to uppercase (only if different to avoid infinite loop)
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      console.log('🔍 Converting to uppercase:', searchTerm);
      // Use setTimeout to avoid infinite loop with ngModel
      setTimeout(() => {
        event.target.value = searchTerm;
        this.searchTerm = searchTerm;
      }, 0);
    }
    
    // Clear results immediately if search is empty
    if (!searchTerm || searchTerm.trim() === '') {
      console.log('🔍 Empty search term, calling clearSearch');
      this.clearSearch();
      return;
    }
    
    // Send to debounced search
    console.log(`🔍 Sending to searchSubject: "${searchTerm}"`);
    this.searchSubject.next(searchTerm);
  }

  // Handle search input with better uppercase conversion
  onSearchKeyUp(event: any): void {
    const searchTerm = event.target.value;
    
    // Convert to uppercase on key up
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      event.target.value = searchTerm.toUpperCase();
      this.searchTerm = searchTerm.toUpperCase();
    }
  }

  // Clear search and reset to initial state
  clearSearch(): void {
    console.log('🧹 Clearing search and resetting state...');
    console.log('🧹 Current state before clear:', {
      searchTerm: this.searchTerm,
      filteredInventoryLength: this.filteredInventory.length,
      inventoryMaterialsLength: this.inventoryMaterials.length
    });
    
    // Reset search state
    this.searchTerm = '';
    this.filteredInventory = [];
    this.inventoryMaterials = [];
    
    console.log('🧹 State after reset:', {
      searchTerm: this.searchTerm,
      filteredInventoryLength: this.filteredInventory.length,
      inventoryMaterialsLength: this.inventoryMaterials.length
    });
    
    // Return to initial state - no data displayed
    console.log('🧹 Search cleared, returning to initial state (no data displayed)');
  }



  // Perform search with Search-First approach - IMPROVED VERSION
  private async performSearch(searchTerm: string): Promise<void> {
    console.log(`🔍 performSearch called with: "${searchTerm}" (length: ${searchTerm.length})`);
    
    // Handle empty search term - just clear filtered results but keep inventory data
    if (searchTerm.length === 0) {
      this.filteredInventory = [];
      console.log('🔍 Empty search term, clearing filtered results');
      return;
    }
    
    // Chỉ search khi có ít nhất 3 ký tự để tránh mất thời gian
    if (searchTerm.length < 3) {
      this.filteredInventory = [];
      console.log(`⏰ Search term "${searchTerm}" quá ngắn (cần ít nhất 3 ký tự)`);
      return;
    }
    
    console.log(`🔍 Starting search for: "${searchTerm}"`);
    this.searchTerm = searchTerm;
    this.isLoading = true;
    
    try {
      console.log(`🔍 Searching for: "${searchTerm}" - Loading from Firebase...`);
      
      // IMPROVED: Query Firebase với nhiều điều kiện hơn để tìm kiếm toàn diện
      let querySnapshot;
      
      // Thử tìm kiếm theo materialCode trước (chính xác nhất)
      querySnapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('materialCode', '==', searchTerm)
           .limit(50)
      ).get().toPromise();
      
      // Nếu không tìm thấy, tìm kiếm theo pattern matching
      if (!querySnapshot || querySnapshot.empty) {
        console.log(`🔍 No exact match for "${searchTerm}", trying pattern search...`);
        
        // Tìm kiếm theo pattern: materialCode bắt đầu bằng searchTerm
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('materialCode', '>=', searchTerm)
             .where('materialCode', '<=', searchTerm + '\uf8ff')
             .limit(100)
        ).get().toPromise();
      }
      
      // Nếu vẫn không tìm thấy, tìm kiếm theo PO number
      if (!querySnapshot || querySnapshot.empty) {
        console.log(`🔍 No pattern match for "${searchTerm}", trying PO search...`);
        
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('poNumber', '>=', searchTerm)
             .where('poNumber', '<=', searchTerm + '\uf8ff')
             .limit(100)
        ).get().toPromise();
      }
      
      // Nếu vẫn không tìm thấy, tìm kiếm theo location
      if (!querySnapshot || querySnapshot.empty) {
        console.log(`🔍 No location match for "${searchTerm}", trying broader search...`);
        
        // Tìm kiếm rộng hơn: tìm tất cả documents và filter ở client
        querySnapshot = await this.firestore.collection('inventory-materials')
          .get()
          .pipe(takeUntil(this.destroy$))
          .toPromise();
          
        if (querySnapshot && !querySnapshot.empty) {
          // Filter ở client side
          const filteredDocs = querySnapshot.docs.filter(doc => {
            const data = doc.data() as any;
            const searchLower = searchTerm.toLowerCase();
            return (
              (data.materialCode && data.materialCode.toLowerCase().includes(searchLower)) ||
              (data.poNumber && data.poNumber.toLowerCase().includes(searchLower)) ||
              (data.location && data.location.toLowerCase().includes(searchLower)) ||
              (data.materialName && data.materialName.toLowerCase().includes(searchLower))
            );
          });
          
          // Tạo mock querySnapshot với filtered docs
          querySnapshot = {
            docs: filteredDocs,
            empty: filteredDocs.length === 0
          } as any;
        }
      }
      
      if (querySnapshot && !querySnapshot.empty) {
        console.log(`✅ Found ${querySnapshot.docs.length} documents from Firebase`);
        
        // Process search results
        this.inventoryMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate?.toDate() || new Date(),
            receivedDate: data.receivedDate?.toDate(),
            batchNumber: data.batchNumber || '',
            materialCode: data.materialCode || '',
            materialName: data.materialName || '',
            poNumber: data.poNumber || '',
            quantity: data.quantity || 0,
            unit: data.unit || '',
            exported: data.exported || 0,
            stock: data.stock || 0,
            location: data.location || '',
            type: data.type || '',
            expiryDate: data.expiryDate?.toDate() || new Date(),
            qualityCheck: data.qualityCheck || false,
            isReceived: data.isReceived || false,
            notes: data.notes || '',
            rollsOrBags: data.rollsOrBags || '',
            supplier: data.supplier || '',
            remarks: data.remarks || '',
            isCompleted: data.isCompleted || false,
            isDuplicate: data.isDuplicate || false,
            importStatus: data.importStatus || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date()
          } as InventoryMaterial;
        });
        
        // Apply factory filter if selected
        if (this.selectedFactory) {
          this.inventoryMaterials = this.inventoryMaterials.filter(item => 
            item.factory === this.selectedFactory
          );
          console.log(`🏭 After factory filter (${this.selectedFactory}): ${this.inventoryMaterials.length} items`);
        }
        
        // IMPROVED: Không cần filter thêm nữa vì đã query chính xác từ Firebase
        this.filteredInventory = [...this.inventoryMaterials];
        
        console.log(`✅ Search completed: ${this.filteredInventory.length} results from ${this.inventoryMaterials.length} loaded items`);
        
        // Debug: Log tất cả material codes tìm được
        const materialCodes = this.filteredInventory.map(item => item.materialCode);
        console.log(`🔍 Found material codes:`, materialCodes);
        
      } else {
        // No results found
        this.inventoryMaterials = [];
        this.filteredInventory = [];
        console.log(`🔍 No results found for: "${searchTerm}" after trying all search methods`);
        
        // Show user-friendly message
        if (searchTerm.length >= 2) {
          console.log(`💡 Search tips for "${searchTerm}":`);
          console.log('   - Kiểm tra chính tả');
          console.log('   - Thử tìm kiếm với ít ký tự hơn');
          console.log('   - Kiểm tra factory filter (ASM1/ASM2)');
          console.log('   - Thử tìm kiếm theo PO number');
        }
      }
      
    } catch (error) {
      console.error('❌ Error during search:', error);
      this.filteredInventory = [];
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges(); // Force UI update
      console.log(`🔍 Search completed for: "${searchTerm}"`);
    }
  }

  // Debug method to check Firebase data
  async debugFirebaseData(searchTerm: string): Promise<void> {
    console.log(`🔍 DEBUG: Checking Firebase data for "${searchTerm}"...`);
    
    try {
      // Check all documents without any filter
      const allDocs = await this.firestore.collection('inventory-materials').get().toPromise();
      console.log(`📊 Total documents in Firebase: ${allDocs?.docs.length || 0}`);
      
      if (allDocs && !allDocs.empty) {
        // Find documents with matching materialCode
        const matchingDocs = allDocs.docs.filter(doc => {
          const data = doc.data() as any;
          return data.materialCode === searchTerm;
        });
        
        console.log(`🎯 Documents with materialCode "${searchTerm}":`, matchingDocs.length);
        
        matchingDocs.forEach((doc, index) => {
          const data = doc.data() as any;
          console.log(`📋 Match ${index + 1}:`, {
            id: doc.id,
            materialCode: data.materialCode,
            factory: data.factory,
            poNumber: data.poNumber,
            location: data.location
          });
        });
        
        // Check if any documents contain the search term
        const containingDocs = allDocs.docs.filter(doc => {
          const data = doc.data() as any;
          return data.materialCode?.includes(searchTerm) || 
                 data.poNumber?.includes(searchTerm) ||
                 data.location?.includes(searchTerm);
        });
        
        console.log(`🔍 Documents containing "${searchTerm}":`, containingDocs.length);
        containingDocs.slice(0, 5).forEach((doc, index) => {
          const data = doc.data() as any;
          console.log(`📋 Contains ${index + 1}:`, {
            id: doc.id,
            materialCode: data.materialCode,
            factory: data.factory,
            poNumber: data.poNumber,
            location: data.location
          });
        });
        
        // Test direct search methods
        console.log(`🧪 Testing direct search methods...`);
        
        // Test exact match
        const exactMatch = await this.firestore.collection('inventory-materials', ref => 
          ref.where('materialCode', '==', searchTerm)
        ).get().toPromise();
        console.log(`🎯 Exact match query: ${exactMatch?.docs.length || 0} results`);
        
        // Test pattern match
        const patternMatch = await this.firestore.collection('inventory-materials', ref => 
          ref.where('materialCode', '>=', searchTerm)
             .where('materialCode', '<=', searchTerm + '\uf8ff')
        ).get().toPromise();
        console.log(`🔍 Pattern match query: ${patternMatch?.docs.length || 0} results`);
        
        if (patternMatch && !patternMatch.empty) {
          console.log(`📋 Pattern match results:`, patternMatch.docs.map(doc => {
            const data = doc.data() as any;
            return data.materialCode;
          }));
        }
      }
      
    } catch (error) {
      console.error('❌ Debug error:', error);
    }
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

  // Track by function for ngFor optimization
  trackByFn(index: number, item: any): any {
    return item.id || index;
  }

  // Status helper methods
  getStatusClass(item: InventoryMaterial): string {
    if (item.isCompleted) return 'status-completed';
    if (item.isDuplicate) return 'status-duplicate';
    if (item.importStatus === 'Import') return 'status-import';
    return 'status-active';
  }

  getStatusText(item: InventoryMaterial): string {
    if (item.isCompleted) return 'Hoàn thành';
    if (item.isDuplicate) return 'Trùng lặp';
    if (item.importStatus === 'Import') return 'Import';
    return 'Hoạt động';
  }

  getExpiryDateText(expiryDate: Date): string {
    if (!expiryDate) return 'N/A';
    
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'Hết hạn';
    if (diffDays <= 30) return `${diffDays}d`;
    if (diffDays <= 90) return `${Math.ceil(diffDays/30)}m`;
    return `${Math.ceil(diffDays/365)}y`;
  }

  // Performance monitoring
  private logPerformance(operation: string, startTime: number): void {
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    console.log(`⏱️ ${operation}: ${duration.toFixed(2)}ms`);
    
    // Log warning nếu quá chậm
    if (duration > 100) {
      console.warn(`⚠️ ${operation} chậm: ${duration.toFixed(2)}ms`);
    }
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
    console.log('🔐 loadPermissions method called');
    console.log('🔐 Current permission state before loading:', {
      canExport: this.canExport,
      canDelete: this.canDelete,
      canEditHSD: this.canEditHSD
    });
    
    this.tabPermissionService.getCurrentUserTabPermissions()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (permissions) => {
          console.log('🔐 Raw permissions received from service:', permissions);
          
          // Set default permissions if not defined - use materials-inventory specific keys
          this.canExport = permissions['materials-inventory-export'] ?? permissions['inventory-export'] ?? true;
          this.canDelete = permissions['materials-inventory-delete'] ?? permissions['inventory-delete'] ?? true;
          this.canEditHSD = permissions['materials-inventory-edit-hsd'] ?? permissions['inventory-edit-hsd'] ?? true;
          
          console.log('🔐 Permissions set after processing:', { 
            canExport: this.canExport, 
            canDelete: this.canDelete,
            canEditHSD: this.canEditHSD,
            allPermissions: permissions
          });
          
          // Log if any permissions are missing
          if (permissions['materials-inventory-delete'] === undefined && permissions['inventory-delete'] === undefined) {
            console.log('⚠️ materials-inventory-delete and inventory-delete permissions not defined, using default: true');
          }
          if (permissions['materials-inventory-export'] === undefined && permissions['inventory-export'] === undefined) {
            console.log('⚠️ materials-inventory-export and inventory-export permissions not defined, using default: true');
          }
          if (permissions['materials-inventory-edit-hsd'] === undefined && permissions['inventory-edit-hsd'] === undefined) {
            console.log('⚠️ materials-inventory-edit-hsd and inventory-edit-hsd permissions not defined, using default: true');
          }
          
          // Force change detection
          this.cdr.detectChanges();
          
          console.log('✅ Permissions loaded and change detection triggered');
        },
        error: (error) => {
          console.error('❌ Error loading permissions:', error);
          console.error('❌ Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
          });
          
          // Set default permissions on error
          this.canExport = true;
          this.canDelete = true;
          this.canEditHSD = true;
          
          console.log('⚠️ Using default permissions due to error');
          this.cdr.detectChanges();
        }
      });
  }
  
  // Debug method to check current permissions
  debugPermissions(): void {
    console.log('🔍 Current permission state:', {
      canDelete: this.canDelete,
      canExport: this.canExport,
      canEditHSD: this.canEditHSD
    });
    
    // Check current user
    this.afAuth.currentUser.then(user => {
      if (user) {
        console.log('👤 Current user:', {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName
        });
      } else {
        console.log('❌ No user logged in');
      }
    });
    
    // Show user-friendly message
    let message = '🔍 Debug Permissions:\n\n';
    message += `canDelete: ${this.canDelete}\n`;
    message += `canExport: ${this.canExport}\n`;
    message += `canEditHSD: ${this.canEditHSD}\n\n`;
    
    if (this.canDelete === undefined) {
      message += '⚠️ Quyền chưa được load\n';
    } else if (this.canDelete === false) {
      message += '❌ Không có quyền xóa\n';
      message += '\nBạn có muốn bật quyền xóa không? (Chỉ dùng cho mục đích test)\n';
      if (confirm(message + '\nNhấn OK để bật quyền xóa tạm thời.')) {
        this.canDelete = true;
        this.cdr.detectChanges();
        alert('✅ Đã bật quyền xóa tạm thời. Hãy thử lại nút xóa.');
        return;
      }
    } else if (this.canDelete === true) {
      message += '✅ Có quyền xóa\n';
    }
    
    message += '\nKiểm tra Console để xem chi tiết.';
    alert(message);
  }

  // Debug search functionality
  debugSearch(): void {
    console.log('🔍 Debug Search Functionality:');
    console.log('Search term:', this.searchTerm);
    console.log('Search subject:', this.searchSubject);
    console.log('Inventory materials count:', this.inventoryMaterials.length);
    console.log('Filtered inventory count:', this.filteredInventory.length);
    console.log('Is loading:', this.isLoading);
    console.log('Selected factory:', this.selectedFactory);
    
    // Test search subject
    console.log('🧪 Testing search subject...');
    this.searchSubject.next('TEST');
    
    // Show user-friendly message
    alert(`🔍 Search Debug Info:\n\n` +
          `Search term: "${this.searchTerm}"\n` +
          `Search length: ${this.searchTerm.length} (min: 3)\n` +
          `Debounce time: 1.5 seconds\n` +
          `Inventory items: ${this.inventoryMaterials.length}\n` +
          `Filtered results: ${this.filteredInventory.length}\n` +
          `Is loading: ${this.isLoading}\n` +
          `Factory: ${this.selectedFactory || 'All'}\n\n` +
          `Note: Search requires minimum 3 characters\n` +
          `Check console for detailed info.`);
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
