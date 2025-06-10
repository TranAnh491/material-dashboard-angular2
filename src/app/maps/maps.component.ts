import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

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
export class MapsComponent implements OnInit {

  // --- CONFIGURATION ---
  // API URL from Google Apps Script
  private dataSourceUrl = 'https://script.google.com/macros/s/AKfycbzyU7xVxyjixJfOgPCA1smMtVfcLXyKDLPrNz2T6fiLrreHX8CQsArJgQ6LSR5pTviZGA/exec';

  // Warehouse Layout Dimensions
  // Increased to cover locations like E63, F64, etc.
  private readonly WAREHOUSE_ROWS = 26; // A-Z
  private readonly WAREHOUSE_COLS = 100; // 1-100
  // -------------------

  public gridData: WarehouseCell[][] = [];
  public loading = true;
  public errorMessage: string | null = null;
  public searchResult: string | null = null;

  // Maps item code to a list of possible locations (e.g., 'ITEM001' -> ['A01', 'B05'])
  private locationData: Map<string, string[]> = new Map();

  constructor(private http: HttpClient) { }

  ngOnInit() {
    this.initializeGrid();
    this.fetchData();
  }

  private initializeGrid(): void {
    this.gridData = [];
    for (let i = 0; i <= this.WAREHOUSE_ROWS; i++) {
      const row: WarehouseCell[] = [];
      for (let j = 0; j <= this.WAREHOUSE_COLS; j++) {
        const isHeader = i === 0 || j === 0;
        row.push({
          value: isHeader ? '' : this.getLocationName(i, j),
          display: this.getCellDisplay(i, j),
          highlight: false,
          isHeader: isHeader,
        });
      }
      this.gridData.push(row);
    }
  }
  
  private getCellDisplay(row: number, col: number): string {
    if (row === 0 && col === 0) return '';
    if (row === 0) return `C${col}`; // Column header
    if (col === 0) return String.fromCharCode(64 + row); // Row header (A,B,C..)
    return this.getLocationName(row, col);
  }

  private getLocationName(row: number, col: number): string {
    // Naming convention: A1, A2, ..., B1, B2, ...
    const rowName = String.fromCharCode(64 + row);
    return `${rowName}${col}`;
  }

  private fetchData(): void {
    this.loading = true;
    this.http.get<any[]>(this.dataSourceUrl).pipe(
      catchError(error => {
        this.errorMessage = `Failed to load data from the URL. Please check the link and its permissions. Error: ${error.message}`;
        return of(null); // Return a null observable to stop the pipe
      })
    ).subscribe(data => {
      this.loading = false;
      if (!data) return;

      // The API returns an array of objects with `code` and `location`
      data.forEach((row: any) => {
        const itemCode = row.code?.trim();
        const location = row.location?.trim();
        
        if (itemCode && location) {
          const uppercaseCode = itemCode.toUpperCase();
          const uppercaseLocation = location.toUpperCase();

          const existingLocations = this.locationData.get(uppercaseCode);
          if (existingLocations) {
            // Add location only if it's not already in the list to avoid duplicates
            if (!existingLocations.includes(uppercaseLocation)) {
              existingLocations.push(uppercaseLocation);
            }
          } else {
            this.locationData.set(uppercaseCode, [uppercaseLocation]);
          }
        }
      });
    });
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
      
      // A map for quick lookup of grid cells by their location value
      const gridLocationMap = new Map<string, WarehouseCell>();
      this.gridData.forEach(row => {
          row.forEach(cell => {
              if (!cell.isHeader) {
                  gridLocationMap.set(cell.value.toUpperCase(), cell);
              }
          });
      });

      locations.forEach(location => {
        const cell = gridLocationMap.get(location);
        if (cell) {
          cell.highlight = true;
          if (!foundLocations.includes(location)) {
            foundLocations.push(location);
          }
        }
      });

      if (foundLocations.length > 0) {
        this.searchResult = `Item <strong>${itemCode}</strong> found at location(s): <strong>${foundLocations.join(', ')}</strong>.`;
      } else {
        // This case handles when location names from data don't exist in our grid (e.g., 'Kệ Q')
        this.searchResult = `Item <strong>${itemCode}</strong> has assigned location(s) (${locations.join(', ')}), but these could not be visualized on the current grid layout.`;
      }
    } else {
      this.searchResult = `Item <strong>${itemCode}</strong> not found in the location data.`;
    }
  }

  private resetHighlights(): void {
    for (const row of this.gridData) {
      for (const cell of row) {
        cell.highlight = false;
      }
    }
  }
}

