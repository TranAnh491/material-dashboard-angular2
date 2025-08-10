import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, catchError, shareReplay } from 'rxjs/operators';

export interface CatalogItem {
  materialCode: string;
  materialName: string;
  unit: string;
}

@Injectable({
  providedIn: 'root'
})
export class CatalogCacheService {
  private catalogCache = new Map<string, CatalogItem>();
  private catalogLoaded = false;
  private catalogLoading = false;
  
  // BehaviorSubjects for reactive updates
  private catalogStatusSubject = new BehaviorSubject<{
    loaded: boolean;
    loading: boolean;
    count: number;
    lastUpdated: Date | null;
  }>({
    loaded: false,
    loading: false,
    count: 0,
    lastUpdated: null
  });
  
  public catalogStatus$ = this.catalogStatusSubject.asObservable();
  
  // Cache for reactive catalog data
  private catalogDataSubject = new BehaviorSubject<CatalogItem[]>([]);
  public catalogData$ = this.catalogDataSubject.asObservable();

  constructor(private firestore: AngularFirestore) {
    // Try to load from localStorage first for instant access
    this.loadFromLocalStorage();
  }

  /**
   * Load catalog from Firebase with optimization
   * Returns a promise that resolves when catalog is loaded
   */
  async loadCatalogFromFirebase(): Promise<void> {
    if (this.catalogLoading) {
      console.log('🔄 Catalog loading already in progress...');
      return;
    }

    if (this.catalogLoaded && this.catalogCache.size > 0) {
      console.log('✅ Catalog already loaded from cache');
      return;
    }

    console.log('🚀 Loading catalog from Firebase with optimization...');
    this.setCatalogLoading(true);

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
        
        // Build catalog cache
        this.buildCatalogCache(allCatalogItems);
        
        // Save to localStorage for instant access next time
        this.saveToLocalStorage(allCatalogItems);
        
        console.log(`🎯 Total catalog items loaded: ${allCatalogItems.length}`);
        this.setCatalogLoaded(true, allCatalogItems.length);
        
      } else {
        console.log('⚠️ No catalog metadata found in Firebase');
        this.setCatalogLoaded(true, 0);
      }
      
    } catch (error) {
      console.error('❌ Error loading catalog:', error);
      this.setCatalogLoaded(true, 0);
    } finally {
      this.setCatalogLoading(false);
    }
  }

  /**
   * Build catalog cache for instant material name/unit lookup
   */
  private buildCatalogCache(catalogItems: CatalogItem[]): void {
    console.log('🔧 Building catalog cache for fast lookup...');
    this.catalogCache.clear();
    
    catalogItems.forEach(item => {
      this.catalogCache.set(item.materialCode, item);
    });
    
    // Update reactive data
    this.catalogDataSubject.next(catalogItems);
    
    console.log(`💾 Catalog cache built with ${this.catalogCache.size} items`);
  }

  /**
   * Get material name from cache instantly
   */
  getMaterialName(materialCode: string): string {
    const catalogItem = this.catalogCache.get(materialCode);
    return catalogItem?.materialName || 'N/A';
  }

  /**
   * Get material unit from cache instantly
   */
  getMaterialUnit(materialCode: string): string {
    const catalogItem = this.catalogCache.get(materialCode);
    return catalogItem?.unit || 'PCS';
  }

  /**
   * Get full catalog item from cache
   */
  getCatalogItem(materialCode: string): CatalogItem | undefined {
    return this.catalogCache.get(materialCode);
  }

  /**
   * Check if catalog is loaded
   */
  isCatalogLoaded(): boolean {
    return this.catalogLoaded;
  }

  /**
   * Check if catalog is currently loading
   */
  isCatalogLoading(): boolean {
    return this.catalogLoading;
  }

  /**
   * Get catalog cache size
   */
  getCatalogSize(): number {
    return this.catalogCache.size;
  }

  /**
   * Search catalog items by code or name
   */
  searchCatalog(searchTerm: string): CatalogItem[] {
    if (!searchTerm || searchTerm.length < 2) return [];
    
    const term = searchTerm.toLowerCase();
    const results: CatalogItem[] = [];
    
    this.catalogCache.forEach(item => {
      if (item.materialCode.toLowerCase().includes(term) || 
          item.materialName.toLowerCase().includes(term)) {
        results.push(item);
      }
    });
    
    return results.slice(0, 20); // Limit results
  }

  /**
   * Update catalog with new items
   */
  updateCatalog(catalogItems: CatalogItem[]): void {
    console.log('🔄 Updating catalog with new data:', catalogItems.length, 'items');
    
    // Rebuild cache
    this.buildCatalogCache(catalogItems);
    
    // Save to localStorage
    this.saveToLocalStorage(catalogItems);
    
    // Update status
    this.setCatalogLoaded(true, catalogItems.length);
    
    console.log('✅ Catalog updated successfully');
  }

  /**
   * Clear catalog cache
   */
  clearCache(): void {
    this.catalogCache.clear();
    this.catalogLoaded = false;
    this.catalogDataSubject.next([]);
    this.setCatalogStatus(false, false, 0, null);
    localStorage.removeItem('inventory-catalog-cache');
    console.log('🗑️ Catalog cache cleared');
  }

  /**
   * Save catalog to localStorage for instant access
   */
  private saveToLocalStorage(catalogItems: CatalogItem[]): void {
    try {
      const cacheData = {
        items: catalogItems,
        timestamp: new Date().toISOString(),
        version: '1.0'
      };
      localStorage.setItem('inventory-catalog-cache', JSON.stringify(cacheData));
      console.log('💾 Catalog saved to localStorage');
    } catch (error) {
      console.warn('⚠️ Could not save catalog to localStorage:', error);
    }
  }

  /**
   * Load catalog from localStorage for instant access
   */
  private loadFromLocalStorage(): void {
    try {
      const cacheData = localStorage.getItem('inventory-catalog-cache');
      if (cacheData) {
        const parsed = JSON.parse(cacheData);
        const cacheAge = Date.now() - new Date(parsed.timestamp).getTime();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (cacheAge < maxAge && parsed.items && parsed.items.length > 0) {
          this.buildCatalogCache(parsed.items);
          this.setCatalogLoaded(true, parsed.items.length);
          console.log('📱 Catalog loaded from localStorage cache');
        } else {
          console.log('⏰ LocalStorage cache expired, will load from Firebase');
          localStorage.removeItem('inventory-catalog-cache');
        }
      }
    } catch (error) {
      console.warn('⚠️ Error loading catalog from localStorage:', error);
      localStorage.removeItem('inventory-catalog-cache');
    }
  }

  /**
   * Set catalog loading state
   */
  private setCatalogLoading(loading: boolean): void {
    this.catalogLoading = loading;
    this.setCatalogStatus(this.catalogLoaded, loading, this.catalogCache.size, this.catalogStatusSubject.value.lastUpdated);
  }

  /**
   * Set catalog loaded state
   */
  private setCatalogLoaded(loaded: boolean, count: number): void {
    this.catalogLoaded = loaded;
    this.setCatalogStatus(loaded, this.catalogLoading, count, new Date());
  }

  /**
   * Set catalog status for reactive updates
   */
  private setCatalogStatus(loaded: boolean, loading: boolean, count: number, lastUpdated: Date | null): void {
    this.catalogStatusSubject.next({
      loaded,
      loading,
      count,
      lastUpdated
    });
  }

  /**
   * Force refresh catalog from Firebase
   */
  async forceRefresh(): Promise<void> {
    console.log('🔄 Force refreshing catalog...');
    this.clearCache();
    await this.loadCatalogFromFirebase();
  }
}
