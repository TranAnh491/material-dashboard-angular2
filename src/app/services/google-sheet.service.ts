import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { Observable, BehaviorSubject, combineLatest } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { environment } from '../../environments/environment';

interface InventoryItem {
  code: string;
  name: string;
  qty: number;
  location: string;
  unitWeight?: number; // Unit weight in grams
}

// Export interface for Materials Lifecycle data to be used in components
export interface MaterialsLifecycleItem {
  materialCode: string;           // Mã hàng
  description: string;            // Diễn giải
  poNumber: string;              // Số P.O
  stockQuantity: number;         // Tồn cuối
  ageInMonths: number;           // Tuổi Hàng (months) - số thập phân như 0.8
  expiryDate?: Date;             // Hạn sử dụng (ngày tháng) - Cột F
  shelfLifeMonths: number;       // Shelf life (số tháng) - Cột G
}

interface RackSummary {
  location: string;
  totalQty: number;
  itemCount: number;
  estimatedWeight: number;
  actualWeight?: number; // Actual weight calculated from unit weights
}

@Injectable({ providedIn: 'root' })
export class GoogleSheetService {
  private sheetId = '17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84'; // Sheet ID bạn đang dùng
  
  // Add new Materials Lifecycle sheet configuration
  private readonly MATERIALS_LIFECYCLE_SHEET_ID = '1zpwvYfYeXd0XxGkgSDY3JbhnJfwwqoyA_ir5WdP63sA';
  private readonly MATERIALS_LIFECYCLE_URL = `https://docs.google.com/spreadsheets/d/${this.MATERIALS_LIFECYCLE_SHEET_ID}/export?format=csv&gid=2068355231`;
  
  private readonly GOOGLE_SHEET_API_URL = 'https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLiw5tS8aTSNHkdKWCg0Pbmcos0Rxw9lInb7DQP-1Ssc3VeEG1Ax1JYq7EXFYORG1r8dk9WST6I0LhxP4TDSzP-eoPNVa5ni1W89AfVHEuhlt_OBWzhgEa8XdpqZLADWc79IxcRTuofKcH-V9gFT8TArwqJaGjXw_ZhpUwUl0tRzP5RotRlBMTgKuGp3wkhIqx3x0GjH7nS05mMd18-FAWi1LfmPh60BdaADw93ag7DVmd3Ijgc1SFTEIWCTmJ7aY-ezI22bqEa1mWCVgiXUtS6RmPG1rbwaBYwqMaSx&lib=M5htS5ynD3wb-V1y7S_fAzYFLglhHfAwW';
  
  // URL for unit weight data (you can update this to point to your unit weight sheet)
  private readonly UNIT_WEIGHT_API_URL = 'https://script.googleusercontent.com/macros/echo?user_content_key=YOUR_UNIT_WEIGHT_API_KEY';
  
  // URL for rack loading weight data (pre-calculated)
  private readonly RACK_LOADING_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR-af8JLCtXJ973WV7B6VzgkUQ3BPtqRdBADNWdZkNNVbJdLTBGLQJ1xvcO58w7HNVC7j8lGXQmVA-O/pub?gid=315193175&single=true&output=csv';
  
  private rackDataSubject = new BehaviorSubject<RackSummary[]>([]);
  public rackData$ = this.rackDataSubject.asObservable();

  // Add subject for pre-calculated weights
  private rackWeightsSubject = new BehaviorSubject<{position: string, weight: number}[]>([]);
  public rackWeights$ = this.rackWeightsSubject.asObservable();

  // Store unit weight data locally
  private unitWeightData: Map<string, number> = new Map();

  private db: any;

