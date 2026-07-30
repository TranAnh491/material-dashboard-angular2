/** Mã hóa tên khách: 2 ký tự đầu + số thứ tự 2 chữ số (vd. GIL → GI01). */

export interface CustomerCodeEntry {
  customer: string;
  prefix: string;
  code: string;
  seq: number;
}

export function normalizeCustomerName(name: string): string {
  return String(name || '').trim();
}

export function getCustomerCodePrefix(customerName: string): string {
  const clean = String(customerName || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (clean.length >= 2) return clean.slice(0, 2);
  if (clean.length === 1) return `${clean}X`;
  return 'XX';
}

function escapePrintHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSingleLabelHtml(entry: CustomerCodeEntry): string {
  const code = escapePrintHtml(entry.code);
  return `
    <div class="kh-label-page">
      <div class="kh-label-box">
        <div class="kh-label-code">${code}</div>
      </div>
    </div>`;
}

const LABEL_PRINT_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: Arial, Helvetica, sans-serif;
    background: #fff;
  }
  .kh-label-page {
    width: 100mm;
    height: 100mm;
    display: flex;
    align-items: center;
    justify-content: center;
    page-break-after: always;
    break-after: page;
    background: #fff;
  }
  .kh-label-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .kh-label-box {
    width: 92mm;
    height: 92mm;
    border: 2px solid #000;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 6mm;
  }
  .kh-label-code {
    font-size: 72pt;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0.06em;
    color: #000;
  }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; }
    @page { size: 100mm 100mm; margin: 0; }
    .kh-label-page { width: 100mm !important; height: 100mm !important; }
  }
`;

/** Mở cửa sổ in tem 100×100mm — chỉ in mã hóa. */
export function printCustomerCodeLabels(entries: CustomerCodeEntry[]): boolean {
  if (!entries.length) return false;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  const labelsHtml = entries.map((e) => buildSingleLabelHtml(e)).join('\n');
  printWindow.document.write(`
    <html>
      <head><title></title><style>${LABEL_PRINT_CSS}</style></head>
      <body>${labelsHtml}
        <script>
          window.onload = function() {
            document.title = '';
            setTimeout(function() { window.print(); }, 300);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
  return true;
}
