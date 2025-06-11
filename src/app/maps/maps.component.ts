import { Component, OnInit, ViewChild, ElementRef, Renderer2 } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

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
  
  private itemLocations: LocationInfo = {};
  private highlightedElements: HTMLElement[] = [];
  private locToCellIdMap = new Map<string, string>();

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private renderer: Renderer2
  ) {}

  ngOnInit() {
    this.loadItemLocations();
    this.loadSvg();
  }

  private loadItemLocations() {
    const sheetUrl = 'https://script.google.com/macros/s/AKfycbzyU7xVxyjixJfOgPCA1smMtVfcLXyKDLPrNz2T6fiLrreHX8CQsArJgQ6LSR5pTviZGA/exec';
    this.http.get<any[]>(sheetUrl).subscribe(data => {
      console.log('--- Raw Data From Google Sheet: ---', data);
      this.itemLocations = this.parseLocationData(data);
      console.log('--- Parsed Item Locations: ---', this.itemLocations);
    });
  }

  private parseLocationData(data: any[]): LocationInfo {
    const locations: LocationInfo = {};
    for (const row of data) {
      const itemCode = row.code ? String(row.code).trim().toUpperCase() : '';
      const location = row.location ? String(row.location).trim().toUpperCase() : '';
      const po = row.po ? String(row.po).trim() : 'N/A';
      const qty = row.qty !== undefined ? row.qty : 'N/A';

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
      const foundLocations = new Set<string>();
      const notFoundLocations = new Set<string>();
      
      itemDetails.forEach(detail => {
        const svgId = detail.location.substring(0, 2); 
        const success = this.highlightElement(svgId);
        if (success) {
            foundLocations.add(detail.location);
        } else {
            notFoundLocations.add(detail.location);
        }
      });

      let message = '';
      itemDetails.forEach(detail => {
        message += `${itemCodeInput}. vị trí <strong>${detail.location}</strong>. PO: ${detail.po}, Qty: ${detail.qty}<br>`;
      });

      if (notFoundLocations.size > 0) {
          message += `<br>Không tìm thấy khu vực cho: <strong>${Array.from(notFoundLocations).join(', ')}</strong> trên layout.`;
      }
      this.searchMessage = message;

    } else {
      this.searchMessage = `Không tìm thấy thông tin vị trí cho mã hàng: ${itemCodeInput}.`;
    }
  }

  private highlightElement(svgId: string): boolean {
    console.log(`Searching for svgId: '${svgId.toLowerCase()}' in map...`);
    const cellId = this.locToCellIdMap.get(svgId.toLowerCase());
    if (!cellId) {
      console.error(`...cellId not found for loc '${svgId.toLowerCase()}'.`);
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
  }

  private loadSvg() {
    this.http.get('assets/img/LayoutD.svg', { responseType: 'text' })
      .subscribe(svgText => {
        this.buildLocMap(svgText);
        this.svgContent = this.sanitizer.bypassSecurityTrustHtml(svgText);
      });
  }
}

