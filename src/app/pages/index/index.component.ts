import { Component, OnInit } from '@angular/core';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-index',
  templateUrl: './index.component.html',
  styleUrls: ['./index.component.scss']
})
export class IndexComponent implements OnInit {
  
  // Import functionality
  selectedFunction: string | null = null;
  isImporting: boolean = false;
  importProgress: number = 0;
  importResults: any = null;
  
  // Data processing
  processedData: any[] = [];
  summaryData: any = {};
  
  // UI states
  showMoreOptions: boolean = false;

  constructor() { }

  ngOnInit(): void {
    // Initialize component
  }

  // Function selection
  selectFunction(functionName: string): void {
    this.selectedFunction = functionName;
    console.log('🔧 Selected function:', functionName);
  }

  // Toggle more options
  toggleMoreOptions(): void {
    this.showMoreOptions = !this.showMoreOptions;
  }

  // File selection handler
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.importExcelFile(file);
    }
  }

  // Import Excel file
  async importExcelFile(file: File): Promise<void> {
    this.isImporting = true;
    this.importProgress = 0;
    
    console.log('Starting Excel import process for file:', file.name, 'Size:', file.size, 'bytes');
    
    try {
      // Step 1: Read Excel file
      console.log('Step 1: Reading Excel file...');
      this.importProgress = 10;
      const data = await this.readExcelFile(file);
      console.log('Excel file read successfully, rows:', data.length);
      
      // Step 2: Process data
      console.log('Step 2: Processing data...');
      this.importProgress = 30;
      this.processData(data);
      
      // Step 3: Calculate summary
      console.log('Step 3: Calculating summary...');
      this.importProgress = 60;
      this.calculateSummary();
      
      // Step 4: Complete
      console.log('Step 4: Import completed');
      this.importProgress = 100;
      this.importResults = {
        success: this.processedData.length,
        total: data.length,
        message: `Successfully processed ${this.processedData.length} records`
      };
      
      console.log(`✅ Import completed: ${this.processedData.length} records processed`);
      
    } catch (error) {
      console.error('❌ Error during import:', error);
      this.importResults = {
        success: 0,
        total: 0,
        error: error.message
      };
    } finally {
      this.isImporting = false;
      this.importProgress = 0;
    }
  }

  // Read Excel file
  readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          console.log('Excel data parsed:', jsonData.length, 'rows');
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  }

  // Process imported data
  processData(data: any[]): void {
    if (data.length < 2) {
      throw new Error('File must have at least headers and one data row');
    }

    const headers = data[0];
    const rows = data.slice(1);
    
    this.processedData = rows.map((row, index) => {
      const processedRow: any = {};
      
      headers.forEach((header: string, colIndex: number) => {
        if (header && row[colIndex] !== undefined) {
          processedRow[header] = row[colIndex];
        }
      });
      
      processedRow._index = index + 1;
      return processedRow;
    });

    console.log('Processed data:', this.processedData.length, 'records');
  }

  // Calculate summary statistics
  calculateSummary(): void {
    if (this.processedData.length === 0) {
      this.summaryData = {};
      return;
    }

    // Calculate basic statistics
    this.summaryData = {
      totalRecords: this.processedData.length,
      totalColumns: Object.keys(this.processedData[0] || {}).length,
      processedAt: new Date().toLocaleString('vi-VN'),
      // Add more summary calculations here based on your requirements
    };

    console.log('Summary calculated:', this.summaryData);
  }

  // Reset import
  resetImport(): void {
    this.processedData = [];
    this.summaryData = {};
    this.importResults = null;
    this.selectedFunction = null;
    this.showMoreOptions = false;
  }

  // Get table headers for display
  getTableHeaders(): string[] {
    if (this.processedData.length === 0) {
      return [];
    }
    
    const firstRow = this.processedData[0];
    return Object.keys(firstRow).filter(key => key !== '_index');
  }
} 