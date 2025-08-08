import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

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
  currentStock: number;
  unit: string;
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

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadInventoryFromFirebase();
    this.loadCatalogFromFirebase();
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
        this.applyFilters();
        console.log('Sorted inventory data:', this.filteredInventory.map(m => m.materialCode));
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

  // Apply search filters
  applyFilters(): void {
    this.filteredInventory = this.inventoryMaterials.filter(material => {
      // Filter by search term
      if (this.searchTerm) {
        const searchLower = this.searchTerm.toLowerCase();
        const matchesSearch = (
          material.materialCode.toLowerCase().includes(searchLower) ||
          material.batchNumber.toLowerCase().includes(searchLower) ||
          material.poNumber.toLowerCase().includes(searchLower) ||
          material.supplier.toLowerCase().includes(searchLower) ||
          material.location.toLowerCase().includes(searchLower)
        );
        if (!matchesSearch) return false;
      }
      
      // Filter by completion status
      if (!this.showCompleted) {
        const stock = material.stock || material.quantity || 0;
        if (stock === 0) return false;
      }
      
      return true;
    });

    // Sort by material code (alphabetical and numerical order) then by PO number
    this.filteredInventory.sort((a, b) => {
      // First sort by material code using natural sort (alphabetical + numerical)
      const codeComparison = this.compareMaterialCodes(a.materialCode, b.materialCode);
      if (codeComparison !== 0) return codeComparison;
      
      // Then sort by PO number
      return this.comparePONumbers(a.poNumber, b.poNumber);
    });

    // Check for duplicates and mark them
    this.markDuplicates();
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

  // Search method
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
    this.applyFilters();
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
                currentStock: Number(row[1]) || 0,
                unit: row[2].toString()
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
    const stockMap = new Map<string, StockItem>();
    stockItems.forEach(item => {
      stockMap.set(item.materialCode, item);
    });

    this.inventoryMaterials.forEach(material => {
      const stockItem = stockMap.get(material.materialCode);
      if (stockItem) {
        material.stock = stockItem.currentStock;
        material.exported = (material.quantity || 0) - stockItem.currentStock;
        if (material.exported < 0) material.exported = 0;
        this.updateInventoryInFirebase(material);
      }
    });

    this.applyFilters();
    console.log('Inventory updated with stock data');
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
      ['Mã hàng', 'Tồn kho hiện tại', 'Đơn vị'],
      ['MAT001', 100, 'm'],
      ['MAT002', 50, 'cuộn'],
      ['MAT003', 200, 'cái'],
      ['MAT004', 150, 'cái'],
      ['MAT005', 75, 'm']
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
}
