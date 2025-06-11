import { Component, OnInit, ViewChild, ElementRef, Renderer2 } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface LocationInfo {
  [key: string]: string[];
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
    // The new data is an array of objects, not an array of arrays.
    // No need to skip a header row.
    for (const row of data) {
      const itemCode = row.code ? String(row.code).trim().toUpperCase() : '';
      const location = row.location ? String(row.location).trim().toUpperCase() : '';

      if (itemCode && location) {
        if (!locations[itemCode]) {
          locations[itemCode] = [];
        }
        locations[itemCode].push(location);
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
    
    const locations = this.itemLocations[itemCodeInput];

    if (locations && locations.length > 0) {
      const foundAreas: string[] = [];
      const notFoundAreas: string[] = [];
      
      locations.forEach(location => {
        const svgId = location.substring(0, 2); 
        const success = this.highlightElement(svgId);
        if (success) {
            if (!foundAreas.includes(location)) {
                foundAreas.push(location);
            }
        } else {
            if (!notFoundAreas.includes(location)) {
                notFoundAreas.push(location);
            }
        }
      });

      let message = `Mã hàng ${itemCodeInput} có vị trí tại: `;
      if(foundAreas.length > 0){
        message += `<strong>${foundAreas.join(', ')}</strong> (đã tô sáng). `;
      }
      if(notFoundAreas.length > 0){
        message += `Không tìm thấy khu vực cho: <strong>${notFoundAreas.join(', ')}</strong> trên layout.`;
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