  constructor(private http: HttpClient, private auth: AuthService) {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const app = initializeApp(environment.firebase);
      this.db = getFirestore(app);
      console.log('Firebase initialized in GoogleSheetService');
    } catch (error) {
      console.error('Firebase initialization error:', error);
    }
  }

  getSheet(range: string) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}`;
    const headers = new HttpHeaders({
      Authorization: `Bearer ${this.auth.token}`,
    });

    return this.http.get(url, { headers });
  }

  updateCell(range: string, value: string) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}?valueInputOption=RAW`;
    const headers = new HttpHeaders({
      Authorization: `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });

    const body = {
      range: range,
      values: [[value]],
    };

    return this.http.put(url, body, { headers });
  }

  // Generate all rack positions (A11-A15, A21-A25, ..., A91-A95, B11-B15, etc.)
  generateAllRackPositions(): string[] {
    const positions: string[] = [];
    const rackSeries = ['A', 'B', 'C', 'D', 'E', 'F']; // A to F only
    
    // Define excluded positions
    const excludedPositions = [
      // G series (already excluded since we only go A-F)
      // F7, F8, F9 series
      'F71', 'F72', 'F73', 'F74', 'F75',
      'F81', 'F82', 'F83', 'F84', 'F85',
      'F91', 'F92', 'F93', 'F94', 'F95',
      // D9 series
      'D91', 'D92', 'D93', 'D94', 'D95',
      // E9 series
      'E91', 'E92', 'E93', 'E94', 'E95',
      // A6 series
      'A61', 'A62', 'A63', 'A64', 'A65'
    ];
    
    rackSeries.forEach(series => {
      // For each series (A, B, C, D, E, F)
      for (let level = 1; level <= 9; level++) {
        // For each level (1-9)
        for (let position = 1; position <= 5; position++) {
          // For each position (1-5)
          const rackPosition = `${series}${level}${position}`;
          
          // Only add if not in excluded list
          if (!excludedPositions.includes(rackPosition)) {
            positions.push(rackPosition);
          }
        }
      }
    });
    
    return positions.sort();
  }

  fetchInventoryData(): Observable<InventoryItem[]> {
    return this.http.get<InventoryItem[]>(this.GOOGLE_SHEET_API_URL).pipe(
      map(data => {
        // Debug: Check D44 items in raw data
        const d44Items = data.filter(item => item.location.substring(0, 3).toUpperCase() === 'D44');
        if (d44Items.length > 0) {
          console.log('🔍 Raw D44 items from Google Sheets:', d44Items);
          const totalD44Qty = d44Items.reduce((sum, item) => sum + item.qty, 0);
          console.log('📊 Total D44 quantity:', totalD44Qty);
        }
        return data;
      }),
      catchError(error => {
        console.error('Error fetching inventory data:', error);
        return of([]);
      })
    );
  }

  // Fetch unit weight data from separate source
  fetchUnitWeightData(): Observable<{code: string, unitWeight: number}[]> {
    // Return local unit weight data
    const unitWeightArray = Array.from(this.unitWeightData.entries()).map(([code, unitWeight]) => ({
      code,
      unitWeight
    }));
    
    return of(unitWeightArray);
    
    // Uncomment and update URL when you have unit weight data from external source:
    // return this.http.get<{code: string, unitWeight: number}[]>(this.UNIT_WEIGHT_API_URL).pipe(
    //   catchError(error => {
    //     console.error('Error fetching unit weight data:', error);
    //     return of([]);
    //   })
    // );
  }

  // Merge inventory data with unit weight data
  fetchInventoryWithUnitWeights(): Observable<InventoryItem[]> {
    return combineLatest([
      this.fetchInventoryData(),
      this.fetchUnitWeightData()
    ]).pipe(
      map(([inventoryData, unitWeightData]) => {
        // Create a map of code -> unit weight for quick lookup
        const unitWeightMap = new Map(
          unitWeightData.map(item => [item.code, item.unitWeight])
        );
        
        // Merge the data
        return inventoryData.map(item => ({
          ...item,
          unitWeight: unitWeightMap.get(item.code) || 0
        }));
      })
    );
  }

  fetchRackLoadingData(): Observable<RackSummary[]> {
    return this.fetchInventoryWithUnitWeights().pipe(
      map(data => this.processRackData(data))
    );
  }

  private processRackData(inventoryData: InventoryItem[]): RackSummary[] {
    const rackSummary: { [key: string]: RackSummary } = {};
    
    console.log('🔍 Processing inventory data:', inventoryData.length, 'items');
    
    // Process each inventory item
    inventoryData.forEach(item => {
      // Get first 3 characters of location (e.g., "D52" from "D52-TX")
      const locationKey = item.location.substring(0, 3).toUpperCase();
      
      // Only process main rack locations (A-F series)
      if (/^[A-F]\d{2}/.test(locationKey)) {
        if (!rackSummary[locationKey]) {
          rackSummary[locationKey] = {
            location: locationKey,
            totalQty: 0,
            itemCount: 0,
            estimatedWeight: 0,
            actualWeight: 0
          };
        }
        
        rackSummary[locationKey].totalQty += item.qty;
        rackSummary[locationKey].itemCount += 1;
        
        // Debug logging for D44
        if (locationKey === 'D44') {
          console.log(`📦 D44 item:`, {
            code: item.code,
            qty: item.qty,
            unitWeight: item.unitWeight,
            location: item.location
          });
        }
        
        // Calculate weight - ALWAYS use unit weight if available, otherwise use reasonable estimate
        if (item.unitWeight && item.unitWeight > 0) {
          // qty * unitWeight (grams) / 1000 = kg
          const itemWeightKg = (item.qty * item.unitWeight) / 1000;
          rackSummary[locationKey].actualWeight! += itemWeightKg;
          
          // Debug logging for D44
          if (locationKey === 'D44') {
            console.log(`⚖️ D44 weight calculation: ${item.qty} * ${item.unitWeight} / 1000 = ${itemWeightKg}kg`);
          }
        } else {
          // Use a more reasonable estimate based on typical material weights
          // Most materials are between 0.1kg to 2kg per item, using 0.5kg as average
          const estimatedItemWeight = 0.5;
          const itemWeightKg = item.qty * estimatedItemWeight;
          rackSummary[locationKey].estimatedWeight += itemWeightKg;
          
          // Debug logging for D44
          if (locationKey === 'D44') {
            console.log(`📊 D44 estimated weight: ${item.qty} * ${estimatedItemWeight} = ${itemWeightKg}kg (no unit weight)`);
          }
        }
      }
    });

    // Finalize weight calculations
    Object.values(rackSummary).forEach(summary => {
      // Use actual weight if available, otherwise use estimated weight
      if (summary.actualWeight && summary.actualWeight > 0) {
        summary.estimatedWeight = Math.round(summary.actualWeight);
        console.log(`✅ ${summary.location}: Using actual weight ${summary.estimatedWeight}kg`);
      } else {
        summary.estimatedWeight = Math.round(summary.estimatedWeight);
        console.log(`📊 ${summary.location}: Using estimated weight ${summary.estimatedWeight}kg`);
      }
      
      // Debug logging for D44
      if (summary.location === 'D44') {
        console.log(`🎯 D44 final calculation:`, {
          totalQty: summary.totalQty,
          actualWeight: summary.actualWeight,
          estimatedWeight: summary.estimatedWeight,
          itemCount: summary.itemCount
        });
      }
    });

    // Convert to array and sort
    const result = Object.values(rackSummary).sort((a, b) => a.location.localeCompare(b.location));
    
    // Update the subject with new data
    this.rackDataSubject.next(result);
    
    console.log('Processed rack data with unit weights:', result);
    
    // Find and log D44 specifically
    const d44Data = result.find(r => r.location === 'D44');
    if (d44Data) {
      console.log('🔍 D44 final result:', d44Data);
    }
    
    return result;
  }

  // Method to get detailed rack data for specific rack series
  getDetailedRackData(rackSeries: string): Observable<InventoryItem[]> {
    return this.fetchInventoryData().pipe(
      map(data => data.filter(item => {
        const location = item.location.substring(0, 3).toUpperCase();
        return location.startsWith(rackSeries.toUpperCase());
      }))
    );
  }

  // Method to refresh data periodically
  startAutoRefresh(intervalMs: number = 300000): void { // Default 5 minutes
    console.log(`🔄 Starting auto-refresh every ${intervalMs/1000/60} minutes`);
    
    setInterval(() => {
      console.log('🔄 Auto-refreshing rack weights...');
      this.fetchRackLoadingWeights().subscribe(
        (data) => {
          console.log('✅ Auto-refresh completed:', data.length, 'rack weights');
          // Data is automatically emitted through rackWeightsSubject in fetchRackLoadingWeights
        },
        (error) => {
          console.error('❌ Auto-refresh error:', error);
        }
      );
    }, intervalMs);
  }

  // Methods to manage unit weight data
  setUnitWeightData(unitWeights: {code: string, unitWeight: number}[]): void {
    this.unitWeightData.clear();
    unitWeights.forEach(item => {
      this.unitWeightData.set(item.code, item.unitWeight);
    });
    console.log('Unit weight data updated:', this.unitWeightData);
  }

  addUnitWeight(code: string, unitWeight: number): void {
    this.unitWeightData.set(code, unitWeight);
  }

  getUnitWeight(code: string): number {
    return this.unitWeightData.get(code) || 0;
  }

  clearUnitWeightData(): void {
    this.unitWeightData.clear();
  }

  // Import unit weight data from CSV or JSON
  importUnitWeightFromCSV(csvData: string): void {
    const lines = csvData.split('\n');
    const unitWeights: {code: string, unitWeight: number}[] = [];
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        const [code, unitWeight] = line.split(',');
        if (code && unitWeight) {
          unitWeights.push({
            code: code.trim(),
            unitWeight: parseFloat(unitWeight.trim())
          });
        }
      }
    }
    
    this.setUnitWeightData(unitWeights);
  }

  // Fetch pre-calculated rack loading data
  fetchRackLoadingWeights(): Observable<{position: string, weight: number}[]> {
    console.log('🔍 Fetching rack loading weights from:', this.RACK_LOADING_URL);
    
    return this.http.get(this.RACK_LOADING_URL, { responseType: 'text' }).pipe(
      map(csvData => {
        console.log('📄 Raw CSV data received:', csvData.substring(0, 500) + '...');
        
        const lines = csvData.split('\n');
        const rackWeights: {position: string, weight: number}[] = [];
        
        console.log('📊 Total lines in CSV:', lines.length);
        console.log('📋 First few lines:', lines.slice(0, 5));
        
        // Skip header line and process data
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) {
            // Fix: Parse CSV with proper quote handling
            const columns = this.parseCSVLine(line);
            
            if (columns.length >= 2) {
              const position = columns[0]?.replace(/"/g, '').trim();
              const weightStr = columns[1]?.replace(/"/g, '').trim();
              
              if (position && weightStr && isNaN(parseFloat(position))) {
                // Replace comma with dot for decimal parsing (European format)
                const normalizedWeight = weightStr.replace(',', '.');
                const weight = parseFloat(normalizedWeight);
                
                if (!isNaN(weight)) {
                  rackWeights.push({
                    position: position.toUpperCase(),
                    weight: weight
                  });
                  
                  // Debug specific positions
                  if (position.toUpperCase() === 'D44' || position.toUpperCase() === 'E63') {
                    console.log(`✅ Found ${position}: ${weight}kg (original: ${weightStr})`);
                  }
                }
              }
            }
          }
        }
        
        console.log('📊 Fetched rack loading weights:', rackWeights.length, 'positions');
        console.log('🔍 Sample weights:', rackWeights.slice(0, 10));
        
        // Debug: Check if D44 exists in the data
        const d44Data = rackWeights.find(item => item.position === 'D44');
        console.log('🔍 D44 data found:', d44Data);
        
        // Debug: Show all positions that start with D
        const dPositions = rackWeights.filter(item => item.position.startsWith('D'));
        console.log('🔍 All D positions:', dPositions.slice(0, 10));
        
        // Emit the data through the subject
        this.rackWeightsSubject.next(rackWeights);
        
        return rackWeights;
      }),
      catchError(error => {
        console.error('❌ Error fetching rack loading weights:', error);
        return of([]);
      })
    );
  }

  // Helper method to parse CSV line with proper quote handling
  private parseCSVLine(line: string): string[] {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    if (current) {
      result.push(current);
    }
    
    return result;
  }

  // Sync Google Sheets data to Firebase
  async syncToFirebase(): Promise<{ success: boolean, message: string, data?: any }> {
    try {
      console.log('🔄 Starting Google Sheets to Firebase sync...');
      
      // Step 1: Get data from Google Sheets
      const googleSheetsData = await this.fetchInventoryData().toPromise();
      console.log('📊 Google Sheets data retrieved:', googleSheetsData?.length, 'records');
      
      if (!googleSheetsData || googleSheetsData.length === 0) {
        return { success: false, message: 'No data found in Google Sheets' };
      }

      // Step 2: Clear existing inventory data in Firebase
      await this.clearFirebaseInventory();

      // Step 3: Transform and save data to Firebase
      const batchSize = 50; // Process in batches to avoid timeout
      let totalProcessed = 0;
      let totalErrors = 0;

      for (let i = 0; i < googleSheetsData.length; i += batchSize) {
        const batch = googleSheetsData.slice(i, i + batchSize);
        console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(googleSheetsData.length/batchSize)}`);

        for (const item of batch) {
          try {
            // Transform data format
            const inventoryItem = {
              code: item.code?.toString() || '',
              location: item.location?.toString() || '',
              qty: parseFloat(item.qty?.toString()) || 0,
              name: item.name?.toString() || item.code?.toString() || '',
              unitWeight: this.getUnitWeight(item.code?.toString() || '') || 0, // Get unit weight from imported data
              totalWeight: this.calculateItemWeight(item), // Calculate weight properly
              lastUpdated: new Date(),
              syncedAt: new Date(),
              source: 'google-sheets'
            };

            console.log(`💾 Saving item: ${inventoryItem.code} at ${inventoryItem.location} - ${inventoryItem.qty} pcs - ${inventoryItem.totalWeight.toFixed(3)}kg`);

            // Save to Firebase with auto-generated ID
            await addDoc(collection(this.db, 'inventory'), inventoryItem);
            totalProcessed++;

          } catch (error) {
            console.error('❌ Error processing item:', item, error);
            totalErrors++;
          }
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Step 4: Update sync metadata
      await this.updateSyncMetadata(totalProcessed, totalErrors);

      console.log('✅ Sync completed successfully');
      return {
        success: true,
        message: `Sync completed: ${totalProcessed} items processed, ${totalErrors} errors`,
        data: {
          totalProcessed,
          totalErrors,
          syncTime: new Date()
        }
      };

    } catch (error) {
      console.error('❌ Sync failed:', error);
      return {
        success: false,
        message: `Sync failed: ${error.message || error}`
      };
    }
  }

  // Calculate item weight properly
  private calculateItemWeight(item: any): number {
    const qty = parseFloat(item.qty?.toString()) || 0;
    const code = item.code?.toString() || '';
    const unitWeight = this.getUnitWeight(code) || 0;
    
    if (unitWeight > 0) {
      return (qty * unitWeight) / 1000; // Convert grams to kg
    }
    
    return 0; // No weight if no unit weight available
  }

  // Clear existing inventory data
  private async clearFirebaseInventory(): Promise<void> {
    try {
      console.log('🗑️ Clearing existing inventory data...');
      
      const inventoryQuery = query(collection(this.db, 'inventory'));
      const querySnapshot = await getDocs(inventoryQuery);
      
      const deletePromises = [];
      querySnapshot.forEach((doc) => {
        deletePromises.push(deleteDoc(doc.ref));
      });

      await Promise.all(deletePromises);
      console.log('✅ Cleared', querySnapshot.size, 'inventory records');
      
    } catch (error) {
      console.error('❌ Error clearing inventory:', error);
      throw error;
    }
  }

  // Update sync metadata
  private async updateSyncMetadata(totalProcessed: number, totalErrors: number): Promise<void> {
    try {
      const syncMetadata = {
        lastSyncTime: new Date(),
        totalRecords: totalProcessed,
        totalErrors: totalErrors,
        source: 'google-sheets',
        version: '1.0'
      };

      await setDoc(doc(this.db, 'sync-metadata', 'inventory-sync'), syncMetadata);
      console.log('✅ Sync metadata updated');
      
    } catch (error) {
      console.error('❌ Error updating sync metadata:', error);
    }
  }

  // Get Firebase inventory data
  async getFirebaseInventory(): Promise<any[]> {
    try {
      const inventoryQuery = query(collection(this.db, 'inventory'));
      const querySnapshot = await getDocs(inventoryQuery);
      
      const inventory = [];
      querySnapshot.forEach((doc) => {
        inventory.push({ id: doc.id, ...doc.data() });
      });

      return inventory;
    } catch (error) {
      console.error('❌ Error getting Firebase inventory:', error);
      return [];
    }
  }

  // Fetch Materials Lifecycle data from Google Sheets
  fetchMaterialsLifecycleData(): Observable<MaterialsLifecycleItem[]> {
    console.log('🔄 Fetching Materials Lifecycle data from Google Sheets...');
    
    return this.http.get(this.MATERIALS_LIFECYCLE_URL, { responseType: 'text' }).pipe(
      map(csvData => {
        try {
          console.log('📊 Raw CSV data received, length:', csvData.length);
          
          const lines = csvData.split('\n').filter(line => line.trim());
          console.log('📋 Total lines:', lines.length);
          
          if (lines.length < 2) {
            console.warn('⚠️ No data found in CSV');
            return [];
          }

          // Skip header row (line 0) and start from line 1
          const dataLines = lines.slice(1);
          const materials: MaterialsLifecycleItem[] = [];

          dataLines.forEach((line, index) => {
            try {
              const fields = this.parseCSVLine(line);
              
              if (fields.length >= 7) {
                // Map CSV columns to our interface
                // Expected columns: Mã hàng, Diễn giải, Số P.O, Tồn cuối, Tuổi Hàng, Hạn sử dụng (F), Shelf life (G)
                
                // Parse tuổi hàng - chuyển đổi dấu phẩy thành chấm cho số thập phân
                const ageString = fields[4]?.replace(/,/g, '.') || '0';
                const ageInMonths = parseFloat(ageString) || 0;
                
                // Parse hạn sử dụng từ cột F (index 5) - luôn là ngày tháng
                const expiryDateString = fields[5]?.trim() || '';
                const expiryDate = this.parseShelfLifeDate(expiryDateString);
                
                // Parse shelf life từ cột G (index 6) - luôn là số tháng
                const shelfLifeString = fields[6]?.replace(/,/g, '.') || '0';
                const shelfLifeMonths = parseFloat(shelfLifeString) || 0;

                const material: MaterialsLifecycleItem = {
                  materialCode: fields[0]?.trim() || '',
                  description: fields[1]?.trim() || '',
                  poNumber: fields[2]?.trim() || '',
                  stockQuantity: parseFloat(fields[3]?.replace(/,/g, '') || '0') || 0,
                  ageInMonths: ageInMonths,
                  expiryDate: expiryDate,
                  shelfLifeMonths: shelfLifeMonths
                };

                // Only add if material has a valid code
                if (material.materialCode && material.materialCode !== '') {
                  materials.push(material);
                  console.log(`✅ Processed: ${material.materialCode} - Age: ${material.ageInMonths} months - Expiry: ${expiryDate ? expiryDate.toLocaleDateString('vi-VN') : 'N/A'} - Shelf life: ${material.shelfLifeMonths} months`);
                }
              } else {
                console.warn(`⚠️ Invalid line ${index + 2}, not enough fields:`, fields.length, '(expected at least 7)');
              }
            } catch (error) {
              console.error(`❌ Error processing line ${index + 2}:`, error, line);
            }
          });

          console.log(`✅ Successfully processed ${materials.length} materials from Google Sheets`);
          return materials;

        } catch (error) {
          console.error('❌ Error parsing CSV data:', error);
          return [];
        }
      }),
      catchError(error => {
        console.error('❌ Error fetching Materials Lifecycle data:', error);
        return of([]);
      })
    );
  }

  // Sync Materials Lifecycle data to Firebase
  async syncMaterialsLifecycleToFirebase(): Promise<{ success: boolean, message: string, data?: any }> {
    try {
      console.log('🔄 Starting Materials Lifecycle sync to Firebase...');
      
      // Step 1: Get data from Google Sheets
      const materialsData = await this.fetchMaterialsLifecycleData().toPromise();
      console.log('📊 Materials Lifecycle data retrieved:', materialsData?.length, 'records');
      
      if (!materialsData || materialsData.length === 0) {
        return { success: false, message: 'No Materials Lifecycle data found in Google Sheets' };
      }

      // Step 2: Clear existing materials data in Firebase
      await this.clearFirebaseMaterials();

      // Step 3: Transform and save data to Firebase
      const batchSize = 50;
      let totalProcessed = 0;
      let totalErrors = 0;

      for (let i = 0; i < materialsData.length; i += batchSize) {
        const batch = materialsData.slice(i, i + batchSize);
        console.log(`📦 Processing materials batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(materialsData.length/batchSize)}`);

        for (const material of batch) {
          try {
            // Calculate expiry date based on age and shelf life
            const now = new Date();
            const manufacturingDate = new Date(now);
            manufacturingDate.setMonth(now.getMonth() - material.ageInMonths);
            
            const expiryDate = new Date(manufacturingDate);
            expiryDate.setMonth(manufacturingDate.getMonth() + material.shelfLifeMonths);

            // Transform to MaterialLifecycle format
            const materialLifecycle = {
              materialCode: material.materialCode,
              materialName: material.description,
              batchNumber: material.poNumber || `BATCH-${material.materialCode}`,
              expiryDate: expiryDate,
              manufacturingDate: manufacturingDate,
              location: this.getRandomLocation(),
              quantity: material.stockQuantity,
              supplier: this.extractSupplierFromPO(material.poNumber),
              costCenter: 'AUTO-IMPORTED',
              unitOfMeasure: this.getUnitFromDescription(material.description),
              lastUpdated: new Date(),
              syncedAt: new Date(),
              source: 'google-sheets-lifecycle',
              notes: `Age: ${material.ageInMonths} months, Shelf life: ${material.shelfLifeMonths} months`
            };

            console.log(`💾 Saving material: ${materialLifecycle.materialCode} - Qty: ${materialLifecycle.quantity}`);

            // Save to Firebase materials collection
            await addDoc(collection(this.db, 'materials'), materialLifecycle);
            totalProcessed++;

          } catch (error) {
            console.error('❌ Error processing material:', material, error);
            totalErrors++;
          }
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Step 4: Update sync metadata
      await this.updateMaterialsSyncMetadata(totalProcessed, totalErrors);

      console.log('✅ Materials Lifecycle sync completed successfully');
      return {
        success: true,
        message: `Materials sync completed: ${totalProcessed} items processed, ${totalErrors} errors`,
        data: {
          totalProcessed,
          totalErrors,
          syncTime: new Date()
        }
      };

    } catch (error) {
      console.error('❌ Materials Lifecycle sync failed:', error);
      return {
        success: false,
        message: `Sync failed: ${error.message || error}`
      };
    }
  }

  // Helper methods for Materials Lifecycle
  private async clearFirebaseMaterials(): Promise<void> {
    try {
      console.log('🗑️ Clearing existing materials data...');
      
      const materialsQuery = query(collection(this.db, 'materials'));
      const querySnapshot = await getDocs(materialsQuery);
      
      const deletePromises = [];
      querySnapshot.forEach((doc) => {
        deletePromises.push(deleteDoc(doc.ref));
      });

      await Promise.all(deletePromises);
      console.log('✅ Cleared', querySnapshot.size, 'materials records');
      
    } catch (error) {
      console.error('❌ Error clearing materials:', error);
      throw error;
    }
  }

  private async updateMaterialsSyncMetadata(totalProcessed: number, totalErrors: number): Promise<void> {
    try {
      const syncMetadata = {
        lastSyncTime: new Date(),
        totalRecords: totalProcessed,
        totalErrors: totalErrors,
        source: 'google-sheets-lifecycle',
        version: '1.0'
      };

      await setDoc(doc(this.db, 'sync-metadata', 'materials-sync'), syncMetadata);
      console.log('✅ Materials sync metadata updated');
      
    } catch (error) {
      console.error('❌ Error updating materials sync metadata:', error);
    }
  }

  private getRandomLocation(): string {
    const locations = [
      'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3',
      'D1', 'D2', 'D3', 'E1', 'E2', 'E3', 'F1', 'F2', 'F3'
    ];
    return locations[Math.floor(Math.random() * locations.length)];
  }

  private extractSupplierFromPO(poNumber: string): string {
    if (!poNumber || poNumber === '') return 'Unknown Supplier';
    
    // Extract supplier name from PO number format
    if (poNumber.includes('KZPO')) return 'Kyzen Corporation';
    if (poNumber.includes('PO')) return 'Standard Supplier';
    
    return 'Auto-detected Supplier';
  }

  private getUnitFromDescription(description: string): string {
    const desc = description.toLowerCase();
    
    if (desc.includes('kg') || desc.includes('kilogram')) return 'kg';
    if (desc.includes('gram') || desc.includes('gr')) return 'g';
    if (desc.includes('piece') || desc.includes('pcs')) return 'pcs';
    if (desc.includes('meter') || desc.includes('m')) return 'm';
    if (desc.includes('liter') || desc.includes('l')) return 'L';
    
    return 'pcs'; // Default unit
  }

  // Helper method to parse shelf life date from string
  private parseShelfLifeDate(dateStr: string): Date | undefined {
    if (!dateStr || dateStr.trim() === '') return undefined;
    
    try {
      // Try different date formats
      let date: Date;
      
      // Format: DD/MM/YYYY or DD-MM-YYYY
      if (dateStr.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/)) {
        const parts = dateStr.split(/[\/-]/);
        if (parts.length === 3) {
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1; // Month is 0-indexed
          const year = parseInt(parts[2]);
          date = new Date(year, month, day);
        } else {
          date = new Date(dateStr);
        }
      } 
      // Format: MM/DD/YYYY (US format)
      else if (dateStr.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
        date = new Date(dateStr);
      }
      // Default parse
      else {
        date = new Date(dateStr);
      }
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn('Invalid date format:', dateStr);
        return undefined;
      }
      
      return date;
    } catch (error) {
      console.error('Error parsing shelf life date:', dateStr, error);
      return undefined;
    }
  }

  // Get sync status
  async getSyncStatus(): Promise<any> {
    try {
      const syncDoc = doc(this.db, 'sync-metadata', 'inventory-sync');
      const docSnapshot = await getDocs(query(collection(this.db, 'sync-metadata'), where('__name__', '==', 'inventory-sync')));
      
      if (!docSnapshot.empty) {
        return docSnapshot.docs[0].data();
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error getting sync status:', error);
      return null;
    }
  }
}
