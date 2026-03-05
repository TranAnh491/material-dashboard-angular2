import { Injectable } from '@angular/core';
import * as QRCode from 'qrcode';

export interface PxkLine {
  materialCode: string;
  quantity: number;
  unit: string;
  po: string;
  soChungTu?: string;
  maKho?: string;
  loaiHinh?: string;
  tenVatTu?: string;
  dinhMuc?: string;
  tenTP?: string;
  tongSLYCau?: string;
  soPOKH?: string;
  phanTramHaoHut?: string;
  maKhachHang?: string;
  ghiChu?: string;
}

export interface PxkWorkOrder {
  productionOrder?: string;
  productCode?: string;
  quantity?: number;
  deliveryDate?: Date | string | null;
  productionLine?: string;
  customer?: string;
}

export interface PxkBuildParams {
  lsx: string;
  lines: PxkLine[];
  workOrder: PxkWorkOrder;
  factory: string;
  scanQtyMap: Map<string, number>;
  deliveryQtyMap: Map<string, number>;
  locationMap: Map<string, string>;
  nhanVienSoanStr: string;
  nhanVienGiaoStr: string;
  nhanVienNhanStr: string;
  lineNhanOverride?: string; // Dùng khi workOrder.productionLine trống, lấy từ line PXK hoặc work order khác
  nvlSxKsBoxHtml?: string;
}

@Injectable({ providedIn: 'root' })
export class PxkBuildService {

