import { Component, OnInit, ElementRef, ViewChild, Renderer2, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';

interface LocationInfo {
  itemCode: string;
  po: string;
  qty: number;
  originalLocation: string;
  normalizedLocation: string;
  svgId: string;
}

@Component({
  selector: 'app-maps',
  templateUrl: './maps.component.html',
  styleUrls: ['./maps.component.css']
})
export class MapsComponent implements OnInit, OnDestroy {

  // --- CONFIGURATION ---
  private dataSourceUrl = 'https://script.google.com/macros/s/AKfycbzyU7xVxyjixJfOgPCA1smMtVfcLXyKDLPrNz2T6fiLrreHX8CQsArJgQ6LSR5pTviZGA/exec';
  private svgLayoutUrl = 'assets/img/LayoutD.svg';
  
  // Style for highlighted elements in the SVG
  private readonly HIGHLIGHT_STYLE = {
    fill: '#ff9800', // Orange
    stroke: '#c00',
    'stroke-width': '2px'
  };
  // -------------------

  @ViewChild('svgContainer', { static: true }) svgContainer: ElementRef;

  public loading = true;
  public errorMessage: string | null = null;
  public searchResult: string | null = null;

  private itemToLocationsMap: Map<string, LocationInfo[]> = new Map();
  private highlightedElements: { element: any, originalStyle: any, titleElement?: any }[] = [];
  private subscriptions: Subscription = new Subscription();

  constructor(private http: HttpClient, private renderer: Renderer2) { }

  ngOnInit() {
    this.loadDataAndSvg();
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  private loadDataAndSvg(): void {
    this.loading = true;
    
    // Step 1: Fetch location data from Google Script
    const dataSub = this.http.get<any[]>(this.dataSourceUrl).pipe(
      catchError(error => {
        this.errorMessage = `Failed to load location data. Error: ${error.message}`;
        return of(null);
      })
    ).subscribe(data => {
      if (data) {
        this.parseLocationData(data);
      }
      // Step 2: Load SVG layout after fetching data
      this.loadSvgLayout();
    });

    this.subscriptions.add(dataSub);
  }

  private parseLocationData(data: any[]): void {
    const allLocationData: LocationInfo[] = data.map(row => {
        const originalLocation = row.location?.trim() || '';
        const normalizedLocation = originalLocation.toUpperCase().replace(/[\s\W]+/g, '_');
        const match = normalizedLocation.match(/^([A-Z]+)(\d)/);
        const svgId = match ? match[1] + match[2] : normalizedLocation;

        return {
            itemCode: (row.code?.trim() || '').toUpperCase(),
            po: row.name?.trim() || 'N/A',
            qty: row.qty || 0,
            originalLocation: originalLocation,
            normalizedLocation: normalizedLocation,
            svgId: svgId
        };
    }).filter(info => info.itemCode && info.originalLocation);

    // Create a map for quick search by item code
    this.itemToLocationsMap.clear();
    allLocationData.forEach(info => {
        const existing = this.itemToLocationsMap.get(info.itemCode);
        if (existing) {
            existing.push(info);
        } else {
            this.itemToLocationsMap.set(info.itemCode, [info]);
        }
    });
  }
  
  private loadSvgLayout(): void {
    const svgSub = this.http.get(this.svgLayoutUrl, { responseType: 'text' }).pipe(
        catchError(error => {
            this.errorMessage = `Failed to load SVG layout file from '${this.svgLayoutUrl}'. Make sure the file exists.`;
            return of(null);
        })
    ).subscribe(svgContent => {
        this.loading = false;
        if (svgContent) {
            // Directly inject the SVG content into the container
            this.svgContainer.nativeElement.innerHTML = svgContent;
        }
    });
    this.subscriptions.add(svgSub);
  }
  
  public search(itemCode: string): void {
    this.searchResult = null;
    this.resetHighlights();

    if (!itemCode) {
      return;
    }

    const searchTerm = itemCode.trim().toUpperCase();
    const locationsForItem = this.itemToLocationsMap.get(searchTerm);

    if (locationsForItem && locationsForItem.length > 0) {
      // Group all found location details by their target SVG ID
      const detailsBySvgId = new Map<string, LocationInfo[]>();
      locationsForItem.forEach(locInfo => {
        const details = detailsBySvgId.get(locInfo.svgId);
        if (details) {
          details.push(locInfo);
        } else {
          detailsBySvgId.set(locInfo.svgId, [locInfo]);
        }
      });
      
      const foundAreas: string[] = [];
      detailsBySvgId.forEach((details, svgId) => {
        const svgElement = this.svgContainer.nativeElement.querySelector(`#${svgId}`);
        if (svgElement) {
          this.highlightElement(svgElement, details);
          if (!foundAreas.includes(svgId)) {
            foundAreas.push(svgId.replace(/_/g, ' '));
          }
        }
      });

      if (foundAreas.length > 0) {
        this.searchResult = `Item <strong>${itemCode}</strong> found in area(s): <strong>${foundAreas.join(', ')}</strong>. Hover over the area for details.`;
      } else {
        const originalLocations = locationsForItem.map(l => l.originalLocation).join(', ');
        this.searchResult = `Item <strong>${itemCode}</strong> has location(s) (${originalLocations}), but the corresponding area could not be found on the layout. Please check the SVG IDs.`;
      }
    } else {
      this.searchResult = `Item <strong>${itemCode}</strong> not found in the location data.`;
    }
  }

  private highlightElement(element: any, details: LocationInfo[]): void {
    const originalStyle = {
      fill: element.style.fill,
      stroke: element.style.stroke,
      'stroke-width': element.style.strokeWidth
    };
    
    // Apply new styles
    this.renderer.setStyle(element, 'fill', this.HIGHLIGHT_STYLE.fill);
    this.renderer.setStyle(element, 'stroke', this.HIGHLIGHT_STYLE.stroke);
    this.renderer.setStyle(element, 'stroke-width', this.HIGHLIGHT_STYLE['stroke-width']);
    
    // Create and add tooltip
    const tooltipText = details.map(d => 
      `Location: ${d.originalLocation} | PO: ${d.po} | Qty: ${d.qty}`
    ).join('\\n'); // Use newline for SVG tooltips
    
    const titleElement = this.renderer.createElement('title', 'http://www.w3.org/2000/svg');
    const textNode = this.renderer.createText(tooltipText);
    this.renderer.appendChild(titleElement, textNode);
    this.renderer.appendChild(element, titleElement);

    this.highlightedElements.push({ element, originalStyle, titleElement });
  }

  private resetHighlights(): void {
    this.highlightedElements.forEach(item => {
      // Restore original styles
      this.renderer.setStyle(item.element, 'fill', item.originalStyle.fill);
      this.renderer.setStyle(item.element, 'stroke', item.originalStyle.stroke);
      this.renderer.setStyle(item.element, 'stroke-width', item.originalStyle['stroke-width']);
      // Remove the tooltip
      if (item.titleElement) {
        this.renderer.removeChild(item.element, item.titleElement);
      }
    });
    this.highlightedElements = [];
  }
}

