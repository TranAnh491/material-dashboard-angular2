import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as XLSX from 'xlsx';
import { Subject, Observable } from 'rxjs';

export interface ImportProgress {
  current: number;
  total: number;
  message: string;
  status: 'processing' | 'completed' | 'error';
}

export interface StockImportItem {
  factory?: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  type: string;
  location: string;
}

export interface InventoryMaterial {
  id?: string;
  factory?: string;
  importDate: Date;
  receivedDate?: Date;
  batchNumber: string;
  materialCode: string;
  materialName?: string;
  poNumber: string;
  quantity: number;
  unit: string;
  exported?: number;
  stock?: number;
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
  isDuplicate?: boolean;
  importStatus?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class ExcelImportService {
  private progressSubject = new Subject<ImportProgress>();
  public progress$ = this.progressSubject.asObservable();

  constructor(private firestore: AngularFirestore) {}

  /**
   * Import Excel file with progress tracking and batch processing
   */
  async importStockFile(file: File, batchSize: number = 50, factoryFilter?: string, duplicateStrategy: 'skip' | 'update' | 'ask' = 'ask'): Promise<{ success: number; errors: string[]; duplicates: number; updated: number }> {
    try {
      // Read Excel file
      const stockItems = await this.readStockFile(file);
      
      if (stockItems.length === 0) {
        throw new Error('Không có dữ liệu hợp lệ trong file Excel');
      }

      // Filter by factory if specified
      const filteredItems = factoryFilter 
        ? stockItems.filter(item => item.factory === factoryFilter)
        : stockItems;

      if (filteredItems.length === 0 && factoryFilter) {
        throw new Error(`Không có dữ liệu cho factory ${factoryFilter} trong file Excel`);
      }

      // Process in batches for better performance
      const batches = this.chunkArray(filteredItems, batchSize);
      let successCount = 0;
      let duplicateCount = 0;
      let updatedCount = 0;
      const errors: string[] = [];

      this.progressSubject.next({
        current: 0,
        total: filteredItems.length,
        message: factoryFilter ? `Bắt đầu import dữ liệu cho ${factoryFilter}...` : 'Bắt đầu import dữ liệu...',
        status: 'processing'
      });

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        this.progressSubject.next({
          current: i * batchSize,
          total: filteredItems.length,
          message: `Đang xử lý batch ${i + 1}/${batches.length}...`,
          status: 'processing'
        });

        // Process batch
        const batchResult = await this.processBatch(batch, duplicateStrategy);
        successCount += batchResult.success;
        duplicateCount += batchResult.duplicates;
        updatedCount += batchResult.updated;
        errors.push(...batchResult.errors);

        // Small delay to prevent UI blocking
        await this.delay(100);
      }

      this.progressSubject.next({
        current: stockItems.length,
        total: stockItems.length,
        message: `Import hoàn thành! ${successCount} items mới, ${updatedCount} items cập nhật, ${duplicateCount} items bỏ qua`,
        status: 'completed'
      });

      return { success: successCount, errors, duplicates: duplicateCount, updated: updatedCount };

    } catch (error) {
      this.progressSubject.next({
        current: 0,
        total: 0,
        message: `Lỗi import: ${error}`,
        status: 'error'
      });
      throw error;
    }
  }

  /**
   * Read Excel file with optimized parsing
   */
  private async readStockFile(file: File): Promise<StockImportItem[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          
          // Use worker-like approach to prevent UI blocking
          setTimeout(() => {
            try {
              const workbook = XLSX.read(data, { 
                type: 'array',
                cellDates: true,
                cellNF: false,
                cellText: false
              });
              
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              
              // Optimize JSON conversion
              const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1,
                defval: '',
                blankrows: false
              });
              
              const stockItems: StockImportItem[] = [];
              
              // Skip header row and process data
              for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i] as any[];
                
                // Validate required fields
                if (this.isValidStockRow(row)) {
                  stockItems.push({
                    factory: this.cleanString(row[0]) || 'ASM1',
                    materialCode: this.cleanString(row[1]),
                    poNumber: this.cleanString(row[2]),
                    quantity: this.parseNumber(row[3]),
                    type: this.cleanString(row[4]) || '',
                    location: this.cleanString(row[5])?.toUpperCase() || 'DEFAULT'
                  });
                }
              }
              
