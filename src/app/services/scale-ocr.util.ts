import { decodeSevenSegment } from '../pages/nhiet-do/nhiet-do-seven-seg';

/**
 * Đọc số trên màn hình cân từ ảnh chụp (bịch đặt trên cân).
 * Đọc LED/LCD 7 thanh trước; không ra số thì dùng Tesseract (cần mạng lần đầu để tải dữ liệu).
 * Trả về số lớn nhất đọc được (số trọng lượng là số to nhất trên màn hình cân) — người dùng kiểm tra lại.
 */

let ocrWorkerPromise: Promise<any> | null = null;

function getOcrWorker(): Promise<any> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const mod: any = await import('tesseract.js/dist/tesseract.min.js');
      const T: any = mod?.createWorker ? mod : mod?.default;
      const worker = await T.createWorker();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      await worker.setParameters({ tessedit_char_whitelist: '0123456789.,', tessedit_pageseg_mode: '11' });
      return worker;
    })().catch((e) => {
      ocrWorkerPromise = null;
      throw e;
    });
  }
  return ocrWorkerPromise;
}

export async function readScaleNumber(source: HTMLCanvasElement): Promise<{ value: number | null; text: string }> {
  const crop = cropCenter(source, 0.85, 0.85);
  const variants = (['glow', 'dark', 'light'] as const).map((mode) => prepareInk(crop, mode));
  for (const v of variants) {
    const text = decodeSevenSegment(v.ink, v.width, v.height).join('\n');
    const value = pickWeight(text);
    if (value != null) return { value, text };
  }
  try {
    const worker = await getOcrWorker();
    for (const v of variants) {
      const { data } = await worker.recognize(v.canvas);
      const text = String(data?.text || '');
      const value = pickWeight(text);
      if (value != null) return { value, text };
    }
  } catch (e) {
    console.warn('[Cân] OCR dự phòng lỗi:', e);
  }
  return { value: null, text: '' };
}

function pickWeight(text: string): number | null {
  const clean = String(text || '').replace(/,/g, '.');
  const nums = (clean.match(/\d+(?:\.\d+)?/g) || [])
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);
  return nums.length ? Math.max(...nums) : null;
}

function cropCenter(source: HTMLCanvasElement, fw: number, fh: number): HTMLCanvasElement {
  const cw = Math.round(source.width * fw);
  const ch = Math.round(source.height * fh);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d')?.drawImage(source, Math.round((source.width - cw) / 2), Math.round((source.height - ch) / 2), cw, ch, 0, 0, cw, ch);
  return canvas;
}

/**
 * Tách nét số thành ảnh chữ đen nền trắng, làm dày nét để nối các đoạn 7 thanh.
 * glow: màn LED phát sáng màu; dark/light: ngưỡng Otsu trên ảnh xám, lấy phần tối hoặc sáng làm nét.
 */
function prepareInk(
  source: HTMLCanvasElement,
  mode: 'glow' | 'dark' | 'light'
): { canvas: HTMLCanvasElement; ink: Uint8Array; width: number; height: number } {
  const targetW = Math.min(1400, Math.max(600, source.width));
  const scale = targetW / source.width;
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas: source, ink: new Uint8Array(0), width: 0, height: 0 };
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const total = w * h;
  const otsu = (values: Uint8Array): number => {
    const hist = new Array<number>(256).fill(0);
    for (let j = 0; j < total; j++) hist[values[j]]++;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let maxVar = -1;
    let threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > maxVar) {
        maxVar = v;
        threshold = t;
      }
    }
    return threshold;
  };

  let ink = new Uint8Array(total);
  if (mode === 'glow') {
    const sat = new Uint8Array(total);
    const bright = new Uint8Array(total);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const max = Math.max(px[i], px[i + 1], px[i + 2]);
      sat[j] = max - Math.min(px[i], px[i + 1], px[i + 2]);
      bright[j] = max;
    }
    const threshold = Math.max(70, otsu(sat));
    for (let j = 0; j < total; j++) ink[j] = sat[j] >= threshold && bright[j] >= 110 ? 1 : 0;
  } else {
    const gray = new Uint8Array(total);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      gray[j] = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
    }
    const threshold = otsu(gray);
    let inkCount = 0;
    for (let j = 0; j < total; j++) {
      ink[j] = gray[j] <= threshold ? 1 : 0;
      inkCount += ink[j];
    }
    const mostlyDark = inkCount > total / 2;
    if (mostlyDark !== (mode === 'light')) {
      for (let j = 0; j < total; j++) ink[j] = ink[j] ? 0 : 1;
    }
  }

  const radius = Math.max(1, Math.round(w / (mode === 'glow' ? 300 : 500)));
  const grown = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) grown[yy * w + xx] = 1;
        }
      }
    }
  }
  ink = grown;

  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = ink[j] ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, ink, width: w, height: h };
}
