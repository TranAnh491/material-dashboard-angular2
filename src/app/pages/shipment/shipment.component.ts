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
  customerCode: string;
  quantity: number;
  poShip: string;
  carton: number;
  odd: number;
  inventory?: number; // Thêm trường tồn kho
  shipMethod: string;
  push: boolean;
  pushNo: string; // Thêm PushNo - format: 001, 002, 003...
  status: string;
  requestDate: Date | null; // Cho phép null
  fullDate: Date | null; // Cho phép null
  actualShipDate: Date | null; // Cho phép null
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
  
  // Dropdown state
  isDropdownOpen: boolean = false;
  
  newShipment: ShipmentItem = {
    shipmentCode: '',
    materialCode: '',
    customerCode: '',
    quantity: 0,
    poShip: '',
    carton: 0,
    odd: 0,
    inventory: 0, // Khởi tạo tồn kho = 0
    shipMethod: '',
    push: false,
    pushNo: '000', // Khởi tạo PushNo = 000
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
    // Fix date format issues - use proper date initialization
    this.startDate = new Date('2020-01-01');
    this.endDate = new Date('2030-12-31');
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
            push: data.push === 'true' || data.push === true || data.push === 1,
            pushNo: data.pushNo || '000', // Default PushNo if not exists
            inventory: data.inventory || 0, // Default inventory if not exists
            requestDate: data.requestDate ? new Date(data.requestDate.seconds * 1000) : null,
            fullDate: data.fullDate ? new Date(data.fullDate.seconds * 1000) : null,
            actualShipDate: data.actualShipDate ? new Date(data.actualShipDate.seconds * 1000) : null
          };
        });
        
        this.shipments = firebaseShipments;
        this.applyFilters();
        console.log('Loaded shipments from Firebase:', this.shipments.length);
      });
  }

  // Toggle dropdown
  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  // Close dropdown when clicking outside
  closeDropdown(): void {
    this.isDropdownOpen = false;
  }

  // Get total shipments count
  getTotalShipments(): number {
    return this.filteredShipments.length;
  }

  // Get completed shipments count
  getCompletedShipments(): number {
    return this.filteredShipments.filter(s => s.status === 'Đã xong').length;
  }

  // Get missing items shipments count
  getMissingItemsShipments(): number {
    return this.filteredShipments.filter(s => {
      // Check if inventory is less than quantity needed
      const inventory = this.getInventory(s.materialCode);
      return inventory < s.quantity;
    }).length;
  }

  // Get in progress shipments count
  getInProgressShipments(): number {
    return this.filteredShipments.filter(s => s.status === 'Đang soạn').length;
  }

  // Get pending shipments count
  getPendingShipments(): number {
    return this.filteredShipments.filter(s => s.status === 'Chờ soạn').length;
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
      pushNo: this.newShipment.pushNo || '000', // Ensure PushNo is included
      inventory: this.newShipment.inventory || 0, // Ensure inventory is included
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

  // Get inventory for material code
  getInventory(materialCode: string): number {
    // Tìm trong danh sách shipments để lấy tồn kho
    const shipment = this.shipments.find(s => s.materialCode === materialCode);
    return shipment?.inventory || 0;
  }

  resetNewShipment(): void {
    this.newShipment = {
      shipmentCode: '',
      materialCode: '',
      customerCode: '',
      quantity: 0,
      poShip: '',
      carton: 0,
      odd: 0,
      inventory: 0,
      shipMethod: '',
      push: false,
      pushNo: '000',
      status: 'Chờ soạn',
      requestDate: null, // Khởi tạo null thay vì new Date()
      fullDate: null, // Khởi tạo null thay vì new Date()
      actualShipDate: null, // Khởi tạo null thay vì new Date()
      dayPre: 0,
      notes: ''
    };
  }

  // Update notes
  updateNotes(shipment: ShipmentItem): void {
    shipment.updatedAt = new Date();
    this.updateShipmentInFirebase(shipment);
  }

  // Handle push checkbox change
  onPushChange(shipment: ShipmentItem): void {
    shipment.updatedAt = new Date();
    
    if (shipment.push) {
      // Always generate new PushNo when push is checked (even if previously pushed)
      this.generatePushNoSync(shipment);
      // When checked, transfer data to FG Out
      this.transferToFGOut(shipment);
    } else {
      // When unchecked, reset PushNo to 000
      shipment.pushNo = '000';
    }
    
    this.updateShipmentInFirebase(shipment);
  }

  // Generate PushNo - simple timestamp-based approach
  private generatePushNoSync(shipment: ShipmentItem): void {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    
    // Use timestamp to generate unique PushNo
    const timestamp = Date.now();
    const pushNo = String(timestamp % 1000).padStart(3, '0');
    shipment.pushNo = pushNo;
    
    console.log(`🔄 Generated PushNo: ${pushNo} for month ${monthKey} (timestamp-based)`);
  }

  // Transfer shipment data to FG Out - UPDATE VERSION
  private transferToFGOut(shipment: ShipmentItem): void {
    console.log(`🔄 Starting transfer to FG Out for shipment: ${shipment.shipmentCode}, material: ${shipment.materialCode}, PushNo: ${shipment.pushNo}`);
    
    // Default values if FG Inventory not found
    let batchNumber = 'BATCH001';
    let lsx = 'LSX001';
    let lot = 'LOT001';
    
    // Try to get FG Inventory data (optional)
    this.firestore.collection('fg-inventory').get().subscribe({
      next: (inventorySnapshot) => {
        // Find matching material in inventory
        const matchingItem = inventorySnapshot.docs.find(doc => {
          const data = doc.data() as any;
          return data.materialCode === shipment.materialCode;
        });
        
        if (matchingItem) {
          const inventoryData = matchingItem.data() as any;
          batchNumber = inventoryData.batchNumber || 'BATCH001';
          lsx = inventoryData.lsx || 'LSX001';
          lot = inventoryData.lot || 'LOT001';
          console.log(`✅ Found FG Inventory data: Batch=${batchNumber}, LSX=${lsx}, LOT=${lot}`);
        } else {
          console.log(`⚠️ No FG Inventory found, using default values`);
        }
        
        // Check if record exists in FG Out
        this.checkAndUpdateFGOut(shipment, batchNumber, lsx, lot);
      },
      error: (error) => {
        console.log(`⚠️ Error getting FG Inventory, using default values: ${error.message}`);
        this.checkAndUpdateFGOut(shipment, batchNumber, lsx, lot);
      }
    });
  }

  // Check if FG Out record exists and update or create
  private checkAndUpdateFGOut(shipment: ShipmentItem, batchNumber: string, lsx: string, lot: string): void {
    this.firestore.collection('fg-out', ref => 
      ref.where('shipment', '==', shipment.shipmentCode)
         .where('materialCode', '==', shipment.materialCode)
    ).get().subscribe(snapshot => {
      
      if (!snapshot.empty) {
        // DELETE all existing records for this shipment+material
        const deletePromises = snapshot.docs.map(doc => doc.ref.delete());
        Promise.all(deletePromises).then(() => {
          console.log(`🗑️ Deleted ${snapshot.docs.length} existing FG Out records`);
          // CREATE new records with updated data
          this.createFGOutRecords(shipment, batchNumber, lsx, lot);
        }).catch(error => {
          console.error('❌ Error deleting old FG Out records:', error);
          alert(`❌ Lỗi khi xóa bản ghi cũ: ${error.message}`);
        });
      } else {
        // CREATE new records
        this.createFGOutRecords(shipment, batchNumber, lsx, lot);
      }
    });
  }


  // Create FG Out records - ALWAYS create 2 separate records (Full cartons + ODD)
  private createFGOutRecords(shipment: ShipmentItem, batchNumber: string, lsx: string, lot: string): void {
    const fgOutRecords: any[] = [];

    // Calculate carton distribution
    const totalQuantity = shipment.quantity;
    const cartonSize = shipment.carton;
    const oddQuantity = shipment.odd;

    // Always create 2 records: Full cartons and ODD (even if one is 0)
    const fullCartons = Math.floor((totalQuantity - oddQuantity) / cartonSize);
    const fullCartonQuantity = fullCartons * cartonSize;
    
    // Record 1: Full cartons (always create, even if 0)
    fgOutRecords.push({
      shipment: shipment.shipmentCode,
      materialCode: shipment.materialCode,
      customerCode: shipment.customerCode,
      batchNumber: batchNumber,
      lsx: lsx,
      lot: lot,
      quantity: fullCartonQuantity,
      poShip: shipment.poShip,
      carton: fullCartons,
      odd: 0,
      notes: `${shipment.notes} (Full cartons: ${fullCartons} x ${cartonSize}) - PushNo: ${shipment.pushNo}`,
      pushNo: shipment.pushNo,
      transferredFrom: 'Shipment',
      transferredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Record 2: ODD quantity (always create, even if 0)
    fgOutRecords.push({
      shipment: shipment.shipmentCode,
      materialCode: shipment.materialCode,
      customerCode: shipment.customerCode,
      batchNumber: batchNumber,
      lsx: lsx,
      lot: lot,
      quantity: oddQuantity,
      poShip: shipment.poShip,
      carton: 0,
      odd: oddQuantity,
      notes: `${shipment.notes} (ODD: ${oddQuantity}) - PushNo: ${shipment.pushNo}`,
      pushNo: shipment.pushNo,
      transferredFrom: 'Shipment',
      transferredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Save all records to FG Out
    const savePromises = fgOutRecords.map(record => 
      this.firestore.collection('fg-out').add(record)
    );

    Promise.all(savePromises)
      .then(() => {
        console.log('✅ Data transferred to FG Out successfully');
        const recordCount = fgOutRecords.length;
        const batchInfo = `Batch: ${batchNumber}, LSX: ${lsx}, LOT: ${lot}`;
        const cartonInfo = `Full cartons: ${fullCartons} x ${cartonSize} = ${fullCartonQuantity}, ODD: ${oddQuantity}`;
        alert(`✅ Đã cập nhật FG Out!\n📊 Tạo ${recordCount} bản ghi\n🔢 ${batchInfo}\n📦 ${cartonInfo}\n🔄 PushNo: ${shipment.pushNo}`);
      })
      .catch((error) => {
        console.error('❌ Error transferring to FG Out:', error);
        alert(`❌ Lỗi khi chuyển dữ liệu: ${error.message}`);
      });
  }

  // Format date for input field (YYYY-MM-DD)
  formatDateForInput(date: Date): string {
    if (!date || date.getTime() === 0) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
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
      // Set to null instead of current date when empty
      (shipment as any)[field] = null;
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
        pushNo: shipment.pushNo || '000', // Ensure PushNo is included
        inventory: shipment.inventory || 0, // Ensure inventory is included
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('shipments').doc(shipment.id).update(updateData)
        .then(() => {
          console.log(`Shipment updated successfully with PushNo: ${shipment.pushNo}`);
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
      customerCode: row['Mã Khách'] || '',
      quantity: parseFloat(row['Lượng Xuất']) || 0,
      poShip: row['PO Ship'] || '',
      carton: parseFloat(row['Carton']) || 0,
      odd: parseFloat(row['Odd']) || 0,
      shipMethod: row['FWD'] || '',
      push: row['Push'] === 'true' || row['Push'] === true || row['Push'] === 1,
      pushNo: '000', // Default PushNo for imported data
      inventory: parseFloat(row['Tồn kho']) || 0, // Default inventory for imported data
      status: row['Status'] || 'Chờ soạn',
      requestDate: this.parseDate(row['CS Date'] || row['Ngày CS Y/c']) || new Date(),
      fullDate: this.parseDate(row['Full Date'] || row['Ngày full hàng']) || new Date(),
      actualShipDate: this.parseDate(row['Dispatch Date'] || row['Thực ship']) || new Date(),
      dayPre: parseFloat(row['Ngày chuẩn bị'] || row['Day Pre']) || 0,
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
        pushNo: shipment.pushNo || '000', // Ensure PushNo is included
        inventory: shipment.inventory || 0, // Ensure inventory is included
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
        'Mã Khách': 'CUST001',
        'Lượng Xuất': 100,
        'PO Ship': 'PO2024001',
        'Carton': 10,
        'Odd': 5,
        'Tồn kho': 500,
        'FWD': 'Sea',
        'Push': true,
        'PushNo': '001',
        'Status': 'Chờ soạn',
        'CS Date': '15/01/2024',
        'Full Date': '20/01/2024',
        'Dispatch Date': '25/01/2024',
        'Ngày chuẩn bị': 5,
        'Ghi chú': 'Standard shipment'
      },
      {
        'Shipment': 'SHIP002',
        'Mã TP': 'P002345',
        'Mã Khách': 'CUST002',
        'Lượng Xuất': 200,
        'PO Ship': 'PO2024002',
        'Carton': 20,
        'Odd': 8,
        'Tồn kho': 750,
        'FWD': 'Air',
        'Push': false,
        'PushNo': '000',
        'Status': 'Đang soạn',
        'CS Date': '16/01/2024',
        'Full Date': '21/01/2024',
        'Dispatch Date': '26/01/2024',
        'Ngày chuẩn bị': 3,
        'Ghi chú': 'Urgent shipment'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths
    const colWidths = [
      { wch: 12 }, // Shipment
      { wch: 12 }, // Mã TP
      { wch: 12 }, // Mã Khách
      { wch: 12 }, // Lượng Xuất
      { wch: 12 }, // PO Ship
      { wch: 10 }, // Carton
      { wch: 8 },  // Odd
      { wch: 10 }, // Tồn kho
      { wch: 8 },  // FWD
      { wch: 8 },  // Push
      { wch: 8 },  // PushNo
      { wch: 12 }, // Status
      { wch: 12 }, // CS Date
      { wch: 12 }, // Full Date
      { wch: 15 }, // Dispatch Date
      { wch: 15 }, // Ngày chuẩn bị
      { wch: 20 }  // Ghi chú
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Shipment_Template.xlsx');
  }

  // Export to Excel
  exportToExcel(): void {
    try {
      const exportData = this.filteredShipments.map(shipment => ({
        'No': this.filteredShipments.indexOf(shipment) + 1,
        'Shipment': shipment.shipmentCode,
        'Mã TP': shipment.materialCode,
        'Mã Khách': shipment.customerCode,
        'Lượng Xuất': shipment.quantity,
        'PO Ship': shipment.poShip,
        'Carton': shipment.carton,
        'Odd': shipment.odd,
        'Tồn kho': shipment.inventory || 0,
        'FWD': shipment.shipMethod,
        'Push': shipment.push ? 'Yes' : 'No',
        'PushNo': shipment.pushNo,
        'Status': shipment.status,
        'CS Date': this.formatDateForExport(shipment.requestDate),
        'Full Date': this.formatDateForExport(shipment.fullDate),
        'Dispatch Date': this.formatDateForExport(shipment.actualShipDate),
        'Ngày chuẩn bị': shipment.dayPre,
        'Ghi chú': shipment.notes
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Shipment Data');
      
      XLSX.writeFile(wb, `Shipment_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      alert('Lỗi khi export dữ liệu. Vui lòng thử lại.');
    }
  }

  // Format date for export
  private formatDateForExport(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Delete all shipments
  deleteAllShipments(): void {
    if (confirm('Bạn có chắc muốn xóa TẤT CẢ shipments? Hành động này không thể hoàn tác!')) {
      this.firestore.collection('shipments').get().subscribe(snapshot => {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batch.commit().then(() => {
          console.log('All shipments deleted');
          this.shipments = [];
          this.filteredShipments = [];
          alert('Đã xóa tất cả shipments');
        }).catch(error => {
          console.error('Error deleting all shipments:', error);
          alert('Lỗi khi xóa dữ liệu. Vui lòng thử lại.');
        });
      });
    }
  }
} 