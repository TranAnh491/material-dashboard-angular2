import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface DeliveryRecord {
  id?: string;
  mode: 'kiem-tra' | 'giao-hang';
  employeeId: string;
  employeeName?: string;
  lsx: string;
  materials?: Array<{
    materialCode: string;
    poNumber?: string;
    quantity?: number;
    deliveryQuantity?: number;
    deliveryScannedAt?: Date;
  }>;
  receiveLine?: string;
  receiverEmployeeId?: string; // Mã nhân viên nhận (Giao hàng)
  receiverEmployeeName?: string;
  outboundLines?: Array<{ materialCode: string; poNumber: string; quantity: number; deliveryQuantity?: number; deliveryScannedAt?: Date }>;
  timestamp: Date;
  createdAt?: Date;
}

/** Dòng outbound đã lọc theo LSX + thông tin giao hàng */
export interface OutboundDeliveryRow {
  materialCode: string;
  poNumber: string;
  quantity: number; // Lượng outbound (đã scan ở outbound)
  deliveryQuantity?: number; // Lượng giao (scan khi giao)
  deliveryScannedAt?: Date; // Thời gian scan giao
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
  
  // Current step (Giao hàng: lsx → receiveLine → employeeReceiver → deliveryScan → done)
  currentStep: 'mode' | 'employee' | 'lsx' | 'materials' | 'receiveLine' | 'employeeReceiver' | 'deliveryScan' | 'done' = 'mode';
  
  // Mã nhân viên nhận (chỉ cho Giao hàng)
  receiverScanInput: string = '';
  receiverEmployeeId: string = '';
  receiverEmployeeName: string = '';
  isReceiverVerified: boolean = false;
  
