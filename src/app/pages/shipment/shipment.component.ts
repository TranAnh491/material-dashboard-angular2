import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';

export interface ShipmentItem {
  id?: string;
  shipmentCode: string;
  materialCode: string;
  rev: string;
  customerCode: string;
  quantity: number;
  poShip: string;
  carton: number;
  odd: number;
  shipMethod: string;
  push: string;
  status: string;
  requestDate: Date;
  fullDate: Date;
  actualShipDate: Date;
  dayPre: number;
  notes: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-shipment',
  templateUrl: './shipment.component.html',
  styleUrls: ['./shipment.component.css']
})
export class ShipmentComponent implements OnInit, OnDestroy {
  shipments: ShipmentItem[] = [];
  filteredShipments: ShipmentItem[] = [];
  
  // Time range filter
  showTimeRangeDialog: boolean = false;
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  
  // Add shipment dialog
  showAddShipmentDialog: boolean = false;
  newShipment: ShipmentItem = {
    shipmentCode: '',
    materialCode: '',
    rev: '',
    customerCode: '',
    quantity: 0,
    poShip: '',
    carton: 0,
    odd: 0,
    shipMethod: '',
    push: '',
    status: 'Chờ soạn',
    requestDate: new Date(),
    fullDate: new Date(),
    actualShipDate: new Date(),
    dayPre: 0,
    notes: ''
  };
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth
  ) {}

  ngOnInit(): void {
    this.loadShipmentsFromFirebase();
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.applyFilters();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load shipments from Firebase
  loadShipmentsFromFirebase(): void {
    this.firestore.collection('shipments')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseShipments = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            requestDate: data.requestDate ? new Date(data.requestDate.seconds * 1000) : new Date(),
            fullDate: data.fullDate ? new Date(data.fullDate.seconds * 1000) : new Date(),
            actualShipDate: data.actualShipDate ? new Date(data.actualShipDate.seconds * 1000) : new Date()
          };
        });
        
        this.shipments = firebaseShipments;
        this.applyFilters();
        console.log('Loaded shipments from Firebase:', this.shipments.length);
      });
  }

  // Apply filters
  applyFilters(): void {
    this.filteredShipments = this.shipments.filter(shipment => {
      // Filter by date range
      const requestDate = new Date(shipment.requestDate);
      const isInDateRange = requestDate >= this.startDate && requestDate <= this.endDate;
      
      return isInDateRange;
    });
  }

  // Format number with commas for thousands
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    
    return value.toLocaleString('vi-VN');
  }

  // Get status class for styling
  getStatusClass(status: string): string {
    switch (status) {
      case 'Đã xong':
        return 'status-completed';
      case 'Đang soạn':
        return 'status-progress';
      case 'Chờ soạn':
        return 'status-pending';
      case 'Đã Ship':
        return 'status-shipped';
      case 'Delay':
        return 'status-delay';
      default:
        return 'status-pending';
    }
  }

  // Time range filter
  applyTimeRangeFilter(): void {
    this.applyFilters();
    this.showTimeRangeDialog = false;
  }

  // Add shipment
  canAddShipment(): boolean {
    return !!(this.newShipment.shipmentCode.trim() && 
              this.newShipment.materialCode.trim() && 
              this.newShipment.quantity > 0);
  }

  addShipment(): void {
    if (!this.canAddShipment()) {
      alert('❌ Vui lòng nhập đầy đủ thông tin bắt buộc');
      return;
    }

    const shipmentData = {
      ...this.newShipment,
      requestDate: this.newShipment.requestDate,
      fullDate: this.newShipment.fullDate,
      actualShipDate: this.newShipment.actualShipDate,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.firestore.collection('shipments').add(shipmentData)
      .then((docRef) => {
        console.log('Shipment added successfully with ID:', docRef.id);
        this.resetNewShipment();
        this.showAddShipmentDialog = false;
        alert('✅ Đã thêm shipment thành công!');
      })
      .catch(error => {
        console.error('Error adding shipment:', error);
        alert('❌ Lỗi khi thêm shipment: ' + error.message);
      });
  }

  resetNewShipment(): void {
    this.newShipment = {
      shipmentCode: '',
      materialCode: '',
      rev: '',
      customerCode: '',
      quantity: 0,
      poShip: '',
      carton: 0,
      odd: 0,
      shipMethod: '',
      push: '',
      status: 'Chờ soạn',
      requestDate: new Date(),
      fullDate: new Date(),
      actualShipDate: new Date(),
      dayPre: 0,
      notes: ''
    };
  }

  // Update notes
  updateNotes(shipment: ShipmentItem): void {
    shipment.updatedAt = new Date();
    this.updateShipmentInFirebase(shipment);
  }

  // Format date for input field (YYYY-MM-DD)
  formatDateForInput(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Update date field
  updateDateField(shipment: ShipmentItem, field: string, dateString: string): void {
    if (dateString) {
      (shipment as any)[field] = new Date(dateString);
    } else {
      (shipment as any)[field] = new Date();
    }
    shipment.updatedAt = new Date();
    this.updateShipmentInFirebase(shipment);
  }

  // Update shipment in Firebase
  updateShipmentInFirebase(shipment: ShipmentItem): void {
    if (shipment.id) {
      const updateData = {
        ...shipment,
        requestDate: shipment.requestDate,
        fullDate: shipment.fullDate,
        actualShipDate: shipment.actualShipDate,
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('shipments').doc(shipment.id).update(updateData)
        .then(() => {
          console.log('Shipment updated successfully');
        })
        .catch(error => {
          console.error('Error updating shipment:', error);
        });
    }
  }

  // Delete shipment
  deleteShipment(shipment: ShipmentItem): void {
    if (shipment.id) {
      this.firestore.collection('shipments').doc(shipment.id).delete()
        .then(() => {
          console.log('Shipment deleted successfully');
        })
        .catch(error => {
          console.error('Error deleting shipment:', error);
        });
    }
    
    // Remove from local array immediately
    const index = this.shipments.indexOf(shipment);
    if (index > -1) {
      this.shipments.splice(index, 1);
      this.applyFilters();
    }
  }

  // Import file functionality
  importFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const shipments = this.parseExcelData(data);
      
      this.shipments = [...this.shipments, ...shipments];
      this.applyFilters();
      
      // Save to Firebase
      this.saveShipmentsToFirebase(shipments);
      
      alert(`✅ Đã import thành công ${shipments.length} shipments từ file Excel!`);
      
    } catch (error) {
      console.error('Error processing Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private async readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private parseExcelData(data: any[]): ShipmentItem[] {
    return data.map((row: any, index: number) => ({
      shipmentCode: row['Shipment'] || '',
      materialCode: row['Mã TP'] || '',
      rev: row['Rev'] || '',
      customerCode: row['Mã Khách'] || '',
      quantity: parseFloat(row['Lượng Xuất']) || 0,
      poShip: row['PO Ship'] || '',
      carton: parseFloat(row['Carton']) || 0,
      odd: parseFloat(row['Odd']) || 0,
      shipMethod: row['FWD'] || '',
      push: row['Push'] || '',
      status: row['Status'] || 'Chờ soạn',
      requestDate: this.parseDate(row['Ngày CS Y/c']) || new Date(),
      fullDate: this.parseDate(row['Ngày full hàng']) || new Date(),
      actualShipDate: this.parseDate(row['Thực ship']) || new Date(),
      dayPre: parseFloat(row['Day Pre']) || 0,
      notes: row['Ghi chú'] || '',
      createdAt: new Date(),
      updatedAt: new Date()
    }));
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;
    
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    }
    
    return new Date(dateStr);
  }

  // Save shipments to Firebase
  saveShipmentsToFirebase(shipments: ShipmentItem[]): void {
    shipments.forEach(shipment => {
      const shipmentData = {
        ...shipment,
        requestDate: shipment.requestDate,
        fullDate: shipment.fullDate,
        actualShipDate: shipment.actualShipDate,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.firestore.collection('shipments').add(shipmentData)
        .then((docRef) => {
          console.log('Shipment saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving shipment to Firebase:', error);
        });
    });
  }

  // Download template
  downloadTemplate(): void {
    const templateData = [
      {
        'Shipment': 'SHIP001',
        'Mã TP': 'P001234',
        'Rev': 'A',
        'Mã Khách': 'CUST001',
        'Lượng Xuất': 100,
        'PO Ship': 'PO2024001',
        'Carton': 10,
        'Odd': 5,
        'FWD': 'Sea',
        'Push': 'Push info',
        'Status': 'Chờ soạn',
        'Ngày CS Y/c': '15/01/2024',
        'Ngày full hàng': '20/01/2024',
        'Thực ship': '25/01/2024',
        'Day Pre': 5,
        'Ghi chú': 'Standard shipment'
      },
      {
        'Shipment': 'SHIP002',
        'Mã TP': 'P002345',
        'Rev': 'B',
        'Mã Khách': 'CUST002',
        'Lượng Xuất': 200,
        'PO Ship': 'PO2024002',
        'Carton': 20,
        'Odd': 8,
        'FWD': 'Air',
        'Push': 'Express push',
        'Status': 'Đang soạn',
        'Ngày CS Y/c': '16/01/2024',
        'Ngày full hàng': '21/01/2024',
        'Thực ship': '26/01/2024',
        'Day Pre': 3,
        'Ghi chú': 'Urgent shipment'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths
    const colWidths = [
      { wch: 12 }, // Shipment
      { wch: 12 }, // Mã TP
      { wch: 8 },  // Rev
      { wch: 12 }, // Mã Khách
      { wch: 12 }, // Lượng Xuất
      { wch: 12 }, // PO Ship
      { wch: 10 }, // Carton
      { wch: 8 },  // Odd
      { wch: 8 },  // FWD
      { wch: 12 }, // Push
      { wch: 12 }, // Status
      { wch: 15 }, // Ngày CS Y/c
      { wch: 15 }, // Ngày full hàng
      { wch: 12 }, // Thực ship
      { wch: 10 }, // Day Pre
      { wch: 20 }  // Ghi chú
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Shipment_Template.xlsx');
  }
} 