              resolve(stockItems);
            } catch (parseError) {
              reject(new Error(`Lỗi parse file Excel: ${parseError}`));
            }
          }, 0);
          
        } catch (error) {
          reject(new Error(`Lỗi đọc file: ${error}`));
        }
      };
      
      reader.onerror = () => reject(new Error('Lỗi đọc file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Process items in batches for better performance
   */
  private async processBatch(items: StockImportItem[], duplicateStrategy: 'skip' | 'update' | 'ask' = 'ask'): Promise<{ success: number; errors: string[]; duplicates: number; updated: number }> {
    const batch = this.firestore.firestore.batch();
    let successCount = 0;
    let duplicateCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        // Check for duplicates
        const existing = await this.checkDuplicate(item);
        
        if (!existing) {
          const newInventoryItem = this.createInventoryItem(item);
          const docRef = this.firestore.collection('inventory-materials').doc().ref;
          batch.set(docRef, newInventoryItem);
          successCount++;
        } else {
          errors.push(`Duplicate: ${item.materialCode} - PO: ${item.poNumber}`);
          duplicateCount++;

          if (duplicateStrategy === 'update') {
            const updatedItem = await this.updateExistingItem(existing, item);
            const docRef = this.firestore.collection('inventory-materials').doc(existing.id).ref;
            batch.update(docRef, updatedItem);
            updatedCount++;
          } else if (duplicateStrategy === 'ask') {
            const confirm = await this.confirmUpdate(item);
            if (confirm) {
              const updatedItem = await this.updateExistingItem(existing, item);
              const docRef = this.firestore.collection('inventory-materials').doc(existing.id).ref;
              batch.update(docRef, updatedItem);
              updatedCount++;
            } else {
              // Skip updating this item
            }
          }
        }
      } catch (error) {
        errors.push(`Error processing ${item.materialCode}: ${error}`);
      }
    }

    // Commit batch
    try {
      await batch.commit();
    } catch (error) {
      errors.push(`Batch commit error: ${error}`);
    }

    return { success: successCount, errors, duplicates: duplicateCount, updated: updatedCount };
  }

  /**
   * Check for duplicate items
   */
  private async checkDuplicate(item: StockImportItem): Promise<InventoryMaterial | null> {
    try {
      const snapshot = await this.firestore
        .collection('inventory-materials', ref => 
          ref.where('materialCode', '==', item.materialCode)
             .where('poNumber', '==', item.poNumber)
             .limit(1)
        )
        .get()
        .toPromise();
      
      if (snapshot && !snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data() as InventoryMaterial;
        return { ...data, id: doc.id };
      }
      return null;
    } catch (error) {
      console.warn('Error checking duplicate:', error);
      return null; // Allow import if check fails
    }
  }

  /**
   * Create inventory item from stock data
   */
  private createInventoryItem(stockItem: StockImportItem): InventoryMaterial {
    return {
      factory: stockItem.factory || 'ASM1',
      importDate: new Date(),
      receivedDate: new Date(),
      batchNumber: `IMPORT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      materialCode: stockItem.materialCode,
      materialName: stockItem.materialCode,
      poNumber: stockItem.poNumber,
      quantity: stockItem.quantity,
      unit: 'PCS',
      exported: 0,
      stock: stockItem.quantity,
      location: stockItem.location,
      type: stockItem.type,
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      qualityCheck: false,
      isReceived: true,
      notes: 'Imported from Excel',
      rollsOrBags: '0',
      supplier: 'Import',
      remarks: '',
      isCompleted: false,
      isDuplicate: false,
      importStatus: 'Import',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /**
   * Update existing inventory item with new data
   */
  private async updateExistingItem(existing: InventoryMaterial, stockItem: StockImportItem): Promise<InventoryMaterial> {
    const updatedItem: InventoryMaterial = {
      ...existing,
      quantity: stockItem.quantity,
      receivedDate: new Date(),
      isReceived: true,
      notes: `Updated from Excel: ${existing.notes}`,
      updatedAt: new Date()
    };
    return updatedItem;
  }

  /**
   * Confirm if user wants to update an existing duplicate item
   */
  private async confirmUpdate(item: StockImportItem): Promise<boolean> {
    return new Promise(resolve => {
      const confirm = window.confirm(`Item with Material Code: ${item.materialCode}, PO: ${item.poNumber} already exists. Do you want to update it with the new quantity?`);
      resolve(confirm);
    });
  }

  /**
   * Validate stock row data
   */
  private isValidStockRow(row: any[]): boolean {
    return row && 
           row.length >= 3 && 
           this.cleanString(row[1]) && // materialCode
           this.cleanString(row[2]) && // poNumber
           this.parseNumber(row[3]) > 0; // quantity
  }

  /**
   * Clean string data
   */
  private cleanString(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  /**
   * Parse number safely
   */
  private parseNumber(value: any): number {
    if (value === null || value === undefined) return 0;
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Delay function to prevent UI blocking
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get file size in MB
   */
  getFileSizeMB(file: File): number {
    return file.size / (1024 * 1024);
  }

  /**
   * Validate file type and size
   */
  validateFile(file: File): { valid: boolean; message?: string } {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    
    const maxSizeMB = 10; // 10MB limit
    
    if (!allowedTypes.includes(file.type)) {
      return { 
        valid: false, 
        message: 'Chỉ hỗ trợ file Excel (.xlsx, .xls) hoặc CSV' 
      };
    }
    
    if (this.getFileSizeMB(file) > maxSizeMB) {
      return { 
        valid: false, 
        message: `File quá lớn. Kích thước tối đa: ${maxSizeMB}MB` 
      };
    }
    
    return { valid: true };
  }
}
