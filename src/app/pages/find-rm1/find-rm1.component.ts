import { Component, OnInit, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

interface RM1Item {
  itemCode: string;
  location: string;
  quantity: number;
  po: string;
  description?: string;
  lastUpdated?: Date;
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
    
    this.firestore.collection('rm1-inventory')
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
      const itemCode = row.itemCode || row.code || row.materialCode;
      const location = row.location || row.warehouseLocation || row.storageLocation;
      const quantity = row.quantity || row.qty || row.stockQty || 0;
      const po = row.po || row.purchaseOrder || row.itemName || row.description || 'N/A';
      
      if (itemCode && location) {
        items.push({
          itemCode: String(itemCode).trim().toUpperCase(),
          location: String(location).trim().toUpperCase(),
          quantity: Number(quantity),
          po: String(po).trim(),
          description: row.description || row.itemName || '',
          lastUpdated: row.lastUpdated ? new Date(row.lastUpdated) : new Date()
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
    const value = event.target.value;
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
      item.itemCode.toLowerCase().includes(term) ||
      item.location.toLowerCase().includes(term) ||
      item.po.toLowerCase().includes(term) ||
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
      item.itemCode,
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
   * Track items by item code for better performance
   */
  trackByItemCode(index: number, item: RM1Item): string {
    return item.itemCode;
  }
}
