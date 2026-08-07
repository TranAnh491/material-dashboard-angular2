import { Component } from '@angular/core';
import { Router } from '@angular/router';

export interface StockOutLine {
  stt: number;
  poNumber: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  actualQuantity: number;
  nxkCode: string;
  locationCode: string;
  remark: string;
}

@Component({
  selector: 'app-bieu-mau',
  templateUrl: './bieu-mau.component.html',
  styleUrls: ['./bieu-mau.component.scss']
})
export class BieuMauComponent {
  /** Metadata form control */
  formMeta = {
    managementCode: 'WH-P01/F04',
    version: '04',
    issuedDate: '02/05/2022'
  };

  /** Demo header — khớp mẫu hình */
  header = {
    voucherNo: 'KZPX0826/0351',
    outputDate: '05/08/2026',
    warehouse: 'CC',
    productCode: '',
    dispatchType: 'X-CC3',
    receivingDept: '',
    productionOrder: '',
    remark: 'ASM1 Xuất CCDC PD'
  };

  /** Demo lines */
  lines: StockOutLine[] = [
    {
      stt: 2,
      poNumber: 'KZPO0726 /0036',
      materialCode: 'C022046',
      materialName: 'Dây TE tiếp địa Cadivi CV-2.5 (1 ROLL = 100M)',
      unit: 'ROLL',
      quantity: 1,
      actualQuantity: 1,
      nxkCode: 'ND',
      locationCode: '',
      remark: ''
    }
  ];

  constructor(private router: Router) {}

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  getLogoSrc(): string {
    return typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/assets/img/logo.png`
      : '/assets/img/logo.png';
  }

  formatQty(n: number): string {
    return (Number(n) || 0).toLocaleString('vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  printForm(): void {
    window.print();
  }
}
