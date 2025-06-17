import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit {
  workOrders: any[] = [];
  tableHeaders: string[] = [];
  isLoading = true;
  errorMessage: string | null = null;
  selectedWO: any = null;
  selectedIndex: number | null = null;
  
  private sheetUrl = 'https://script.google.com/macros/s/AKfycbwWroXixwj-6a_1Az3AzG05oquLqmpR3AlUNwY41g5itqdJfH-eMDMlYuU29iGsNA/exec';

  constructor(private http: HttpClient) { }

  ngOnInit(): void {
    this.fetchWorkOrders();
  }

  fetchWorkOrders() {
    this.isLoading = true;
    this.errorMessage = null;
    const currentMonth = new Date().getMonth() + 1;

    this.http.get<any[]>(this.sheetUrl).subscribe({
      next: (data) => {
        // Assume the first row from Apps Script is headers
        const headers = data.shift();
        
        // Convert array of arrays to array of objects
        const allRowsAsObjects = data.map(row => {
          const wo = {};
          headers.forEach((header, index) => {
            wo[header.trim()] = row[index];
          });
          return wo;
        });

        // Filter and clean data
        const cleaned = allRowsAsObjects.filter(row => 
            row['Month'] && Number(row['Month']) == currentMonth && row['Work Order'] && row['W.O Status']
        );

        if (cleaned.length > 0) {
          this.tableHeaders = Object.keys(cleaned[0]);
          this.workOrders = cleaned;
          // Select the first row by default
          this.selectWO(0); 
        } else {
          this.workOrders = [];
          this.errorMessage = 'No work orders found for the current month.';
        }

        this.isLoading = false;
      },
      error: (err) => {
        console.error('❌ Error fetching work orders:', err);
        this.errorMessage = 'Error loading work order data.';
        this.isLoading = false;
      }
    });
  }

  selectWO(index: number) {
    if (this.workOrders[index]) {
      this.selectedWO = { ...this.workOrders[index] };
      this.selectedIndex = index;
    }
  }

  saveUpdates() {
    if (!this.selectedWO) return;
    
    // Logic to update the sheet via Apps Script (similar to previous implementation)
    // You would need to adjust your Apps Script to handle POST requests for updates
    const payload = {
      row: this.selectedIndex + 2, // This needs careful calculation based on your sheet
      ...this.selectedWO 
    };

    fetch(this.sheetUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' }
    }).then(res => res.text())
      .then(response => {
        console.log('✅ Update response:', response);
        this.workOrders[this.selectedIndex] = { ...this.selectedWO };
        alert('Updates sent successfully!');
      }).catch(err => {
        console.error('❌ Error updating:', err);
        alert('Failed to send updates.');
      });
  }
}
