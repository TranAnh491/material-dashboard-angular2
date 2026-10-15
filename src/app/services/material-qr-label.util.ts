import { stripTemThungMarker } from './tem-thung-qr.util';

/**
 * Tem QR nguyên liệu 57×32mm — cùng format tem Inbound:
 * Mã, PO, Số lượng, IMD, BAG/THÙNG + Lô, Loại hình, icon TRA PD/EN, vị trí yêu cầu.
 */
export interface MaterialQrLabel {
  kind?: 'bag' | 'carton' | 'lsxHeader' | 'spacer';
  qrImage?: string;
  qrData: string;
  batchNumber?: string;
  labelType?: string;
  iconType?: 'PD' | 'EN' | null;
  homeLoc?: string;
  cartonIndex?: number;
  cartonTotal?: number;
  displayPrefix?: string;
  lsxText?: string;
}

export function escapeMaterialLabelHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function materialLabelTraIconType(batchNumber: string): 'PD' | 'EN' | null {
  const bn = String(batchNumber || '').toUpperCase();
  if (bn.includes('TRA PD')) return 'PD';
  if (bn.includes('TRA EN')) return 'EN';
  return null;
}

/** Lô trên tem: chỉ lấy phần số (VD "3793 PGIIN" → "3793"). */
export function formatMaterialLabelLotNumber(batchNumber: string): string {
  const raw = String(batchNumber || '').trim();
  if (!raw) return '';
  const first = raw.split(/\s+/)[0];
  if (/^\d+$/.test(first)) return first;
  const m = raw.match(/(\d+)/);
  return m ? m[1] : '';
}

export function formatMaterialLabelType(type: string | undefined | null): string {
  return String(type || '').trim().toUpperCase();
}

export function formatMaterialLabelQuantity(qty: string): string {
  const raw = String(qty ?? '').trim().replace(/,/g, '');
  if (raw === '') return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(qty);
  return n.toLocaleString('en-US');
}

export function formatMaterialLabelHomeLoc(raw: string | null | undefined): string {
  const first = String(raw || '')
    .split(/[,;|/]+/)
    .map((x) => x.trim())
    .find(Boolean);
  return first || '';
}

/** Chuỗi QR: Mã|PO|lượng|DDMMYYYY-bịch/tổng (tem thùng có tiền tố ẩn TT:). */
export function parseMaterialQrLabelFields(qrData: string): {
  materialCode: string;
  po: string;
  quantity: string;
  imd: string;
  bag: string;
} {
  const parts = String(qrData || '').split('|');
  const p4 = (parts[3] || '').trim();
  const di = p4.indexOf('-');
  const bagOnly = di < 0 && /^\d+\/\d+$/.test(p4);
  const imd = di >= 0 ? p4.slice(0, di).trim() : bagOnly ? '' : p4;
  const bag = di >= 0 ? p4.slice(di + 1).trim() : bagOnly ? p4 : '';
  return {
    materialCode: stripTemThungMarker(parts[0] || '').materialCode.trim(),
    po: (parts[1] || '').trim(),
    quantity: (parts[2] || '').trim(),
    imd,
    bag
  };
}

function bagLotRowHtml(unitLabel: string, unitValue: string, batchNumber: string): string {
  const e = escapeMaterialLabelHtml;
  const lot = formatMaterialLabelLotNumber(batchNumber);
  const lotHtml = lot ? `<span class="bag-lot-item">Lô: ${e(lot)}</span>` : '';
  return `<div class="info-row info-row-bag-lot">
                          <span class="bag-lot-item">${e(unitLabel)}: ${e(unitValue)}</span>
                          ${lotHtml}
                        </div>`;
}

function typeRowHtml(type: string): string {
  const value = formatMaterialLabelType(type);
  if (!value) return '';
  return `<div class="info-row info-row-type">${escapeMaterialLabelHtml(value)}</div>`;
}

export function renderMaterialQrLabelHtml(label: MaterialQrLabel): string {
  const e = escapeMaterialLabelHtml;
  if (label.kind === 'lsxHeader') {
    return `
                    <div class="qr-container qr-container--lsx">
                      <div class="lsx-header-text">${e(String(label.lsxText ?? '').trim())}</div>
                    </div>
                  `;
  }
  if (label.kind === 'spacer') {
    return `
                    <div class="qr-container qr-container--blank"></div>
                  `;
  }
  const f = parseMaterialQrLabelFields(label.qrData);
  const qty = formatMaterialLabelQuantity(f.quantity);
  const qtyLine = label.displayPrefix ? `${label.displayPrefix} ${qty}` : qty;
  const unitRow =
    label.kind === 'carton'
      ? bagLotRowHtml('THÙNG', `${label.cartonIndex ?? ''}/${label.cartonTotal ?? ''}`, label.batchNumber || '')
      : bagLotRowHtml('BAG', f.bag, label.batchNumber || '');
  const iconHtml = label.iconType ? `<div class="icon-badge">${label.iconType}</div>` : '';
  const loc = formatMaterialLabelHomeLoc(label.homeLoc);
  const locHtml = loc ? `<div class="req-loc">${e(loc)}</div>` : '';
  const hasIcon = label.iconType ? ' has-icon' : '';
  return `
                    <div class="qr-container${hasIcon}">
                      <div class="qr-section">
                        <img src="${label.qrImage || ''}" class="qr-image" alt="QR Code">
                      </div>
                      <div class="info-section">
                        <div>
                          <div class="info-row material-code material-code-main">${e(f.materialCode)}</div>
                          <div class="info-row">PO: ${e(f.po)}</div>
                          <div class="info-row material-code">${e(qtyLine)}</div>
                          <div class="info-row">IMD: ${e(f.imd)}</div>
                          ${unitRow}
                          ${typeRowHtml(label.labelType || '')}
                        </div>
                      </div>
                      ${iconHtml}
                      ${locHtml}
                    </div>
                  `;
}

