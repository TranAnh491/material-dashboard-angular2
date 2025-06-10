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
    const cellId = this.locToCellIdMap.get(svgId.toLowerCase());
    if (!cellId) {
      return false;
    }
    
    if (this.svgContainer && this.svgContainer.nativeElement) {
      const groupElement = this.svgContainer.nativeElement.querySelector(`g[data-cell-id="${cellId}"]`);
      if (groupElement) {
        const rect = groupElement.querySelector('rect');
        if (rect) {
          this.renderer.setStyle(rect, 'fill', 'orange');
          this.highlightedElements.push(rect);
          return true;
        }
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
    const regex = /<object.*?loc="([^"]+)".*?id="([^"]+)".*?>/g;
    let match;
    while ((match = regex.exec(svgText)) !== null) {
      const loc = match[1].toLowerCase();
      const id = match[2];
      this.locToCellIdMap.set(loc, id);
    }
  }

  private loadSvg() {
    this.http.get('assets/img/LayoutD.svg', { responseType: 'text' })
      .subscribe(svgText => {
        this.buildLocMap(svgText);
        this.svgContent = this.sanitizer.bypassSecurityTrustHtml(svgText);
      });
  }
}

