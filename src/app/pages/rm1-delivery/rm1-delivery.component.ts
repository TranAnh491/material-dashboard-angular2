import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface DeliveryRecord {
  id?: string;
  mode: 'kiem-tra' | 'giao-hang'; // Kiểm tra hoặc Giao hàng
  employeeId: string;
  employeeName?: string;
  lsx: string; // Lệnh sản xuất
  materials?: Array<{
    materialCode: string;
    poNumber?: string;
    quantity?: number;
  }>;
  receiveLine?: string; // Line nhận (chỉ cho Giao hàng)
  timestamp: Date;
  createdAt?: Date;
}

@Component({
  selector: 'app-rm1-delivery',
  templateUrl: './rm1-delivery.component.html',
  styleUrls: ['./rm1-delivery.component.scss']
})
export class Rm1DeliveryComponent implements OnInit, OnDestroy {
  // Mode selection
  selectedMode: 'kiem-tra' | 'giao-hang' | null = null;
  
  // Employee verification
  showEmployeeModal: boolean = false;
  employeeScanInput: string = '';
  currentEmployeeId: string = '';
  currentEmployeeName: string = '';
  isEmployeeVerified: boolean = false;
  
  // LSX scan
  lsxScanInput: string = '';
  currentLsx: string = '';
  isLsxScanned: boolean = false;
  
  // Material scan (cho Kiểm tra)
  materialScanInput: string = '';
  scannedMaterials: Array<{
    materialCode: string;
    poNumber?: string;
    quantity?: number;
  }> = [];
  
  // Receive Line scan (cho Giao hàng)
  receiveLineScanInput: string = '';
  currentReceiveLine: string = '';
  
  // Current step
  currentStep: 'mode' | 'employee' | 'lsx' | 'materials' | 'receiveLine' | 'done' = 'mode';
  
  // History
  deliveryHistory: DeliveryRecord[] = [];
  isLoadingHistory: boolean = false;
  
  private destroy$ = new Subject<void>();
  
  constructor(
    private firestore: AngularFirestore,
    private router: Router
  ) {}
  
