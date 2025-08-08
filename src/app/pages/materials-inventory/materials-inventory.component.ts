import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef } from '@angular/core';
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
  materialCode: string;
  poNumber: string;
  quantity: number;
  type: string;
  location: string;
}

@Component({
  selector: 'app-materials-inventory',
  templateUrl: './materials-inventory.component.html',
  styleUrls: ['./materials-inventory.component.scss']
})
export class MaterialsInventoryComponent implements OnInit, OnDestroy {
  // Data properties
  inventoryMaterials: InventoryMaterial[] = [];
  filteredInventory: InventoryMaterial[] = [];
  
  // Loading state
  isLoading = false;
  
  // Search and filter
  searchTerm = '';
  
  // Dropdown state
  isDropdownOpen = false;
  
  // Show completed items
  showCompleted = true;
  
  // QR Scanner properties
  isScanning = false;
  scanner: Html5Qrcode | null = null;
  currentScanningMaterial: InventoryMaterial | null = null;
  
  private destroy$ = new Subject<void>();

  // Permission properties
  canExport = false;
  canDelete = false;

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef,
    private tabPermissionService: TabPermissionService
  ) {}

  ngOnInit(): void {
    this.loadInventoryFromFirebase();
    this.loadCatalogFromFirebase();
    this.loadPermissions();
    // Disable auto-sync to prevent deleted items from reappearing
    // Use manual sync button instead
  }

  ngOnDestroy(): void {
    this.stopScanning();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load inventory data from Firebase
  loadInventoryFromFirebase(): void {
    this.isLoading = true;
    
    this.firestore.collection('inventory-materials')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        this.inventoryMaterials = actions
          .map(action => {
            const data = action.payload.doc.data() as any;
            const id = action.payload.doc.id;
            return {
              id: id,
              ...data,
              importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
              receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date()
            };
          });
        
        console.log('Raw inventory data before sorting:', this.inventoryMaterials.map(m => m.materialCode));
        // Apply filters and sorting initially
        this.applyFilters();
        console.log('Loaded inventory from Firebase:', this.inventoryMaterials.length);
        this.isLoading = false;
      });
  }

  // Sync received materials from inbound to inventory (one-time only)
  private syncFromInboundMaterials(): void {
    console.log('Starting one-time sync from inbound to inventory...');
    
    this.firestore.collection('inbound-materials')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((snapshot) => {
        const receivedMaterials = snapshot.docs
          .map(doc => {
            const data = doc.data() as any;
            return {
              id: doc.id,
              ...data,
              importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date()
            };
          })
          .filter(material => material.isReceived === true);

        console.log('Found received materials:', receivedMaterials.length);

        // Get current inventory items and deleted items
        Promise.all([
          this.firestore.collection('inventory-materials').get().toPromise(),
          this.firestore.collection('inventory-deleted-items').get().toPromise()
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

          console.log('Existing inventory items:', existingInventoryCodes.size);
          console.log('Deleted items:', deletedItemCodes.size);

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
                  console.log(`Added ${inboundMaterial.materialCode} to inventory with ID: ${docRef.id}`);
                  addedCount++;
                })
                .catch(error => {
                  console.error('Error adding material to inventory:', error);
                });
            }
          });

          console.log(`Sync completed. Added: ${addedCount}, Skipped (existing): ${skippedCount}, Skipped (deleted): ${deletedCount}`);
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
    
    // Count occurrences of each material code + PO combination
    this.filteredInventory.forEach(material => {
      const key = `${material.materialCode}_${material.poNumber}`;
      duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
    });

    // Mark items as duplicate if they appear more than once
    this.filteredInventory.forEach(material => {
      const key = `${material.materialCode}_${material.poNumber}`;
      material.isDuplicate = duplicateMap.get(key) > 1;
    });
  }

  // Debug method to check inventory data
  debugInventoryData(): void {
    console.log('=== DEBUG INVENTORY DATA ===');
    console.log('Total inventory materials:', this.inventoryMaterials.length);
    console.log('Filtered inventory:', this.filteredInventory.length);
    console.log('Search term:', this.searchTerm);
    console.log('Inventory materials:', this.inventoryMaterials);
    console.log('Filtered inventory:', this.filteredInventory);
    
    // Check Firebase directly for received materials
    this.firestore.collection('inbound-materials', ref => ref.where('isReceived', '==', true))
      .get()
      .subscribe(snapshot => {
        console.log('Raw Firebase received materials:', snapshot.docs.map(doc => ({
          id: doc.id,
          data: doc.data()
        })));
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

  // Load catalog from Firebase (load all chunks)
  private loadCatalogFromFirebase(): void {
    console.log('Loading catalog from Firebase...');
    
    // First check metadata
    this.firestore.collection('inventory-catalog').doc('metadata').get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((metadataDoc) => {
        if (metadataDoc.exists) {
          const metadata = metadataDoc.data() as any;
          console.log('Catalog metadata from Firebase:', metadata);
          
          // Load all chunks sequentially to ensure proper loading
          let loadedChunks = 0;
          const allCatalogItems: CatalogItem[] = [];
          
          const loadChunk = (index: number) => {
            if (index >= metadata.totalChunks) {
              console.log(`Total catalog items loaded: ${allCatalogItems.length}`);
              if (allCatalogItems.length > 0) {
                this.updateInventoryWithCatalog(allCatalogItems);
                console.log('Catalog loaded from Firebase:', allCatalogItems.length, 'items');
              } else {
                console.log('No catalog items found in Firebase');
              }
              return;
            }
            
            console.log(`Loading chunk ${index}...`);
            this.firestore.collection('inventory-catalog').doc(`chunk_${index}`).get()
              .subscribe((chunkDoc) => {
                console.log(`Checking chunk ${index}:`, chunkDoc.exists ? 'exists' : 'not found');
                if (chunkDoc.exists) {
                  const chunkData = chunkDoc.data() as any;
                  console.log(`Chunk ${index} data:`, chunkData);
                  if (chunkData.items && chunkData.items.length > 0) {
                    allCatalogItems.push(...chunkData.items);
                    console.log(`Loaded chunk ${index} with ${chunkData.items.length} items`);
                  } else {
                    console.log(`Chunk ${index} has no items`);
                  }
                } else {
                  console.log(`Chunk ${index} document does not exist`);
                }
                
                loadedChunks++;
                console.log(`Loaded ${loadedChunks}/${metadata.totalChunks} chunks`);
                
                // Load next chunk
                loadChunk(index + 1);
              }, error => {
                console.error(`Error loading chunk ${index}:`, error);
                loadedChunks++;
                loadChunk(index + 1);
              });
          };
          
          // Start loading chunks
          loadChunk(0);
        } else {
          console.log('No catalog metadata found in Firebase');
        }
      }, error => {
        console.error('Error loading catalog metadata from Firebase:', error);
      });
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

  // Update inventory with catalog data
  private updateInventoryWithCatalog(catalogItems: CatalogItem[]): void {
    console.log('Updating inventory with catalog data:', catalogItems.length, 'items');
    console.log('Catalog items:', catalogItems);
    
    const catalogMap = new Map<string, CatalogItem>();
    catalogItems.forEach(item => {
      catalogMap.set(item.materialCode, item);
      console.log(`Added to catalog map: ${item.materialCode} -> ${item.materialName}`);
    });

    console.log('Current inventory materials:', this.inventoryMaterials.map(m => m.materialCode));
    
    let updatedCount = 0;
    this.inventoryMaterials.forEach(material => {
      console.log(`Checking material: ${material.materialCode}`);
      const catalogItem = catalogMap.get(material.materialCode);
      if (catalogItem) {
        const oldName = material.materialName;
        const oldUnit = material.unit;
        
        material.materialName = catalogItem.materialName;
        material.unit = catalogItem.unit;
        
        updatedCount++;
        console.log(`Updated material ${material.materialCode}:`);
        console.log(`  Old name: ${oldName} -> New name: ${catalogItem.materialName}`);
        console.log(`  Old unit: ${oldUnit} -> New unit: ${catalogItem.unit}`);
      } else {
        console.log(`No catalog item found for material: ${material.materialCode}`);
      }
    });

    this.applyFilters();
    console.log(`Inventory updated with catalog data. Updated ${updatedCount} materials.`);
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
            if (row[0] && row[1] && row[2]) {
              stockItems.push({
                materialCode: row[0].toString(),
                poNumber: row[1].toString(),
                quantity: Number(row[2]) || 0,
                type: row[3]?.toString() || '',
                location: row[4]?.toString()?.toUpperCase() || 'DEFAULT'
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
      ['Mã hàng', 'Số P.O', 'Lượng nhập', 'Loại hình', 'Vị trí'],
      ['B001801', 'KZPO0725/0104', 300, 'Wire', 'D22'],
      ['B001802', 'KZPO0725/0117', 700, 'Cable', 'IQC'],
      ['A001803', 'KZPO0725/0118', 500, 'Component', 'E31'],
      ['R001804', 'KZPO0725/0119', 200, 'Raw Material', 'F12']
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tồn kho');
    
    XLSX.writeFile(workbook, 'Template_Ton_kho.xlsx');
    console.log('Stock template downloaded');
  }

  // Update methods for editable fields
  updateExported(material: InventoryMaterial): void {
    material.stock = (material.quantity || 0) - (material.exported || 0);
    if (material.stock < 0) material.stock = 0;
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
  }

  updateRemarks(material: InventoryMaterial): void {
    console.log('Updated remarks for', material.materialCode, 'to', material.remarks);
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
        
        // Check if quantity is valid
        const currentStock = material.stock || material.quantity || 0;
        if (scannedQuantity > currentStock) {
          alert(`Số lượng quét (${scannedQuantity}) lớn hơn tồn kho (${currentStock})!`);
          return;
        }
        
        // Calculate new stock
        const newStock = Math.max(0, currentStock - scannedQuantity);
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
          exportedBy: currentUser,
          scanMethod: 'QR_SCAN',
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Save to outbound-materials collection
        this.firestore.collection('outbound-materials').add(outboundRecord)
          .then((docRef) => {
            console.log('Outbound record saved with ID:', docRef.id);
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

  // Check if location is IQC
  isIQCLocation(location: string): boolean {
    return location && location.toUpperCase() === 'IQC';
  }

  // Check if material has duplicate PO
  isDuplicatePO(material: InventoryMaterial): boolean {
    const duplicates = this.inventoryMaterials.filter(item => 
      item.materialCode === material.materialCode && 
      item.poNumber === material.poNumber
    );
    return duplicates.length > 1;
  }

  // Get count of IQC items
  getIQCCount(): number {
    return this.filteredInventory.filter(material => 
      this.isIQCLocation(material.location)
    ).length;
  }

  // Load user permissions for inventory
  loadPermissions(): void {
    this.tabPermissionService.getCurrentUserTabPermissions()
      .pipe(takeUntil(this.destroy$))
      .subscribe(permissions => {
        this.canExport = permissions['inventory-export'] !== false;
        this.canDelete = permissions['inventory-delete'] !== false;
        console.log('Inventory permissions loaded:', { canExport: this.canExport, canDelete: this.canDelete });
      });
  }

  // Handle location change to uppercase
  onLocationChange(material: InventoryMaterial): void {
    if (material.location) {
      material.location = material.location.toUpperCase();
      this.updateLocation(material);
      this.applyFilters(); // Re-sort after location change
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
