import { Component, OnInit, ViewChild, ElementRef, Renderer2 } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AngularFirestore } from '@angular/fire/compat/firestore';

interface ItemDetail {
  location: string;
  po: string;
  qty: any;
}

interface LocationInfo {
  [key: string]: ItemDetail[];
}

@Component({
  selector: 'app-maps',
  templateUrl: './maps.component.html',
  styleUrls: ['./maps.component.css']
})
export class MapsComponent implements OnInit {
  @ViewChild('svgContainer', { static: true }) svgContainer: ElementRef;
  
  public svgContent: SafeHtml;
  public searchMessage: string = '';
  public dataLoaded: boolean = false;
  
  private itemLocations: LocationInfo = {};
  private highlightedElements: HTMLElement[] = [];
  private locToCellIdMap = new Map<string, string>();

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private renderer: Renderer2,
    private firestore: AngularFirestore
  ) {}

  ngOnInit() {
    this.loadItemLocations();
    this.loadSvg();
  }

  private loadItemLocations() {
    // Lấy dữ liệu từ RM1 inventory collection
    this.firestore.collection('rm1-inventory').valueChanges().subscribe(data => {
      console.log('--- Raw Data From RM1 Inventory: ---', data);
      this.itemLocations = this.parseLocationData(data);
      console.log('--- Parsed Item Locations: ---', this.itemLocations);
      
      // Log một số ví dụ về vị trí để debug
      const sampleLocations = Object.entries(this.itemLocations).slice(0, 5);
      console.log('--- Sample Item Locations (first 5): ---', sampleLocations);
      
      this.dataLoaded = true;
    }, error => {
      console.error('Error loading RM1 inventory data:', error);
      this.searchMessage = 'Lỗi khi tải dữ liệu từ RM1 inventory.';
    });
  }

  private parseLocationData(data: any[]): LocationInfo {
    const locations: LocationInfo = {};
    for (const row of data) {
      // Lấy mã hàng từ RM1 inventory
      const itemCode = row.itemCode || row.code || row.materialCode ? String(row.itemCode || row.code || row.materialCode).trim().toUpperCase() : '';
      // Lấy vị trí từ RM1 inventory
      const location = row.location || row.warehouseLocation || row.storageLocation ? String(row.location || row.warehouseLocation || row.storageLocation).trim().toUpperCase() : '';
      // Lấy thông tin PO hoặc tên item
      const po = row.po || row.purchaseOrder || row.itemName || row.description ? String(row.po || row.purchaseOrder || row.itemName || row.description).trim() : 'N/A';
      // Lấy số lượng
      const qty = row.quantity || row.qty || row.stockQty !== undefined ? row.quantity || row.qty || row.stockQty : 'N/A';

      if (itemCode && location) {
        if (!locations[itemCode]) {
          locations[itemCode] = [];
        }
        locations[itemCode].push({ location, po, qty });
      }
    }
    return locations;
  }
  
  public search(itemCode: string) {
    const itemCodeInput = itemCode.trim().toUpperCase();
    this.searchMessage = '';
    this.clearHighlight();

    if (!itemCodeInput) {
      this.searchMessage = 'Vui lòng nhập mã hàng.';
      return;
    }
    
    const itemDetails = this.itemLocations[itemCodeInput];

    if (itemDetails && itemDetails.length > 0) {
      console.log(`--- Found ${itemDetails.length} locations for item ${itemCodeInput}: ---`, itemDetails);
      const foundLocations = new Set<string>();
      const notFoundLocations = new Set<string>();
      
      itemDetails.forEach(detail => {
        console.log(`--- Processing location: '${detail.location}' for item ${itemCodeInput} ---`);
        const success = this.highlightElement(detail.location);
        if (success) {
            foundLocations.add(detail.location);
        } else {
            notFoundLocations.add(detail.location);
        }
      });

      let message = '';
      itemDetails.forEach(detail => {
        const locationPrefix = detail.location.substring(0, 2).toUpperCase();
        message += `${itemCodeInput} - Vị trí đầy đủ: <strong>${detail.location}</strong> (Layout: ${locationPrefix}) | Thông tin: ${detail.po} | Số lượng: ${detail.qty}<br>`;
      });

      if (notFoundLocations.size > 0) {
          const notFoundPrefixes = Array.from(notFoundLocations).map(loc => loc.substring(0, 2).toUpperCase());
          message += `<br>Không tìm thấy khu vực cho các prefix: <strong>${notFoundPrefixes.join(', ')}</strong> trên layout.`;
      }
      this.searchMessage = message;

    } else {
      this.searchMessage = `Không tìm thấy thông tin vị trí cho mã hàng <strong>${itemCodeInput}</strong> trong RM1 inventory.`;
    }
  }

  private highlightElement(location: string): boolean {
    const locationLower = location.toLowerCase();

    // Lấy 2 ký tự đầu tiên của vị trí để so sánh với layout
    const locationPrefix = locationLower.substring(0, 2);
    console.log(`Original location: '${locationLower}', Using prefix: '${locationPrefix}'`);

    // Tìm key trong map có prefix trùng khớp với 2 ký tự đầu tiên
    let bestMatchKey = '';
    for (const key of this.locToCellIdMap.keys()) {
        // So sánh 2 ký tự đầu tiên của key với 2 ký tự đầu tiên của location
        const keyPrefix = key.substring(0, 2).toLowerCase();
        console.log(`Checking key: '${key}' with prefix: '${keyPrefix}' against location prefix: '${locationPrefix}'`);
        if (locationPrefix === keyPrefix) {
            bestMatchKey = key;
            console.log(`Found matching key: '${key}' for location prefix: '${locationPrefix}'`);
            break; // Tìm thấy key đầu tiên trùng khớp thì dừng
        }
    }

    if (!bestMatchKey) {
        console.error(`...no matching prefix found for location '${locationLower}' with prefix '${locationPrefix}'.`);
        return false;
    }

    console.log(`Searching for svgId: '${bestMatchKey}' in map (matched prefix: '${locationPrefix}')...`);
    const cellId = this.locToCellIdMap.get(bestMatchKey);
    if (!cellId) {
      console.error(`...cellId not found for loc '${bestMatchKey}'.`);
      return false;
    }
    console.log(`...found cellId: '${cellId}'. Querying DOM...`);
    
    if (this.svgContainer && this.svgContainer.nativeElement) {
      const query = `g[data-cell-id="${cellId}"]`;
      const groupElement = this.svgContainer.nativeElement.querySelector(query);
      if (groupElement) {
        console.log('...Found group element:', groupElement);
        const rect = groupElement.querySelector('rect');
        if (rect) {
          console.log('...Found rect, applying highlight:', rect);
          this.renderer.setStyle(rect, 'fill', 'orange');
          this.highlightedElements.push(rect);
          
          // --- BEGIN: Auto-scroll to element ---
          groupElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          // --- END: Auto-scroll to element ---

          return true;
        } else {
          console.error('...Group element found, but NO rect inside it.');
        }
      } else {
        console.error(`...Could not find group element with query: '${query}'`);
      }
    }
    return false;
  }

  private clearHighlight() {
    this.highlightedElements.forEach(element => {
      this.renderer.setStyle(element, 'fill', ''); // Reset to original color
    });
    this.highlightedElements = [];
  }

  private buildLocMap(svgText: string) {
    this.locToCellIdMap.clear(); // Clear map before building

    // Use DOMParser to safely and robustly parse the SVG XML
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, "image/svg+xml");

    // Find all <g> elements that have both data-loc and data-cell-id attributes
    const groupElements = svgDoc.querySelectorAll('g[data-loc][data-cell-id]');

    groupElements.forEach(g => {
      const loc = g.getAttribute('data-loc')!.toLowerCase();
      const cellId = g.getAttribute('data-cell-id')!;
      this.locToCellIdMap.set(loc, cellId);
    });

    console.log('--- Built loc to cell ID map (DOM Parsing): ---', this.locToCellIdMap);
    console.log('--- Available location keys in SVG: ---', Array.from(this.locToCellIdMap.keys()));
  }

  private loadSvg() {
    this.http.get('assets/img/LayoutD.svg', { responseType: 'text' })
      .subscribe(svgText => {
        this.buildLocMap(svgText);
        this.svgContent = this.sanitizer.bypassSecurityTrustHtml(svgText);
      });
  }
}