  ngOnInit(): void {
    console.log('📦 RM1 Delivery Component initialized');
    this.loadDeliveryHistory();
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  // Mode selection
  selectMode(mode: 'kiem-tra' | 'giao-hang'): void {
    this.selectedMode = mode;
    this.currentStep = 'employee';
    this.showEmployeeModal = true;
    console.log('✅ Mode selected:', mode);
  }
  
  // Employee verification
  verifyEmployee(): void {
    const employeeId = this.employeeScanInput.trim().toUpperCase();
    
    if (!employeeId || !employeeId.startsWith('ASP')) {
      alert('⚠️ Mã nhân viên không hợp lệ! Vui lòng nhập mã nhân viên (VD: ASP0106)');
      return;
    }
    
    // Tìm nhân viên trong Firestore - có thể tìm theo employeeId hoặc displayName hoặc email
    this.firestore.collection('users', ref =>
      ref.where('displayName', '==', employeeId).limit(1)
    ).get().toPromise().then(snapshot => {
      if (snapshot && !snapshot.empty) {
        const userData = snapshot.docs[0].data() as any;
        this.currentEmployeeId = employeeId;
        this.currentEmployeeName = userData.displayName || employeeId;
        this.isEmployeeVerified = true;
        this.showEmployeeModal = false;
        this.currentStep = 'lsx';
        console.log('✅ Employee verified:', this.currentEmployeeName);
      } else {
        // Nếu không tìm thấy, vẫn cho phép với employeeId
        this.currentEmployeeId = employeeId;
        this.currentEmployeeName = employeeId;
        this.isEmployeeVerified = true;
        this.showEmployeeModal = false;
        this.currentStep = 'lsx';
        console.log('⚠️ Employee not found in database, using ID:', employeeId);
      }
    }).catch(error => {
      console.error('❌ Error verifying employee:', error);
      // Vẫn cho phép với employeeId nếu có lỗi
      this.currentEmployeeId = employeeId;
      this.currentEmployeeName = employeeId;
      this.isEmployeeVerified = true;
      this.showEmployeeModal = false;
      this.currentStep = 'lsx';
    });
  }
  
  closeEmployeeModal(): void {
    // Không cho phép đóng nếu chưa verify
    if (!this.isEmployeeVerified) {
      return;
    }
  }
  
  // LSX scan
  onLsxScan(): void {
    const lsx = this.lsxScanInput.trim();
    
    if (!lsx) {
      alert('⚠️ Vui lòng nhập hoặc quét LSX!');
      return;
    }
    
    this.currentLsx = lsx;
    this.isLsxScanned = true;
    this.lsxScanInput = '';
    
    // Chuyển sang bước tiếp theo
    if (this.selectedMode === 'kiem-tra') {
      this.currentStep = 'materials';
    } else {
      this.currentStep = 'receiveLine';
    }
    
    console.log('✅ LSX scanned:', this.currentLsx);
  }
  
  // Material scan (cho Kiểm tra)
  onMaterialScan(): void {
    const materialCode = this.materialScanInput.trim();
    
    if (!materialCode) {
      alert('⚠️ Vui lòng nhập hoặc quét mã nguyên liệu!');
      return;
    }
    
    // Parse QR code format: MaterialCode|PO|Quantity
    const parts = materialCode.split('|');
    let materialData: any = {
      materialCode: parts[0]
    };
    
    if (parts.length >= 2) {
      materialData.poNumber = parts[1];
    }
    
    if (parts.length >= 3) {
      materialData.quantity = parseFloat(parts[2]) || undefined;
    }
    
    // Kiểm tra xem đã scan chưa
    const existingIndex = this.scannedMaterials.findIndex(m => 
      m.materialCode === materialData.materialCode && 
      m.poNumber === materialData.poNumber
    );
    
    if (existingIndex >= 0) {
      alert('⚠️ Mã nguyên liệu này đã được quét!');
      this.materialScanInput = '';
      return;
    }
    
    this.scannedMaterials.push(materialData);
    this.materialScanInput = '';
    
    console.log('✅ Material scanned:', materialData);
    console.log('📦 Total materials:', this.scannedMaterials.length);
  }
  
  removeMaterial(index: number): void {
    this.scannedMaterials.splice(index, 1);
  }
  
  // Receive Line scan (cho Giao hàng)
  onReceiveLineScan(): void {
    const receiveLine = this.receiveLineScanInput.trim();
    
    if (!receiveLine) {
      alert('⚠️ Vui lòng nhập hoặc quét Line nhận!');
      return;
    }
    
    this.currentReceiveLine = receiveLine;
    this.receiveLineScanInput = '';
    this.currentStep = 'done';
    
    console.log('✅ Receive Line scanned:', this.currentReceiveLine);
  }
  
  // Done - Save to Firestore
  async onDone(): Promise<void> {
    if (!this.currentEmployeeId || !this.currentLsx) {
      alert('⚠️ Vui lòng scan đầy đủ thông tin!');
      return;
    }
    
    if (this.selectedMode === 'kiem-tra' && this.scannedMaterials.length === 0) {
      alert('⚠️ Vui lòng scan ít nhất một mã nguyên liệu!');
      return;
    }
    
    if (this.selectedMode === 'giao-hang' && !this.currentReceiveLine) {
      alert('⚠️ Vui lòng scan Line nhận!');
      return;
    }
    
    try {
      const deliveryRecord: DeliveryRecord = {
        mode: this.selectedMode!,
        employeeId: this.currentEmployeeId,
        employeeName: this.currentEmployeeName,
        lsx: this.currentLsx,
        materials: this.selectedMode === 'kiem-tra' ? this.scannedMaterials : undefined,
        receiveLine: this.selectedMode === 'giao-hang' ? this.currentReceiveLine : undefined,
        timestamp: new Date(),
        createdAt: new Date()
      };
      
      await this.firestore.collection('rm1-delivery-records').add(deliveryRecord);
      
      console.log('✅ Delivery record saved:', deliveryRecord);
      alert('✅ Đã lưu thành công!');
      
      // Reset form
      this.resetForm();
      
      // Reload history
      this.loadDeliveryHistory();
      
    } catch (error) {
      console.error('❌ Error saving delivery record:', error);
      alert('❌ Lỗi khi lưu dữ liệu: ' + error);
    }
  }
  
  resetForm(): void {
    this.selectedMode = null;
    this.currentStep = 'mode';
    this.currentEmployeeId = '';
    this.currentEmployeeName = '';
    this.isEmployeeVerified = false;
    this.showEmployeeModal = false;
    this.currentLsx = '';
    this.isLsxScanned = false;
    this.lsxScanInput = '';
    this.materialScanInput = '';
    this.scannedMaterials = [];
    this.receiveLineScanInput = '';
    this.currentReceiveLine = '';
  }
  
  // Load delivery history
  loadDeliveryHistory(): void {
    this.isLoadingHistory = true;
    
    this.firestore.collection('rm1-delivery-records', ref =>
      ref.orderBy('timestamp', 'desc').limit(50)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.deliveryHistory = snapshot.map(doc => {
          const data = doc.payload.doc.data() as any;
          return {
            id: doc.payload.doc.id,
            mode: data.mode,
            employeeId: data.employeeId,
            employeeName: data.employeeName,
            lsx: data.lsx,
            materials: data.materials || [],
            receiveLine: data.receiveLine,
            timestamp: data.timestamp?.toDate() || new Date(),
            createdAt: data.createdAt?.toDate() || new Date()
          } as DeliveryRecord;
        });
        
        this.isLoadingHistory = false;
        console.log('✅ Loaded delivery history:', this.deliveryHistory.length);
      },
      error: (error) => {
        console.error('❌ Error loading delivery history:', error);
        this.isLoadingHistory = false;
      }
    });
  }
  
  goToMenu(): void {
    this.router.navigate(['/menu']);
  }
  
  formatDate(date: Date): string {
    return date.toLocaleString('vi-VN');
  }
}

