import { Component, OnInit, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

interface RM1Item {
  id?: string;
  materialCode: string;
  location: string;
  quantity: number;
  po: string;
  importDate?: Date;
  description?: string;
  lastUpdated?: Date;
  factory?: string;
}

@Component({
  selector: 'app-find-rm1',
  templateUrl: './find-rm1.component.html',
  styleUrls: ['./find-rm1.component.scss']
})
export class FindRm1Component implements OnInit, OnDestroy {
  // Search properties
  searchTerm: string = '';
  searchResults: RM1Item[] = [];
  hasSearched: boolean = false;
  isLoading: boolean = false;

  // Stats
  totalItems: number = 0;
  totalLocations: number = 0;

  // Modal properties
  showDetailModal: boolean = false;
  selectedItem: RM1Item | null = null;

  // Quick filters
  quickFilters: string[] = ['Low Stock', 'High Value', 'Recent', 'Popular'];

  // Private properties
  private destroy$ = new Subject<void>();
  private allItems: RM1Item[] = [];

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.loadRM1Data();
    this.setupSearchDebounce();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Load RM1 inventory data from Firestore
   */
  private loadRM1Data(): void {
    this.isLoading = true;
    
    // Tìm kiếm trong inventory-materials collection với factory ASM1
    this.firestore.collection('inventory-materials', ref => 
      ref.where('factory', '==', 'ASM1')
    )
    .valueChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (data: any[]) => {
        this.allItems = this.parseRM1Data(data);
        this.updateStats();
        this.isLoading = false;
        console.log('RM1 data loaded:', this.allItems.length, 'items');
      },
      error: (error) => {
        console.error('Error loading RM1 data:', error);
        this.isLoading = false;
      }
    });
  }

  /**
   * Parse raw RM1 data into structured format
   */
  private parseRM1Data(data: any[]): RM1Item[] {
    const items: RM1Item[] = [];
    
    for (const row of data) {
      const materialCode = row.materialCode || row.itemCode || row.code;
      const location = row.location || row.warehouseLocation || row.storageLocation;
      const quantity = row.quantity || row.qty || row.stockQty || 0;
      const po = row.po || row.purchaseOrder || row.poNumber || 'N/A';
      const importDate = row.importDate ? new Date(row.importDate) : (row.batch ? new Date(row.batch) : undefined);
      const factory = row.factory || 'ASM1';
      
      if (materialCode && location) {
        items.push({
          id: row.id,
          materialCode: String(materialCode).trim().toUpperCase(),
          location: String(location).trim().toUpperCase(),
          quantity: Number(quantity),
          po: String(po).trim(),
          importDate: importDate,
          description: row.description || row.itemName || '',
          lastUpdated: row.lastUpdated ? new Date(row.lastUpdated) : new Date(),
          factory: factory
        });
      }
    }
    
    return items;
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    this.totalItems = this.allItems.length;
    const uniqueLocations = new Set(this.allItems.map(item => item.location));
    this.totalLocations = uniqueLocations.size;
  }

  /**
   * Setup search debounce for better performance
   */
  private setupSearchDebounce(): void {
    // This will be implemented with proper RxJS operators
  }

  /**
   * Handle search input changes
   */
  onSearchInput(event: any): void {
    const value = event.target.value.toUpperCase();
    this.searchTerm = value;
    event.target.value = value;
    
    if (value.length >= 2) {
      this.performSearch();
    } else if (value.length === 0) {
      this.clearResults();
    }
  }

  /**
   * Perform search operation
   */
  performSearch(): void {
    if (!this.searchTerm.trim()) {
      this.clearResults();
      return;
    }

    this.isLoading = true;
    this.hasSearched = true;

    // Simulate search delay for better UX
    setTimeout(() => {
      this.searchResults = this.searchItems(this.searchTerm.trim());
      this.isLoading = false;
    }, 300);
  }

  /**
   * Search items based on search term
   */
  private searchItems(searchTerm: string): RM1Item[] {
    const term = searchTerm.toLowerCase();
    
    return this.allItems.filter(item => 
      item.materialCode.toLowerCase().includes(term) ||
      item.location.toLowerCase().includes(term) ||
      item.po.toLowerCase().includes(term) ||
      (item.importDate && item.importDate.toString().toLowerCase().includes(term)) ||
      (item.description && item.description.toLowerCase().includes(term))
    );
  }

  /**
   * Clear search results
   */
  clearResults(): void {
    this.searchResults = [];
    this.hasSearched = false;
  }

  /**
   * Clear search term
   */
  clearSearch(): void {
    this.searchTerm = '';
    this.clearResults();
  }

  /**
   * Apply quick filter
   */
  applyQuickFilter(filter: string): void {
    switch (filter) {
      case 'Low Stock':
        this.searchResults = this.allItems.filter(item => item.quantity < 10);
        break;
      case 'High Value':
        this.searchResults = this.allItems.filter(item => item.quantity > 100);
        break;
      case 'Recent':
        this.searchResults = this.allItems
          .filter(item => item.lastUpdated)
          .sort((a, b) => (b.lastUpdated?.getTime() || 0) - (a.lastUpdated?.getTime() || 0))
          .slice(0, 20);
        break;
      case 'Popular':
        // Sort by quantity (most popular items)
        this.searchResults = [...this.allItems]
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 20);
        break;
    }
    
    this.hasSearched = true;
    this.searchTerm = filter;
  }

  /**
   * Copy item code to clipboard
   */
  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      // Could add toast notification here
      console.log('Copied to clipboard:', text);
    });
  }

  /**
   * Fill material code to other tabs
   */
  fillMaterialCode(item: RM1Item): void {
    // Tạo object chứa thông tin đầy đủ để fill
    const fillData = {
      materialCode: item.materialCode,
      po: item.po,
      importDate: item.importDate,
      location: item.location,
      quantity: item.quantity
    };
    
    // Lưu vào localStorage để các tab khác có thể đọc
    localStorage.setItem('findRM1_fillData', JSON.stringify(fillData));
    
    // Hiển thị thông báo
    console.log('✅ Đã fill mã hàng:', fillData);
    
    // Có thể mở tab Materials ASM1 hoặc tab khác
    // window.open('/#/materials-asm1', '_blank');
  }

  /**
   * Show item on map
   */
  showOnMap(location: string): void {
    // Navigate to layout/map component with location parameter
    console.log('Show location on map:', location);
    // this.router.navigate(['/layout'], { queryParams: { location } });
  }

  /**
   * Show item detail modal
   */
  showItemDetail(item: RM1Item): void {
    this.selectedItem = item;
    this.showDetailModal = true;
  }

  /**
   * Close detail modal
   */
  closeDetailModal(): void {
    this.showDetailModal = false;
    this.selectedItem = null;
  }

  /**
   * Edit item
   */
  editItem(item: RM1Item): void {
    console.log('Edit item:', item);
    // Navigate to edit page or open edit modal
  }

  /**
   * Export search results
   */
  exportResults(): void {
    if (this.searchResults.length === 0) return;

    const csvContent = this.convertToCSV(this.searchResults);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `rm1_search_results_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  /**
   * Convert search results to CSV format
   */
  private convertToCSV(data: RM1Item[]): string {
    const headers = ['Mã hàng', 'Vị trí', 'Tồn kho', 'PO/Description', 'Mô tả', 'Cập nhật lần cuối'];
    const rows = data.map(item => [
      item.materialCode,
      item.location,
      item.quantity,
      item.po,
      item.description || '',
      item.lastUpdated ? item.lastUpdated.toLocaleDateString('vi-VN') : ''
    ]);

    return [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
  }

  /**
   * Get status class based on quantity
   */
  getStatusClass(quantity: number): string {
    if (quantity === 0) return 'out-of-stock';
    if (quantity < 10) return 'low-stock';
    return 'in-stock';
  }

  /**
   * Get status text based on quantity
   */
  getStatusText(quantity: number): string {
    if (quantity === 0) return 'Hết hàng';
    if (quantity < 10) return 'Sắp hết';
    return 'Còn hàng';
  }

  /**
   * Track items by material code for better performance
   */
  trackByItemCode(index: number, item: RM1Item): string {
    return item.materialCode;
  }

  /**
   * Get warehouse map SVG with highlighted locations
   */
  getWarehouseMapSVG(): string {
    const highlightedLocations = this.getHighlightedLocations();
    console.log('Generating map with highlighted locations:', highlightedLocations);
    return this.loadAndHighlightSVG(highlightedLocations);
  }

  /**
   * Extract highlighted locations from search results
   */
  private getHighlightedLocations(): string[] {
    const locations: string[] = [];
    
    console.log('🔍 Processing search results for highlighting:');
    console.log('Search results count:', this.searchResults.length);
    
    for (const item of this.searchResults) {
      console.log(`Item: ${item.materialCode} - Location: ${item.location}`);
      if (item.location) {
        const processedLocation = this.processLocationString(item.location);
        console.log(`  → Processed: ${processedLocation}`);
        if (processedLocation) {
          locations.push(processedLocation);
          console.log(`  ✅ Added to highlight list: ${processedLocation}`);
        } else {
          console.log(`  ❌ No mapping found for: ${item.location}`);
        }
      } else {
        console.log(`  ❌ No location for item: ${item.materialCode}`);
      }
    }
    
    const uniqueLocations = [...new Set(locations)];
    console.log('🎯 Final highlighted locations:', uniqueLocations);
    return uniqueLocations;
  }

  /**
   * Process location string to extract rack code
   * Special handling for new format: T1.2(R) → T1(R), Q1.3(L) → Q1(L)
   * Special handling for Q,R,S,T,U,V,W,X,Y,Z,H: take 3 characters after cleaning
   * Examples: "TL27" → "TL2", "TL.27" → "TL2", "TL-27" → "TL2", "T.L.2.7" → "TL2"
   * Examples: "D33", "D3.3", "D.3.3-A" → "D3"
   * Examples: "F43", "F4.3", "F.4.3-A" → "F4"
   * Special cases: "IQC", "NG", "Admin" → null (not rack locations)
   * Merged racks: G8, G9 → G7; F8, F9 → F7
   */
  private processLocationString(location: string): string | null {
    if (!location) return null;
    
    // Handle special non-rack locations
    const specialLocations = ['IQC', 'NG', 'ADMIN', 'QUALITY', 'SECURED', 'OFFICE', 'FORKLIFT', 'INBOUND', 'OUTBOUND'];
    const upperLocation = location.toUpperCase();
    
    for (const special of specialLocations) {
      if (upperLocation.includes(special)) {
        return null; // Don't highlight special areas
      }
    }
    
    // Handle new format locations like T1.2(R), Q1.3(L), etc.
    // Pattern: [Letter][Number].[Number]([L|R])
    const newFormatPattern = /^([A-Z])(\d+)\.(\d+)\(([LR])\)$/i;
    const newFormatMatch = location.match(newFormatPattern);
    
    if (newFormatMatch) {
      const [, letter, firstNum, secondNum, side] = newFormatMatch;
      const simplifiedCode = `${letter}${firstNum}(${side})`;
      console.log(`📍 New format mapping: ${location} → ${simplifiedCode}`);
      return simplifiedCode;
    }
    
    // Remove all special characters and keep only alphanumeric
    const cleaned = location.replace(/[^A-Z0-9]/g, '');
    
    if (cleaned.length >= 2) {
      const firstChar = cleaned.charAt(0);
      const specialPrefixes = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'H'];
      
      if (specialPrefixes.includes(firstChar)) {
        // For special prefixes (Q,R,S,T,U,V,W,X,Y,Z,H): take 3 characters
        if (cleaned.length >= 3) {
          const threeChar = cleaned.substring(0, 3);
          console.log(`📍 Special prefix mapping: ${location} → ${threeChar}`);
          return threeChar; // Return TL2, Q12, etc.
        } else if (cleaned.length >= 2) {
          const twoChar = cleaned.substring(0, 2);
          console.log(`📍 Special prefix mapping (2 chars): ${location} → ${twoChar}`);
          return twoChar; // Return Q1, T1, etc.
        }
      } else {
        // For other prefixes (A,B,C,D,E,F,G,I,J,K,L,M,N,O,P): take 2 characters
        let rackCode = cleaned.substring(0, 2);
        
        // Handle merged racks: G8, G9 → G7; F8, F9 → F7
        if (rackCode === 'G8' || rackCode === 'G9') {
          rackCode = 'G7';
          console.log(`📍 Merged rack mapping: ${location} → ${rackCode}`);
        } else if (rackCode === 'F8' || rackCode === 'F9') {
          rackCode = 'F7';
          console.log(`📍 Merged rack mapping: ${location} → ${rackCode}`);
        }
      
      // Validate format: Letter + Number
      if (/^[A-Z][0-9]$/.test(rackCode)) {
          console.log(`📍 Standard mapping: ${location} → ${rackCode}`);
        return rackCode;
        }
      }
    }
    
    console.log(`📍 No mapping found for: ${location}`);
    return null;
  }

  /**
   * Load and highlight the original LayoutD.svg file
   */
  private loadAndHighlightSVG(highlightedLocations: string[]): string {
    // Original SVG content from LayoutD.svg
    let svgContent = `<svg width="100%" height="auto" viewBox="0 0 340 540" xmlns="http://www.w3.org/2000/svg" style="max-width: 100%; height: auto;">
  <!-- 
    Layout kho hàng.
    Quy ước tỉ lệ: 1 mét = 10 pixels.
    Kích thước kho: 30m x 50m (300x500 pixels).
    Kích thước kệ nhỏ: 1m x 3m (10x30 pixels).
  -->

  <!-- Tường kho (32m x 52m) -->
  <rect x="0" y="0" width="320" height="520" fill="#f9f9f9" stroke="#333" stroke-width="2"/>
  
  <!-- NG Area -->
  <g data-loc="NG">
    <rect x="255" y="15" width="50" height="50" fill="white" stroke="#333" stroke-width="1"/>
    <text x="280" y="40" font-family="Arial" font-size="10" text-anchor="middle" dominant-baseline="middle">NG</text>
  </g>

  <!-- Văn phòng & Khu vực trái -->
  <g font-family="Arial" text-anchor="middle" dominant-baseline="middle" transform="translate(-5, 0)">
      <!-- Admin Area -->
      <g data-loc="Admin">
        <rect x="15" y="11" width="80" height="59" fill="none" stroke="#333" stroke-width="1"/>
        <text x="55" y="41" font-size="10">Admin</text>
      </g>

      <!-- Quality Office -->
      <g data-loc="Quality">
        <rect x="15" y="70" width="70" height="60" fill="none" stroke="#333" stroke-width="1"/>
        <text x="50" y="100" font-size="10">Quality</text>
      </g>
      
      <!-- Secured WH -->
      <g data-loc="Secured WH">
        <rect x="15" y="130" width="70" height="200" fill="none" stroke="#333" stroke-width="1"/>
        <text x="50" y="320" font-size="10">Secured WH</text>
      </g>
      <!-- Kệ trong Secured WH -->
      <g font-size="3" text-anchor="middle" dominant-baseline="middle">
        <!-- Row Q: y=132 - Tên vị trí căn giữa trái phải trên dưới -->
        <g data-loc="Q3(L)" data-cell-id="cell-q3l"><rect x="17" y="132" width="15" height="5" fill="${highlightedLocations.includes('Q3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Q3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Q3(L)') ? '2' : '0.5'}"/><text x="24.5" y="134.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Q3(L)</text></g>
        <g data-loc="Q2(L)" data-cell-id="cell-q2l"><rect x="34" y="132" width="15" height="5" fill="${highlightedLocations.includes('Q2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Q2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Q2(L)') ? '2' : '0.5'}"/><text x="41.5" y="134.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Q2(L)</text></g>
        <g data-loc="Q1(L)" data-cell-id="cell-q1l"><rect x="51" y="132" width="15" height="5" fill="${highlightedLocations.includes('Q1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Q1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Q1(L)') ? '2' : '0.5'}"/><text x="58.5" y="134.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Q1(L)</text></g>
        
        <!-- Kệ A12 - Mở rộng viền không đè lên tên vị trí -->
        <g data-loc="NVL-A12" data-cell-id="cell-nvl-a12">
          <rect x="70" y="131" width="12" height="7" fill="${highlightedLocations.includes('NVL-A12') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('NVL-A12') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('NVL-A12') ? '2' : '0.5'}"/>
          <text x="76" y="134.5" font-size="3" text-anchor="middle" dominant-baseline="middle">NVL-A12</text>
        </g>
        
        <!-- Row R: y=147 - Tên vị trí căn giữa trái phải trên dưới -->
        <g data-loc="R3(R)" data-cell-id="cell-r3r"><rect x="17" y="147" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="24.5" y="149.5" font-size="3" text-anchor="middle" dominant-baseline="middle">R3(R)</text></g><g data-loc="R3(L)" data-cell-id="cell-r3l"><rect x="17" y="152" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="24.5" y="154.5" font-size="3" text-anchor="middle" dominant-baseline="middle">R3(L)</text></g>
        <g data-loc="R2(R)" data-cell-id="cell-r2r"><rect x="34" y="147" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="41.5" y="149.5" font-size="3" text-anchor="middle" dominant-baseline="middle">R2(R)</text></g><g data-loc="R2(L)" data-cell-id="cell-r2l"><rect x="34" y="152" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="41.5" y="154.5" font-size="3" text-anchor="middle" dominant-baseline="middle">R2(L)</text></g>
        <g data-loc="R1(R)" data-cell-id="cell-r1r"><rect x="51" y="147" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="58.5" y="149.5" font-size="3" text-anchor="middle" dominant-baseline="middle">R1(R)</text></g><g data-loc="R1(L)" data-cell-id="cell-r1l"><rect x="51" y="152" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="58.5" y="154.5" font-size="3" text-anchor="middle" dominant-baseline="middle">R1(L)</text></g>
        <!-- Row S: y=162 -->
        <g data-loc="S3(R)" data-cell-id="cell-s3r"><rect x="17" y="162" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="24.5" y="164.5" font-size="3" text-anchor="middle" dominant-baseline="middle">S3(R)</text></g><g data-loc="S3(L)" data-cell-id="cell-s3l"><rect x="17" y="167" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="24.5" y="169.5" font-size="3" text-anchor="middle" dominant-baseline="middle">S3(L)</text></g>
        <g data-loc="S2(R)" data-cell-id="cell-s2r"><rect x="34" y="162" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="41.5" y="164.5" font-size="3" text-anchor="middle" dominant-baseline="middle">S2(R)</text></g><g data-loc="S2(L)" data-cell-id="cell-s2l"><rect x="34" y="167" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="41.5" y="169.5" font-size="3" text-anchor="middle" dominant-baseline="middle">S2(L)</text></g>
        <g data-loc="S1(R)" data-cell-id="cell-s1r"><rect x="51" y="162" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="58.5" y="164.5" font-size="3" text-anchor="middle" dominant-baseline="middle">S1(R)</text></g><g data-loc="S1(L)" data-cell-id="cell-s1l"><rect x="51" y="167" width="15" height="5" fill="white" stroke="#000" stroke-width="0.5"/><text x="58.5" y="169.5" font-size="3" text-anchor="middle" dominant-baseline="middle">S1(L)</text></g>
        <!-- Row T: y=177 -->
        <g data-loc="T3(R)" data-cell-id="cell-t3r"><rect x="17" y="177" width="15" height="5" fill="${highlightedLocations.includes('T3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('T3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('T3(R)') ? '2' : '0.5'}"/><text x="24.5" y="179.5" font-size="3" text-anchor="middle" dominant-baseline="middle">T3(R)</text></g><g data-loc="T3(L)" data-cell-id="cell-t3l"><rect x="17" y="182" width="15" height="5" fill="${highlightedLocations.includes('T3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('T3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('T3(L)') ? '2' : '0.5'}"/><text x="24.5" y="184.5" font-size="3" text-anchor="middle" dominant-baseline="middle">T3(L)</text></g>
        <g data-loc="T2(R)" data-cell-id="cell-t2r"><rect x="34" y="177" width="15" height="5" fill="${highlightedLocations.includes('T2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('T2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('T2(R)') ? '2' : '0.5'}"/><text x="41.5" y="179.5" font-size="3" text-anchor="middle" dominant-baseline="middle">T2(R)</text></g><g data-loc="T2(L)" data-cell-id="cell-t2l"><rect x="34" y="182" width="15" height="5" fill="${highlightedLocations.includes('T2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('T2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('T2(L)') ? '2' : '0.5'}"/><text x="41.5" y="184.5" font-size="3" text-anchor="middle" dominant-baseline="middle">T2(L)</text></g>
        <g data-loc="T1(R)" data-cell-id="cell-t1r"><rect x="51" y="177" width="15" height="5" fill="${highlightedLocations.includes('T1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('T1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('T1(R)') ? '2' : '0.5'}"/><text x="58.5" y="179.5" font-size="3" text-anchor="middle" dominant-baseline="middle">T1(R)</text></g><g data-loc="T1(L)" data-cell-id="cell-t1l"><rect x="51" y="182" width="15" height="5" fill="${highlightedLocations.includes('T1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('T1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('T1(L)') ? '2' : '0.5'}"/><text x="58.5" y="184.5" font-size="3" text-anchor="middle" dominant-baseline="middle">T1(L)</text></g>
        <!-- Row U: y=192 -->
        <g data-loc="U3(R)" data-cell-id="cell-u3r"><rect x="17" y="192" width="15" height="5" fill="${highlightedLocations.includes('U3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('U3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('U3(R)') ? '2' : '0.5'}"/><text x="24.5" y="194.5" font-size="3" text-anchor="middle" dominant-baseline="middle">U3(R)</text></g><g data-loc="U3(L)" data-cell-id="cell-u3l"><rect x="17" y="197" width="15" height="5" fill="${highlightedLocations.includes('U3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('U3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('U3(L)') ? '2' : '0.5'}"/><text x="24.5" y="199.5" font-size="3" text-anchor="middle" dominant-baseline="middle">U3(L)</text></g>
        <g data-loc="U2(R)" data-cell-id="cell-u2r"><rect x="34" y="192" width="15" height="5" fill="${highlightedLocations.includes('U2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('U2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('U2(R)') ? '2' : '0.5'}"/><text x="41.5" y="194.5" font-size="3" text-anchor="middle" dominant-baseline="middle">U2(R)</text></g><g data-loc="U2(L)" data-cell-id="cell-u2l"><rect x="34" y="197" width="15" height="5" fill="${highlightedLocations.includes('U2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('U2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('U2(L)') ? '2' : '0.5'}"/><text x="41.5" y="199.5" font-size="3" text-anchor="middle" dominant-baseline="middle">U2(L)</text></g>
        <g data-loc="U1(R)" data-cell-id="cell-u1r"><rect x="51" y="192" width="15" height="5" fill="${highlightedLocations.includes('U1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('U1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('U1(R)') ? '2' : '0.5'}"/><text x="58.5" y="194.5" font-size="3" text-anchor="middle" dominant-baseline="middle">U1(R)</text></g><g data-loc="U1(L)" data-cell-id="cell-u1l"><rect x="51" y="197" width="15" height="5" fill="${highlightedLocations.includes('U1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('U1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('U1(L)') ? '2' : '0.5'}"/><text x="58.5" y="199.5" font-size="3" text-anchor="middle" dominant-baseline="middle">U1(L)</text></g>
        <!-- Row V: y=207 -->
        <g data-loc="V3(R)" data-cell-id="cell-v3r"><rect x="17" y="207" width="15" height="5" fill="${highlightedLocations.includes('V3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('V3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('V3(R)') ? '2' : '0.5'}"/><text x="24.5" y="209.5" font-size="3" text-anchor="middle" dominant-baseline="middle">V3(R)</text></g><g data-loc="V3(L)" data-cell-id="cell-v3l"><rect x="17" y="212" width="15" height="5" fill="${highlightedLocations.includes('V3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('V3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('V3(L)') ? '2' : '0.5'}"/><text x="24.5" y="214.5" font-size="3" text-anchor="middle" dominant-baseline="middle">V3(L)</text></g>
        <g data-loc="V2(R)" data-cell-id="cell-v2r"><rect x="34" y="207" width="15" height="5" fill="${highlightedLocations.includes('V2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('V2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('V2(R)') ? '2' : '0.5'}"/><text x="41.5" y="209.5" font-size="3" text-anchor="middle" dominant-baseline="middle">V2(R)</text></g><g data-loc="V2(L)" data-cell-id="cell-v2l"><rect x="34" y="212" width="15" height="5" fill="${highlightedLocations.includes('V2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('V2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('V2(L)') ? '2' : '0.5'}"/><text x="41.5" y="214.5" font-size="3" text-anchor="middle" dominant-baseline="middle">V2(L)</text></g>
        <g data-loc="V1(R)" data-cell-id="cell-v1r"><rect x="51" y="207" width="15" height="5" fill="${highlightedLocations.includes('V1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('V1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('V1(R)') ? '2' : '0.5'}"/><text x="58.5" y="209.5" font-size="3" text-anchor="middle" dominant-baseline="middle">V1(R)</text></g><g data-loc="V1(L)" data-cell-id="cell-v1l"><rect x="51" y="212" width="15" height="5" fill="${highlightedLocations.includes('V1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('V1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('V1(L)') ? '2' : '0.5'}"/><text x="58.5" y="214.5" font-size="3" text-anchor="middle" dominant-baseline="middle">V1(L)</text></g>
        <!-- Row W: y=222 -->
        <g data-loc="W3(R)" data-cell-id="cell-w3r"><rect x="17" y="222" width="15" height="5" fill="${highlightedLocations.includes('W3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('W3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('W3(R)') ? '2' : '0.5'}"/><text x="24.5" y="224.5" font-size="3" text-anchor="middle" dominant-baseline="middle">W3(R)</text></g><g data-loc="W3(L)" data-cell-id="cell-w3l"><rect x="17" y="227" width="15" height="5" fill="${highlightedLocations.includes('W3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('W3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('W3(L)') ? '2' : '0.5'}"/><text x="24.5" y="229.5" font-size="3" text-anchor="middle" dominant-baseline="middle">W3(L)</text></g>
        <g data-loc="W2(R)" data-cell-id="cell-w2r"><rect x="34" y="222" width="15" height="5" fill="${highlightedLocations.includes('W2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('W2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('W2(R)') ? '2' : '0.5'}"/><text x="41.5" y="224.5" font-size="3" text-anchor="middle" dominant-baseline="middle">W2(R)</text></g><g data-loc="W2(L)" data-cell-id="cell-w2l"><rect x="34" y="227" width="15" height="5" fill="${highlightedLocations.includes('W2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('W2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('W2(L)') ? '2' : '0.5'}"/><text x="41.5" y="229.5" font-size="3" text-anchor="middle" dominant-baseline="middle">W2(L)</text></g>
        <g data-loc="W1(R)" data-cell-id="cell-w1r"><rect x="51" y="222" width="15" height="5" fill="${highlightedLocations.includes('W1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('W1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('W1(R)') ? '2' : '0.5'}"/><text x="58.5" y="224.5" font-size="3" text-anchor="middle" dominant-baseline="middle">W1(R)</text></g><g data-loc="W1(L)" data-cell-id="cell-w1l"><rect x="51" y="227" width="15" height="5" fill="${highlightedLocations.includes('W1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('W1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('W1(L)') ? '2' : '0.5'}"/><text x="58.5" y="229.5" font-size="3" text-anchor="middle" dominant-baseline="middle">W1(L)</text></g>
        <!-- Row X: y=237 -->
        <g data-loc="X3(R)" data-cell-id="cell-x3r"><rect x="17" y="237" width="15" height="5" fill="${highlightedLocations.includes('X3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('X3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('X3(R)') ? '2' : '0.5'}"/><text x="24.5" y="239.5" font-size="3" text-anchor="middle" dominant-baseline="middle">X3(R)</text></g><g data-loc="X3(L)" data-cell-id="cell-x3l"><rect x="17" y="242" width="15" height="5" fill="${highlightedLocations.includes('X3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('X3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('X3(L)') ? '2' : '0.5'}"/><text x="24.5" y="244.5" font-size="3" text-anchor="middle" dominant-baseline="middle">X3(L)</text></g>
        <g data-loc="X2(R)" data-cell-id="cell-x2r"><rect x="34" y="237" width="15" height="5" fill="${highlightedLocations.includes('X2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('X2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('X2(R)') ? '2' : '0.5'}"/><text x="41.5" y="239.5" font-size="3" text-anchor="middle" dominant-baseline="middle">X2(R)</text></g><g data-loc="X2(L)" data-cell-id="cell-x2l"><rect x="34" y="242" width="15" height="5" fill="${highlightedLocations.includes('X2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('X2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('X2(L)') ? '2' : '0.5'}"/><text x="41.5" y="244.5" font-size="3" text-anchor="middle" dominant-baseline="middle">X2(L)</text></g>
        <g data-loc="X1(R)" data-cell-id="cell-x1r"><rect x="51" y="237" width="15" height="5" fill="${highlightedLocations.includes('X1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('X1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('X1(R)') ? '2' : '0.5'}"/><text x="58.5" y="239.5" font-size="3" text-anchor="middle" dominant-baseline="middle">X1(R)</text></g><g data-loc="X1(L)" data-cell-id="cell-x1l"><rect x="51" y="242" width="15" height="5" fill="${highlightedLocations.includes('X1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('X1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('X1(L)') ? '2' : '0.5'}"/><text x="58.5" y="244.5" font-size="3" text-anchor="middle" dominant-baseline="middle">X1(L)</text></g>
        <!-- Row Y: y=252 -->
        <g data-loc="Y3(R)" data-cell-id="cell-y3r"><rect x="17" y="252" width="15" height="5" fill="${highlightedLocations.includes('Y3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Y3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Y3(R)') ? '2' : '0.5'}"/><text x="24.5" y="254.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Y3(R)</text></g><g data-loc="Y3(L)" data-cell-id="cell-y3l"><rect x="17" y="257" width="15" height="5" fill="${highlightedLocations.includes('Y3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Y3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Y3(L)') ? '2' : '0.5'}"/><text x="24.5" y="259.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Y3(L)</text></g>
        <g data-loc="Y2(R)" data-cell-id="cell-y2r"><rect x="34" y="252" width="15" height="5" fill="${highlightedLocations.includes('Y2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Y2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Y2(R)') ? '2' : '0.5'}"/><text x="41.5" y="254.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Y2(R)</text></g><g data-loc="Y2(L)" data-cell-id="cell-y2l"><rect x="34" y="257" width="15" height="5" fill="${highlightedLocations.includes('Y2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Y2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Y2(L)') ? '2' : '0.5'}"/><text x="41.5" y="259.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Y2(L)</text></g>
        <g data-loc="Y1(R)" data-cell-id="cell-y1r"><rect x="51" y="252" width="15" height="5" fill="${highlightedLocations.includes('Y1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Y1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Y1(R)') ? '2' : '0.5'}"/><text x="58.5" y="254.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Y1(R)</text></g><g data-loc="Y1(L)" data-cell-id="cell-y1l"><rect x="51" y="257" width="15" height="5" fill="${highlightedLocations.includes('Y1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Y1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Y1(L)') ? '2' : '0.5'}"/><text x="58.5" y="259.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Y1(L)</text></g>
        <!-- Row Z: y=267 -->
        <g data-loc="Z3(R)" data-cell-id="cell-z3r"><rect x="17" y="267" width="15" height="5" fill="${highlightedLocations.includes('Z3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Z3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Z3(R)') ? '2' : '0.5'}"/><text x="24.5" y="269.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Z3(R)</text></g><g data-loc="Z3(L)" data-cell-id="cell-z3l"><rect x="17" y="272" width="15" height="5" fill="${highlightedLocations.includes('Z3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Z3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Z3(L)') ? '2' : '0.5'}"/><text x="24.5" y="274.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Z3(L)</text></g>
        <g data-loc="Z2(R)" data-cell-id="cell-z2r"><rect x="34" y="267" width="15" height="5" fill="${highlightedLocations.includes('Z2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Z2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Z2(R)') ? '2' : '0.5'}"/><text x="41.5" y="269.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Z2(R)</text></g><g data-loc="Z2(L)" data-cell-id="cell-z2l"><rect x="34" y="272" width="15" height="5" fill="${highlightedLocations.includes('Z2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Z2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Z2(L)') ? '2' : '0.5'}"/><text x="41.5" y="274.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Z2(L)</text></g>
        <g data-loc="Z1(R)" data-cell-id="cell-z1r"><rect x="51" y="267" width="15" height="5" fill="${highlightedLocations.includes('Z1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Z1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Z1(R)') ? '2' : '0.5'}"/><text x="58.5" y="269.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Z1(R)</text></g><g data-loc="Z1(L)" data-cell-id="cell-z1l"><rect x="51" y="272" width="15" height="5" fill="${highlightedLocations.includes('Z1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('Z1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('Z1(L)') ? '2' : '0.5'}"/><text x="58.5" y="274.5" font-size="3" text-anchor="middle" dominant-baseline="middle">Z1(L)</text></g>
        <!-- Row H: y=282 -->
        <g data-loc="H3(R)" data-cell-id="cell-h3r"><rect x="17" y="282" width="15" height="5" fill="${highlightedLocations.includes('H3(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('H3(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('H3(R)') ? '2' : '0.5'}"/><text x="24.5" y="284.5" font-size="3" text-anchor="middle" dominant-baseline="middle">H3(R)</text></g><g data-loc="H3(L)" data-cell-id="cell-h3l"><rect x="17" y="287" width="15" height="5" fill="${highlightedLocations.includes('H3(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('H3(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('H3(L)') ? '2' : '0.5'}"/><text x="24.5" y="289.5" font-size="3" text-anchor="middle" dominant-baseline="middle">H3(L)</text></g>
        <g data-loc="H2(R)" data-cell-id="cell-h2r"><rect x="34" y="282" width="15" height="5" fill="${highlightedLocations.includes('H2(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('H2(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('H2(R)') ? '2' : '0.5'}"/><text x="41.5" y="284.5" font-size="3" text-anchor="middle" dominant-baseline="middle">H2(R)</text></g><g data-loc="H2(L)" data-cell-id="cell-h2l"><rect x="34" y="287" width="15" height="5" fill="${highlightedLocations.includes('H2(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('H2(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('H2(L)') ? '2' : '0.5'}"/><text x="41.5" y="289.5" font-size="3" text-anchor="middle" dominant-baseline="middle">H2(L)</text></g>
        <g data-loc="H1(R)" data-cell-id="cell-h1r"><rect x="51" y="282" width="15" height="5" fill="${highlightedLocations.includes('H1(R)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('H1(R)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('H1(R)') ? '2' : '0.5'}"/><text x="58.5" y="284.5" font-size="3" text-anchor="middle" dominant-baseline="middle">H1(R)</text></g><g data-loc="H1(L)" data-cell-id="cell-h1l"><rect x="51" y="287" width="15" height="5" fill="${highlightedLocations.includes('H1(L)') ? '#ff6b6b' : 'white'}" stroke="${highlightedLocations.includes('H1(L)') ? '#ff0000' : '#000'}" stroke-width="${highlightedLocations.includes('H1(L)') ? '2' : '0.5'}"/><text x="58.5" y="289.5" font-size="3" text-anchor="middle" dominant-baseline="middle">H1(L)</text></g>
      </g>
      
      <!-- Kệ K (bên trong office) - Viền nét đứt nhỏ hơn, dạng chấm -->
      <g data-loc="K" data-cell-id="cell-k">
        <rect x="79" y="150" width="5" height="80" fill="white" stroke="#000" stroke-width="0.3" stroke-dasharray="1,1"/>
        <text x="81.5" y="190" font-size="6" text-anchor="middle" dominant-baseline="middle">K</text>
      </g>

      <!-- WH Office -->
      <g data-loc="WH Office">
        <rect x="15" y="330" width="70" height="80" fill="none" stroke="#333" stroke-width="1"/>
        <text x="50" y="370" font-size="10">WH Office</text>
      </g>
      <!-- Kệ trong WH Office -->
      <g data-loc="VP" data-cell-id="cell-vp">
        <rect x="65" y="400" width="20" height="10" fill="white" stroke="#000" stroke-width="0.5"/>
        <text x="75" y="405" font-size="6" text-anchor="middle" dominant-baseline="middle">VP</text>
      </g>
      
      <!-- Khu vực J - Viền nét đứt nhỏ hơn, dạng chấm -->
      <g data-loc="J">
        <rect x="15" y="410" width="70" height="60" fill="none" stroke="#333" stroke-width="0.3" stroke-dasharray="1,1"/>
        <text x="50" y="440" font-size="8" text-anchor="middle" dominant-baseline="middle">J</text>
      </g>

      <!-- Forklift Area - Viền nét đứt nhỏ hơn, dạng chấm -->
      <g data-loc="Forklift">
        <rect x="15" y="480" width="70" height="28" fill="none" stroke="#333" stroke-width="0.3" stroke-dasharray="1,1"/>
        <text x="50" y="494" font-size="8" text-anchor="middle" dominant-baseline="middle">Forklift</text>
      </g>
  </g>

  <!-- Kệ IQC và W.O - Viền nét đứt nhỏ hơn, dạng chấm -->
  <g font-family="Arial">
    <g data-loc="IQC" data-cell-id="cell-iqc">
      <rect x="100" y="210" width="10" height="180" fill="white" stroke="#000" stroke-width="0.3" stroke-dasharray="1,1"/>
      <text x="105" y="300" font-size="6" transform="rotate(-90 105,300)" text-anchor="middle" dominant-baseline="middle">IQC</text>
    </g>
    <g data-loc="WO" data-cell-id="cell-wo">
      <rect x="100" y="90" width="10" height="90" fill="white" stroke="#000" stroke-width="0.3" stroke-dasharray="1,1"/>
      <text x="105" y="135" font-size="6" transform="rotate(-90 105,135)" text-anchor="middle" dominant-baseline="middle">W.O</text>
    </g>
  </g>

  <!-- INBOUND & Outbound Stages - Viền nét đứt nhỏ hơn, dạng chấm -->
  <g font-family="Arial" text-anchor="middle" dominant-baseline="middle">
    <!-- Inbound Stage -->
    <g data-loc="Inbound Stage">
      <rect x="100" y="420" width="100" height="80" fill="none" stroke="#333" stroke-width="0.3" stroke-dasharray="1,1"/>
      <text x="150" y="460" font-size="6">Inbound Stage</text>
    </g>
    <!-- Outbound Stage -->
    <g data-loc="Outbound Stage">
      <rect x="235" y="420" width="70" height="80" fill="none" stroke="#333" stroke-width="0.3" stroke-dasharray="1,1"/>
      <text x="270" y="460" font-size="6">Outbound Stage</text>
    </g>
  </g>

  <!-- Các dãy kệ -->
  <g font-family="Arial" font-size="6" text-anchor="middle" dominant-baseline="middle">`;

    // Add all racks A1-A9, B1-B9, C1-C9, D1-D9, E1-E9, F1-F9, G1-G9
    const rackRows = [
      { letter: 'A', x: 295 },
      { letter: 'B', x: 255 },
      { letter: 'C', x: 240 },
      { letter: 'D', x: 200 },
      { letter: 'E', x: 185 },
      { letter: 'F', x: 145 },
      { letter: 'G', x: 130 }
    ];

    for (const row of rackRows) {
      for (let i = 1; i <= 9; i++) {
        // Skip G8, G9, F8, F9 as they are merged into G7 and F7
        if ((row.letter === 'G' && (i === 8 || i === 9)) || 
            (row.letter === 'F' && (i === 8 || i === 9))) {
          continue;
        }
        
        const rackCode = `${row.letter}${i}`;
        const isHighlighted = highlightedLocations.includes(rackCode) || 
                             (row.letter === 'G' && i === 7 && (highlightedLocations.includes('G8') || highlightedLocations.includes('G9'))) ||
                             (row.letter === 'F' && i === 7 && (highlightedLocations.includes('F8') || highlightedLocations.includes('F9')));
        
        // Debug logging for TL2
        if (rackCode === 'TL2') {
          console.log(`🔍 Checking TL2: isHighlighted = ${isHighlighted}`);
          console.log(`🔍 highlightedLocations = ${JSON.stringify(highlightedLocations)}`);
        }
        
        const fill = isHighlighted ? '#ff6b6b' : 'white';
        const stroke = isHighlighted ? '#ff0000' : '#000';
        const strokeWidth = isHighlighted ? '2' : '0.5';
        
        // Sửa lại positioning: A1 ở dưới, A9 ở trên
        // A6 cách A7 một khoảng bằng 1 kệ hàng (30px)
        // A7-F7: cạnh dưới ngang hàng với cạnh dưới W.O (y=180)
        let y;
        if (i <= 5) {
          // A1-A5: từ dưới lên (y=360, 330, 300, 270, 240)
          y = 360 - (i - 1) * 30;
        } else if (i === 6) {
          // A6: cách A7 một khoảng bằng 1 kệ hàng
          y = 210; // A6 ở y=210 (cách A7 30px)
        } else {
          // A7-A9: cạnh dưới của A7 ngang hàng với cạnh dưới W.O
          // W.O kết thúc ở y=180, nên cạnh dưới A7 ở y=180
          // A7 có chiều cao 30px, nên A7 bắt đầu từ y=150 (180-30)
          y = 150 - (i - 7) * 30;
        }
        
        // For G7 and F7, make them taller to represent the merged racks
        // Cạnh dưới của G7 và F7 ngang bằng cạnh dưới W.O (y=180)
        let height, textY;
        if ((row.letter === 'G' && i === 7) || (row.letter === 'F' && i === 7)) {
          height = 90;
          y = 90; // Cạnh dưới ở y=180 (90+90), ngang bằng W.O
          textY = y + 45; // Text ở giữa kệ
        } else {
          height = 30;
          textY = y + 15;
        }
        
        svgContent += `
    <g data-loc="${rackCode}" data-cell-id="cell-${rackCode.toLowerCase()}">
      <rect x="${row.x}" y="${y}" width="10" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
      <text x="${row.x + 5}" y="${textY}" font-size="4" text-anchor="middle" dominant-baseline="middle">${rackCode}</text>
    </g>`;
      }
    }

    // T, U, V, W, X, Y, Z, H positions are already drawn in the static SVG above
    // No need to draw them again to avoid duplication

    svgContent += `
  </g>
</svg>`;

    return svgContent;
  }
}