  private esc(s: string): string {
    if (s == null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private formatQty(n: number): string {
    const num = Number(n);
    const fixed = num.toFixed(2);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  async buildHtml(p: PxkBuildParams): Promise<string> {
    const { lsx, lines, workOrder, factory, scanQtyMap, deliveryQtyMap, locationMap } = p;
    const isAsm1 = factory.includes('ASM1') || factory === 'ASM1';
    const lineNhanRaw = (p.lineNhanOverride || workOrder.productionLine || '').trim();
    const lineNhan = lineNhanRaw || '-';
    let qrImage = '';
    let qrImageLine = '';
    try {
      qrImage = await QRCode.toDataURL(lsx, { width: 120, margin: 1 });
    } catch {}
    try {
      if (lineNhan !== '-' && lineNhan.length > 0) {
        qrImageLine = await QRCode.toDataURL(lineNhan, { width: 120, margin: 1 });
      }
    } catch {}

    const getLocation = (materialCode: string, po: string): string =>
      locationMap.get(`${String(materialCode || '').trim()}|${String(po || '').trim()}`) || '-';
    const getDeliveryQty = (materialCode: string, po: string): number =>
      deliveryQtyMap.get(`${String(materialCode || '').trim().toUpperCase()}|${String(po || '').trim()}`) || 0;
    const getScanQty = (materialCode: string, po: string): number =>
      scanQtyMap.get(`${String(materialCode || '').trim().toUpperCase()}|${String(po || '').trim()}`) || 0;
    const getSoSanh = (xuất: number, scan: number): string => {
      const diff = scan - xuất;
      if (Math.abs(diff) < 1) return 'Đủ';
      if (diff < 0) return 'Thiếu ' + this.formatQty(xuất - scan);
      return 'Dư ' + this.formatQty(scan - xuất);
    };

    const TOP_MA_KHO = new Set(['NVL', 'NVL_E31', 'NVL_KE31', 'NVL_EXPIRED', '00']);
    const sortByMat = (a: PxkLine, b: PxkLine) => (a.materialCode || '').localeCompare(b.materialCode || '');
    const group1 = lines.filter(l => TOP_MA_KHO.has(String((l as any).maKho || '').trim().toUpperCase())).sort(sortByMat);
    const group2 = lines.filter(l => !TOP_MA_KHO.has(String((l as any).maKho || '').trim().toUpperCase())).sort(sortByMat);
    const sortedLines: (PxkLine | null)[] = group1.length > 0 && group2.length > 0 ? [...group1, null, ...group2] : [...group1, ...group2];

    const soChungTuList = [...new Set(lines.map(l => (l.soChungTu || '').trim()).filter(Boolean))].sort();
    const soChungTuDisplay = soChungTuList.length > 0 ? soChungTuList.map(s => this.esc(s)).join('<br>') : '-';
    const tenTPDisplay = lines.length > 0 ? String((lines[0] as any).tenTP || '').trim() : '';
    const soPOKHDisplay = lines.map(l => String((l as any).soPOKH || '').trim()).find(v => v) || '';
    const phanTramHaoHutDisplay = lines.length > 0 ? String((lines[0] as any).phanTramHaoHut || '').trim() : '';
    const hasAnyScanData = lines.some(l => getScanQty(l.materialCode, l.po) > 0);
    const hasAnyDeliveryData = lines.some(l => getDeliveryQty(l.materialCode, l.po) > 0);

    let sttCounter = 0;
    const rowsHtml = sortedLines.map((l) => {
      if (l === null) {
        return '<tr><td colspan="16" style="border:1px solid #000;padding:8px;background:#fff;"></td></tr>';
      }
      sttCounter++;
      const matCode = String(l.materialCode || '').trim().toUpperCase();
      const maKho = String((l as any).maKho || '').trim().toUpperCase();
      const qtyStr = this.formatQty(l.quantity);
      const loaiHinh = String((l as any).loaiHinh || '').trim();
      const tenVatTu = String((l as any).tenVatTu || '').trim();
      const dinhMuc = String((l as any).dinhMuc || '').trim();
      const tongSLYCau = String((l as any).tongSLYCau || '').trim();
      const po = String(l.po || '').trim();
      const isNvlSxOnly = maKho === 'NVL_SX';
      const isR = matCode.charAt(0) === 'R';
      const isB033 = matCode.startsWith('B033');
      const isB030 = matCode.startsWith('B030');
      let scanQty: number;
      if (isNvlSxOnly) scanQty = Number(l.quantity) || 0;
      else if ((isR || isB030 || isB033) && hasAnyScanData) scanQty = Number(l.quantity) || 0;
      else scanQty = getScanQty(l.materialCode, po);
      const qtyPxk = Number(l.quantity) || 0;
      const soSanhStr = !hasAnyScanData && scanQty === 0 ? '' : getSoSanh(qtyPxk, scanQty);
      const soSanhColor = soSanhStr.startsWith('Thiếu') ? 'color:red;font-weight:bold;' : soSanhStr === 'Đủ' ? 'color:green;font-weight:bold;' : soSanhStr.startsWith('Dư') ? 'color:orange;font-weight:bold;' : '';
      const scanQtyStr = scanQty > 0 ? this.formatQty(scanQty) : '';
      const deliveryQty = getDeliveryQty(l.materialCode, po);
      const deliveryQtyStr = deliveryQty > 0 ? this.formatQty(deliveryQty) : '';
      return `<tr>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${sttCounter}</td>
        <td style="border:1px solid #000;padding:6px;">${this.esc(l.materialCode)}</td>
        <td class="col-ten-vat-tu" style="border:1px solid #000;padding:6px;">${this.esc(tenVatTu || '-')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.esc(l.unit)}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.esc(dinhMuc || '-')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.esc(tongSLYCau || '-')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.esc(po)}</td>
        <td style="border:1px solid #000;padding:6px;text-align:right;">${qtyStr}</td>
        <td style="border:1px solid #000;padding:6px;">${this.esc(maKho)}</td>
        <td class="col-vitri" style="border:1px solid #000;padding:6px;">${this.esc(getLocation(l.materialCode, l.po))}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.esc(loaiHinh)}</td>
        <td class="col-luong-scan" data-scan-key="${matCode}|${po}" data-qty-pxk="${qtyPxk}" data-is-nvl-sx="${isNvlSxOnly?'1':'0'}" data-is-rb="${(isR||isB030||isB033)?'1':'0'}" style="border:1px solid #000;padding:6px;text-align:right;">${this.esc(scanQtyStr)}</td>
        <td data-sosanh-key="${matCode}|${po}" style="border:1px solid #000;padding:6px;text-align:center;${soSanhColor}">${this.esc(soSanhStr)}</td>
        <td data-delivery-key="${matCode}|${po}" style="border:1px solid #000;padding:6px;text-align:right;">${this.esc(deliveryQtyStr)}</td>
        <td class="col-ghi-chu" style="border:1px solid #000;padding:6px;">${this.esc(String((l as any).ghiChu || ''))}</td>
        <td class="col-sx-tra" style="border:1px solid #000;padding:6px;"></td>
      </tr>`;
    }).join('');

    const deliveryDateStr = workOrder.deliveryDate
      ? (workOrder.deliveryDate instanceof Date ? workOrder.deliveryDate : new Date(workOrder.deliveryDate)).toLocaleDateString('vi-VN')
      : '-';
    const maKhachHangDisplay = lines.map(l => String((l as any).maKhachHang || '').trim()).find(v => v) || workOrder.customer || '-';
    const boxStyle = `flex:1;min-width:80px;min-height:120px;border:1px solid #000;padding:6px;display:flex;flex-direction:column;font-size:13px;box-sizing:border-box;position:relative`;
    const infoBox = (label: string, value: string) =>
      `<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">${this.esc(label)}</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.2;padding-top:18px;"><span>${this.esc(value || '-')}</span></div></div>`;
    const lsxUpper = lsx.toUpperCase().replace(/\s/g, '');
    const isKZ = lsxUpper.startsWith('KZ');
    const isLH = lsxUpper.startsWith('LH');
    const isWHE = lineNhan.trim().toUpperCase() === 'WH E';
    const factoryIconHtml = isKZ
      ? `<span style="position:absolute;top:6px;left:6px;font-size:16px;font-weight:bold;">${isWHE ? 'ASM3' : 'ASM1'}</span>`
      : isLH ? `<span style="position:absolute;top:6px;left:6px;font-size:16px;font-weight:bold;">ASM2</span>` : '';
    const maTPVNBox = `<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">Mã TP VN</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.2;padding-top:18px;"><span>${this.esc(workOrder.productCode || '-')}</span></div></div>`;
    const maKhachHangBox = infoBox('Mã Khách Hàng', this.esc(maKhachHangDisplay));
    const lsxBox = `<div style="${boxStyle};flex-direction:row;align-items:center;justify-content:space-between;gap:6px;"><div style="flex:1;display:flex;flex-direction:column;"><strong style="font-size:10px;text-transform:uppercase;margin-bottom:2px;">Lệnh Sản Xuất</strong><span style="word-break:break-all;font-size:11px;">${this.esc(lsx)}</span></div>${qrImage ? `<img src="${qrImage}" alt="QR" style="width:70px;height:70px;flex-shrink:0;display:block;" />` : ''}</div>`;
    const isUsbCLine = /USB\s*C/i.test(lineNhan);
    const cameraIconHtml = isUsbCLine ? `<span style="position:absolute;top:4px;right:4px;width:24px;height:24px;display:inline-block;" title="Chụp hình"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" width="24" height="24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg></span>` : '';
    const lineNhanBoxStyle = boxStyle + ';flex-direction:row;align-items:center;justify-content:space-between;gap:6px;position:relative;';
    const lineNhanBox = `<div style="${lineNhanBoxStyle}">${factoryIconHtml}${cameraIconHtml}<div style="flex:1;display:flex;flex-direction:column;padding-top:${factoryIconHtml ? '22px' : '0'};min-width:0;"><strong style="font-size:10px;text-transform:uppercase;margin-bottom:2px;">Line Nhận</strong><span style="word-break:break-all;font-size:11px;">${this.esc(lineNhan)}</span></div>${qrImageLine ? `<img src="${qrImageLine}" alt="QR Line" style="width:70px;height:70px;flex-shrink:0;display:block;" />` : ''}</div>`;
    const soChungTuBox = `<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">Số Chứng Từ</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.4;font-size:11px;padding-top:18px;"><span>${soChungTuDisplay}</span></div></div>`;
    const rowStyle = 'display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;width:100%;margin-bottom:8px';
    const headerSection = `
<div style="margin-bottom:16px;width:100%;box-sizing:border-box;">
  <div style="${rowStyle}">
    ${maTPVNBox}
    ${maKhachHangBox}
    ${infoBox('Phần Trăm Hao Hụt', phanTramHaoHutDisplay ? this.esc(phanTramHaoHutDisplay) + '%' : '')}
    ${`<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">Lượng sản phẩm</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.2;padding-top:18px;"><span>${this.formatQty(workOrder.quantity || 0)}</span></div>${deliveryDateStr !== '-' ? `<span style="position:absolute;bottom:6px;left:6px;font-size:11px;">Ngày giao: ${this.esc(deliveryDateStr)}</span>` : ''}</div>`}
    ${lsxBox}
    ${lineNhanBox}
  </div>
  <div style="${rowStyle}">
    ${infoBox('Tên TP', this.esc(tenTPDisplay || ''))}
    ${infoBox('Số PO KH', this.esc(soPOKHDisplay || ''))}
    ${soChungTuBox}
    ${infoBox('Nhân Viên Soạn', this.esc(p.nhanVienSoanStr))}
    ${infoBox('Nhân viên Giao', this.esc(p.nhanVienGiaoStr))}
    ${infoBox('Nhân viên Nhận', this.esc(p.nhanVienNhanStr))}
  </div>
</div>`;

    const nvlBox = p.nvlSxKsBoxHtml || '';
    const logoUrl = typeof window !== 'undefined' ? (window.location.origin + '/assets/img/logo.png') : '/assets/img/logo.png';
    return `
<div class="pxk-preview-content">
<style>
.pxk-preview-content .pxk-top-header-wrap{width:100%;margin-bottom:12px}
.pxk-preview-content .pxk-top-header{width:100%;border-collapse:collapse;table-layout:fixed}
.pxk-preview-content .pxk-top-header td{vertical-align:middle;border:1px solid #000;padding:8px}
.pxk-preview-content .pxk-top-header .logo-cell{width:230px;min-width:150px;text-align:center}
.pxk-preview-content .pxk-top-header .logo-cell img{max-width:100%;max-height:80px;object-fit:contain;display:block;margin:0 auto}
.pxk-preview-content .pxk-top-header .title-cell{text-align:center;width:auto}
.pxk-preview-content .pxk-top-header .title-inner{width:100%;border-collapse:collapse}
.pxk-preview-content .pxk-top-header .title-inner td{border:none;padding:6px 8px;text-align:center}
.pxk-preview-content .pxk-top-header .title-line1{font-size:18px;font-weight:bold}
.pxk-preview-content .pxk-top-header .title-line2{font-size:14px;text-transform:uppercase}
.pxk-preview-content .pxk-top-header .meta-cell{width:230px;min-width:180px}
.pxk-preview-content .pxk-top-header .meta-table{width:100%;border-collapse:collapse;font-size:11px}
.pxk-preview-content .pxk-top-header .meta-table td{border:1px solid #000;padding:4px 6px}
.pxk-preview-content .pxk-top-header .meta-table .meta-label{width:45%;background:#f5f5f5}
.pxk-preview-content .pxk-top-header .meta-table td:not(.meta-label){white-space:nowrap}
.pxk-preview-content .pxk-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10px}
.pxk-preview-content .pxk-table th,.pxk-preview-content .pxk-table td{border:1px solid #000;padding:6px}
.pxk-preview-content .pxk-table th{background:#f0f0f0;font-weight:bold;text-transform:uppercase}
.pxk-preview-content .pxk-table th.col-ten-vat-tu,.pxk-preview-content .pxk-table td.col-ten-vat-tu{min-width:120px;width:14%}
.pxk-preview-content .pxk-table td.col-ten-vat-tu{font-size:8px}
.pxk-preview-content .pxk-table th.col-vitri,.pxk-preview-content .pxk-table td.col-vitri{min-width:80px;width:9.6%}
.pxk-preview-content .pxk-table th.col-luong-scan,.pxk-preview-content .pxk-table td.col-luong-scan,.pxk-preview-content .pxk-table th.col-sx-tra,.pxk-preview-content .pxk-table td.col-sx-tra{min-width:70px;width:7%}
.pxk-preview-content .pxk-table th.col-ghi-chu,.pxk-preview-content .pxk-table td.col-ghi-chu{min-width:80px;width:9%}
</style>
<div class="pxk-top-header-wrap">
<table class="pxk-top-header">
<tr>
  <td class="logo-cell"><img src="${logoUrl}" alt="AIRSPEED" /></td>
  <td class="title-cell"><table class="title-inner"><tr><td class="title-line1">AIRSPEED MANUFACTURING VIET NAM</td></tr><tr><td class="title-line2">DANH SÁCH VẬT TƯ THEO LỆNH SẢN XUẤT</td></tr></table></td>
  <td class="meta-cell"><table class="meta-table"><tr><td class="meta-label">Mã quản lý</td><td>WH-WI0005/F07</td></tr><tr><td class="meta-label">Phiên bản</td><td>00</td></tr><tr><td class="meta-label">Ngày ban hành</td><td>05/03/2026</td></tr><tr><td class="meta-label">Số Trang</td><td>01</td></tr></table></td>
</tr>
</table>
</div>
${headerSection}
<table class="pxk-table">
<thead><tr><th>STT</th><th>Mã vật tư</th><th class="col-ten-vat-tu">Tên Vật Tư</th><th>Đơn vị tính</th><th>Định Mức</th><th>Tổng SL Y/Cầu</th><th>PO</th><th>Xuất Kho</th><th>Mã Kho</th><th class="col-vitri">Vị trí</th><th>Loại Hình</th><th class="col-luong-scan">Lượng Scan</th><th>So Sánh</th><th>Lượng Giao</th><th class="col-ghi-chu">Ghi chú</th><th class="col-sx-tra">SX trả</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
${nvlBox}
</div>`;
  }
}