  // Outbound theo LSX (Giao hàng): mã, PO, lượng đã scan outbound + lượng giao + thời gian
  outboundDeliveryRows: OutboundDeliveryRow[] = [];
  isLoadingOutbound: boolean = false;
  deliveryMaterialScanInput: string = ''; // Scan mã|PO|lượng để ghi nhận giao
  
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
    if (mode === 'giao-hang') {
      // Giao hàng: đầu tiên scan LSX → Line giao → Mã NV nhận → bảng scan
      this.currentStep = 'lsx';
      this.showEmployeeModal = false;
    } else {
      this.currentStep = 'employee';
      this.showEmployeeModal = true;
    }
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
      alert('⚠️ Vui lòng nhập hoặc quét LSX giao!');
      return;
    }
    
    this.currentLsx = lsx;
    this.isLsxScanned = true;
    this.lsxScanInput = '';
    
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
      alert('⚠️ Vui lòng nhập hoặc quét Line giao!');
      return;
    }
    
    this.currentReceiveLine = receiveLine;
    this.receiveLineScanInput = '';
    this.currentStep = 'employeeReceiver';
    this.showEmployeeModal = true;
    
    console.log('✅ Line giao scanned:', this.currentReceiveLine);
  }
  
  // Mã nhân viên nhận (Giao hàng) - dùng chung modal với nhãn khác
  verifyReceiver(): void {
    const employeeId = this.receiverScanInput.trim().toUpperCase();
    
    if (!employeeId) {
      alert('⚠️ Vui lòng quét hoặc nhập mã nhân viên nhận!');
      return;
    }
    
    this.firestore.collection('users', ref =>
      ref.where('displayName', '==', employeeId).limit(1)
    ).get().toPromise().then(snapshot => {
      if (snapshot && !snapshot.empty) {
        const userData = snapshot.docs[0].data() as any;
        this.receiverEmployeeId = employeeId;
        this.receiverEmployeeName = userData.displayName || employeeId;
      } else {
        this.receiverEmployeeId = employeeId;
        this.receiverEmployeeName = employeeId;
      }
      this.isReceiverVerified = true;
      this.showEmployeeModal = false;
      this.receiverScanInput = '';
      this.currentStep = 'deliveryScan';
      this.loadOutboundByLsx();
      console.log('✅ Mã NV nhận:', this.receiverEmployeeName);
    }).catch(() => {
      this.receiverEmployeeId = employeeId;
      this.receiverEmployeeName = employeeId;
      this.isReceiverVerified = true;
      this.showEmployeeModal = false;
      this.receiverScanInput = '';
      this.currentStep = 'deliveryScan';
      this.loadOutboundByLsx();
    });
  }
  
  // Lọc outbound theo LSX (mã, PO, lượng đã scan ở outbound)
  loadOutboundByLsx(): void {
    if (!this.currentLsx || this.currentLsx.trim() === '') return;
    
    this.isLoadingOutbound = true;
    this.outboundDeliveryRows = [];
    
    this.firestore.collection('outbound-materials', ref =>
      ref.where('factory', '==', 'ASM1')
         .where('productionOrder', '==', this.currentLsx.trim())
         .limit(200)
    ).get().toPromise().then(snapshot => {
      const map = new Map<string, OutboundDeliveryRow>();
      (snapshot?.docs || []).forEach(doc => {
        const d = doc.data() as any;
        const materialCode = (d.materialCode || '').toString().trim();
        const poNumber = (d.poNumber || '').toString().trim();
        const qty = Number(d.quantity) || 0;
        const key = `${materialCode}|${poNumber}`;
        const existing = map.get(key);
        if (existing) {
          existing.quantity += qty;
        } else {
          map.set(key, { materialCode, poNumber, quantity: qty });
        }
      });
      this.outboundDeliveryRows = Array.from(map.values()).sort((a, b) =>
        (a.materialCode + a.poNumber).localeCompare(b.materialCode + b.poNumber)
      );
      this.isLoadingOutbound = false;
      console.log('✅ Outbound theo LSX:', this.outboundDeliveryRows.length, 'dòng');
    }).catch(err => {
      console.error('❌ Load outbound error:', err);
      this.isLoadingOutbound = false;
    });
  }
  
  // Scan mã|PO|lượng khi giao - check 1 lần, ghi lượng giao + thời gian
  onDeliveryMaterialScan(): void {
    const raw = this.deliveryMaterialScanInput.trim();
    if (!raw) return;
    
    const parts = raw.split('|');
    const materialCode = (parts[0] || '').trim();
    const poNumber = (parts.length >= 2) ? (parts[1] || '').trim() : '';
    const scannedQty = (parts.length >= 3) ? (parseFloat(parts[2]) || 0) : 0;
    
    if (!materialCode) {
      this.deliveryMaterialScanInput = '';
      return;
    }
    
    const row = this.outboundDeliveryRows.find(r =>
      (r.materialCode || '').toUpperCase() === materialCode.toUpperCase() &&
      (r.poNumber || '').toUpperCase() === poNumber.toUpperCase()
    );
    
    if (!row) {
      alert('⚠️ Không tìm thấy mã/PO trong danh sách outbound LSX này. Kiểm tra lại.');
      this.deliveryMaterialScanInput = '';
      return;
    }
    
    row.deliveryQuantity = scannedQty > 0 ? scannedQty : row.quantity;
    row.deliveryScannedAt = new Date();
    this.deliveryMaterialScanInput = '';
    console.log('✅ Ghi nhận giao:', row.materialCode, row.poNumber, row.deliveryQuantity, row.deliveryScannedAt);
  }
  
  // Done - Save to Firestore
  async onDone(): Promise<void> {
    if (!this.currentLsx) {
      alert('⚠️ Vui lòng scan LSX!');
      return;
    }
    
    if (this.selectedMode === 'kiem-tra') {
      if (!this.currentEmployeeId) {
        alert('⚠️ Vui lòng xác thực nhân viên!');
        return;
      }
      if (this.scannedMaterials.length === 0) {
        alert('⚠️ Vui lòng scan ít nhất một mã nguyên liệu!');
        return;
      }
    }
    
    if (this.selectedMode === 'giao-hang') {
      if (!this.currentReceiveLine) {
        alert('⚠️ Vui lòng scan Line giao!');
        return;
      }
      if (!this.receiverEmployeeId) {
        alert('⚠️ Vui lòng scan mã nhân viên nhận!');
        return;
      }
    }
    
    try {
      const deliveryRecord: DeliveryRecord = {
        mode: this.selectedMode!,
        employeeId: this.selectedMode === 'kiem-tra' ? this.currentEmployeeId : (this.receiverEmployeeId || ''),
        employeeName: this.selectedMode === 'kiem-tra' ? this.currentEmployeeName : this.receiverEmployeeName,
        lsx: this.currentLsx,
        materials: this.selectedMode === 'kiem-tra' ? this.scannedMaterials : undefined,
        receiveLine: this.selectedMode === 'giao-hang' ? this.currentReceiveLine : undefined,
        receiverEmployeeId: this.selectedMode === 'giao-hang' ? this.receiverEmployeeId : undefined,
        receiverEmployeeName: this.selectedMode === 'giao-hang' ? this.receiverEmployeeName : undefined,
        outboundLines: this.selectedMode === 'giao-hang' ? this.outboundDeliveryRows.map(r => ({
          materialCode: r.materialCode,
          poNumber: r.poNumber,
          quantity: r.quantity,
          deliveryQuantity: r.deliveryQuantity,
          deliveryScannedAt: r.deliveryScannedAt
        })) : undefined,
        timestamp: new Date(),
        createdAt: new Date()
      };
      
      await this.firestore.collection('rm1-delivery-records').add(deliveryRecord);
      
      console.log('✅ Delivery record saved:', deliveryRecord);
      alert('✅ Đã lưu thành công!');
      
      this.resetForm();
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
    this.receiverScanInput = '';
    this.receiverEmployeeId = '';
    this.receiverEmployeeName = '';
    this.isReceiverVerified = false;
    this.outboundDeliveryRows = [];
    this.deliveryMaterialScanInput = '';
  }
  
  formatDeliveryTime(d: Date | undefined): string {
    if (!d) return '—';
    const x = d instanceof Date ? d : new Date(d);
    return isNaN(x.getTime()) ? '—' : x.toLocaleString('vi-VN');
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
          const outboundLines = (data.outboundLines || []).map((line: any) => ({
            ...line,
            deliveryScannedAt: line.deliveryScannedAt?.toDate?.() || line.deliveryScannedAt
          }));
          return {
            id: doc.payload.doc.id,
            mode: data.mode,
            employeeId: data.employeeId,
            employeeName: data.employeeName,
            lsx: data.lsx,
            materials: data.materials || [],
            receiveLine: data.receiveLine,
            receiverEmployeeId: data.receiverEmployeeId,
            receiverEmployeeName: data.receiverEmployeeName,
            outboundLines,
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

