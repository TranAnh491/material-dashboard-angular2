import { Component, OnInit, ElementRef, ViewChild, Renderer2, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';

// Define the structure for a warehouse cell
interface WarehouseCell {
  value: string; // The actual location name (e.g., A1, B2)
  display: string; // What's shown in the cell (can be truncated or be a header)
  highlight: boolean; // True if it should be highlighted
  isHeader: boolean; // True for row/column headers
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

  private locationData: Map<string, string[]> = new Map();
  private highlightedElements: { element: any, originalStyle: any }[] = [];
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
    data.forEach((row: any) => {
      const itemCode = row.code?.trim().toUpperCase();
      // Normalize location: uppercase and replace spaces/special chars with '_'
      const location = row.location?.trim().toUpperCase().replace(/[\s\W]+/g, '_');
      
      if (itemCode && location) {
        const existing = this.locationData.get(itemCode);
        if (existing) {
          if (!existing.includes(location)) {
            existing.push(location);
          }
        } else {
          this.locationData.set(itemCode, [location]);
        }
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
    const locations = this.locationData.get(searchTerm);

    if (locations && locations.length > 0) {
      const foundLocations: string[] = [];
      
      locations.forEach(locationId => {
        // Query the SVG DOM for the element with the matching ID
        const svgElement = this.svgContainer.nativeElement.querySelector(`#${locationId}`);
        if (svgElement) {
          this.highlightElement(svgElement);
          // Use original location name for display if possible, or the ID
          const originalLocationName = this.findOriginalLocationName(locationId);
          if (!foundLocations.includes(originalLocationName)) {
            foundLocations.push(originalLocationName);
          }
        }
      });

      if (foundLocations.length > 0) {
        this.searchResult = `Item <strong>${itemCode}</strong> found at: <strong>${foundLocations.join(', ')}</strong>.`;
      } else {
        this.searchResult = `Item <strong>${itemCode}</strong> has location(s) (${locations.join(', ')}), but they could not be found on the SVG layout. Check if the IDs in the SVG file match the location data.`;
      }
    } else {
      this.searchResult = `Item <strong>${itemCode}</strong> not found in the location data.`;
    }
  }

  private highlightElement(element: any): void {
    const originalStyle = {
      fill: element.style.fill,
      stroke: element.style.stroke,
      'stroke-width': element.style.strokeWidth
    };
    this.highlightedElements.push({ element, originalStyle });
    
    // Apply new styles
    this.renderer.setStyle(element, 'fill', this.HIGHLIGHT_STYLE.fill);
    this.renderer.setStyle(element, 'stroke', this.HIGHLIGHT_STYLE.stroke);
    this.renderer.setStyle(element, 'stroke-width', this.HIGHLIGHT_STYLE['stroke-width']);
  }

  private resetHighlights(): void {
    this.highlightedElements.forEach(item => {
      // Restore original styles
      this.renderer.setStyle(item.element, 'fill', item.originalStyle.fill);
      this.renderer.setStyle(item.element, 'stroke', item.originalStyle.stroke);
      this.renderer.setStyle(item.element, 'stroke-width', item.originalStyle['stroke-width']);
    });
    this.highlightedElements = [];
  }

  private findOriginalLocationName(locationId: string): string {
    // This is a helper to show the original name (with spaces) in the message
    for(const [key, value] of this.locationData.entries()) {
        const normalizedLocations = value.map(v => v.toUpperCase().replace(/[\s\W]+/g, '_'));
        if (normalizedLocations.includes(locationId)) {
            // Find the original location name from the raw data that matches this ID
            // This is complex, so we'll just return the ID for now.
            // A better implementation would store original names alongside normalized IDs.
        }
    }
    return locationId.replace(/_/g, ' '); // Simple conversion back
  }
}