const MATERIAL_QR_LABEL_CSS = `
  * { margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; }
  body {
    font-family: Arial, sans-serif;
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
    overflow: hidden !important;
    width: 57mm !important;
    height: 32mm !important;
  }
  .qr-container {
    display: flex !important;
    position: relative !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 1px solid #000 !important;
    width: 57mm !important;
    height: 32mm !important;
    page-break-inside: avoid !important;
    background: white !important;
    box-sizing: border-box !important;
  }
  .qr-section {
    width: 30mm !important;
    height: 30mm !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    border-right: 1px solid #ccc !important;
    box-sizing: border-box !important;
  }
  .qr-image { width: 28mm !important; height: 28mm !important; display: block !important; }
  .info-section {
    flex: 1 !important;
    padding: 1mm !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: space-between !important;
    align-items: flex-start !important;
    font-size: 9.6px !important;
    line-height: 1.15 !important;
    box-sizing: border-box !important;
    color: #000000 !important;
    text-align: left !important;
  }
  .info-row {
    margin: 0.8mm 0 !important;
    font-weight: bold !important;
    color: #000000 !important;
    text-align: left !important;
    display: block !important;
    white-space: nowrap !important;
    font-family: Arial, sans-serif !important;
    letter-spacing: 0 !important;
  }
  .info-row.material-code { font-size: 17.7408px !important; line-height: 1.05 !important; font-weight: bold !important; }
  .info-row.material-code.material-code-main { font-size: 21.356368px !important; line-height: 1.05 !important; font-weight: bold !important; }
  .info-row.info-row-type {
    font-size: 11px !important;
    font-weight: 800 !important;
    margin: 0.15mm 0 0 0 !important;
    line-height: 1.05 !important;
    letter-spacing: 0.2px !important;
  }
  .icon-badge {
    position: absolute !important;
    bottom: 1mm !important;
    right: 1mm !important;
    width: 6mm !important;
    height: 6mm !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: #000000 !important;
    color: #FFFFFF !important;
    border-radius: 2mm !important;
    font-size: 10px !important;
    font-weight: 700 !important;
    font-family: Arial, sans-serif !important;
    z-index: 10 !important;
  }
  .req-loc {
    position: absolute !important;
    right: 0.8mm !important;
    bottom: 0.5mm !important;
    font-size: 7px !important;
    font-weight: 800 !important;
    font-family: Arial, sans-serif !important;
    color: #000000 !important;
    line-height: 1 !important;
    text-align: right !important;
    max-width: 22mm !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    z-index: 8 !important;
  }
  .qr-container.has-icon .req-loc { right: 7.4mm !important; }
  .qr-container.qr-container--lsx { align-items: center !important; justify-content: center !important; }
  .lsx-header-text {
    font-size: 18px !important;
    font-weight: bold !important;
    text-align: center !important;
    padding: 2mm !important;
    word-break: break-all !important;
    line-height: 1.15 !important;
    color: #000000 !important;
    font-family: Arial, sans-serif !important;
  }
  .qr-grid {
    text-align: left !important;
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    align-items: flex-start !important;
    justify-content: flex-start !important;
    gap: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    width: 57mm !important;
    height: 32mm !important;
  }
  @media print {
    body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: 57mm !important; height: 32mm !important; }
    @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; }
    .info-section { justify-content: flex-start !important; }
  }
`;

/** Trang in đầy đủ (HTML) cho danh sách tem — mỗi tem 1 trang 57×32mm. */
export function buildMaterialQrLabelDocument(labels: MaterialQrLabel[], title = ''): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeMaterialLabelHtml(title)}</title>
    <style>${MATERIAL_QR_LABEL_CSS}</style>
  </head>
  <body>
    <div class="qr-grid">
      ${labels.map((label) => renderMaterialQrLabelHtml(label)).join('')}
    </div>
    <script>
      window.onload = function() {
        document.title = '';
        setTimeout(function() { window.print(); }, 500);
      };
    <\/script>
  </body>
</html>`;
}
