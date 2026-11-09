/**
 * Đọc số LCD 7 thanh từ ảnh nhị phân (1 = nét chữ).
 * Trả về các số theo thứ tự đọc (trên xuống, trái sang phải), mỗi số một dòng.
 */

const SEGMENT_DIGITS: Record<string, string> = {
  abcdef: '0',
  bc: '1',
  abdeg: '2',
  abcdg: '3',
  bcfg: '4',
  acdfg: '5',
  acdefg: '6',
  abc: '7',
  abcf: '7',
  abcdefg: '8',
  abcdfg: '9',
  abcfg: '9'
};

const SEGMENT_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Đọc theo khối nét liền (chịu được ảnh nghiêng, chữ "Temp"/"Hum", số 1 mảnh dính dấu chấm);
 * không ra đủ 2 số thì dùng cách cũ chiếu theo hàng ngang.
 */
export function decodeSevenSegment(source: Uint8Array, w: number, h: number): string[] {
  const byComponents = decodeByComponents(source, w, h);
  if (byComponents.length >= 2) return byComponents;
  const byRows = decodeByRowProjection(source, w, h);
  return byRows.length > byComponents.length ? byRows : byComponents;
}

interface Comp extends Box {
  id: number;
  count: number;
}

interface Glyph extends Box {
  ids: number[];
}

function decodeByComponents(source: Uint8Array, w: number, h: number): string[] {
  const ink = clearBorderInk(source, w, h);
  const { labels, comps } = labelComponents(ink, w, h);
  if (!comps.length) return [];

  // Thanh trên / dưới của một chữ số có thể tách rời (khe ở giữa số 1, 7): gộp khối chồng cột.
  const glyphs = mergeStacked(comps);
  const H = Math.max(...glyphs.map(g => g.y1 - g.y0 + 1));
  if (H < Math.max(12, h * 0.04)) return [];
  const digits = glyphs.filter(g => {
    const gh = g.y1 - g.y0 + 1;
    const gw = g.x1 - g.x0 + 1;
    return gh >= H * 0.6 && gw <= H * 1.1;
  });
  if (!digits.length) return [];
  const dotsAll = comps.filter(c => {
    const ch = c.y1 - c.y0 + 1;
    const cw = c.x1 - c.x0 + 1;
    return ch <= H * 0.3 && cw <= H * 0.35 && ch >= H * 0.04;
  });

  // Gom chữ số thành dòng theo tâm (ảnh nghiêng vài độ vẫn tách đúng 2 dòng).
  const rows: Glyph[][] = [];
  for (const g of [...digits].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) {
    const yc = (g.y0 + g.y1) / 2;
    const row = rows.find(r => Math.abs(yc - r.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / r.length) < H * 0.5);
    if (row) row.push(g);
    else rows.push([g]);
  }
  rows.sort((a, b) => Math.min(...a.map(g => g.y0)) - Math.min(...b.map(g => g.y0)));

  const numbers: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    // Tách thành các số: khoảng trống lớn hơn ~1 chiều cao chữ số
    const groups: Glyph[][] = [];
    for (const g of row) {
      const cur = groups[groups.length - 1];
      if (cur && g.x0 - cur[cur.length - 1].x1 <= H * 0.9) cur.push(g);
      else groups.push([g]);
    }
    for (const group of groups) {
      const text = readGlyphGroup(labels, w, H, group, dotsAll);
      if (text.replace(/\D/g, '').length >= 2) numbers.push(text);
    }
  }
  return numbers;
}

/** Đánh nhãn khối nét liền (8 hướng). */
function labelComponents(ink: Uint8Array, w: number, h: number): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(w * h);
  const comps: Comp[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || labels[start]) continue;
    next++;
    const c: Comp = { id: next, x0: w, x1: -1, y0: h, y1: -1, count: 0 };
    labels[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w;
      const y = (i - x) / w;
      c.count++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (ink[j] && !labels[j]) {
            labels[j] = next;
            stack.push(j);
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/**
 * Gộp các khối chồng lên nhau theo cột (cùng một chữ số bị đứt ở giữa).
 * Chỉ gộp 2 mảnh đều thấp hơn một chữ số đủ, và tổng cao không quá một chữ số —
 * để không gộp nhầm chữ số dòng trên với chữ số dòng dưới.
 */
function mergeStacked(comps: Comp[]): Glyph[] {
  const glyphs: Glyph[] = comps.map(c => ({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, ids: [c.id] }));
  const full = Math.max(...comps.map(c => c.y1 - c.y0 + 1));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < glyphs.length && !changed; i++) {
      for (let j = i + 1; j < glyphs.length && !changed; j++) {
        const a = glyphs[i];
        const b = glyphs[j];
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
        const narrow = Math.min(a.x1 - a.x0 + 1, b.x1 - b.x0 + 1);
        const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1;
        const tall = Math.max(a.y1 - a.y0 + 1, b.y1 - b.y0 + 1);
        const combined = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1;
        const pieces = tall < full * 0.8 && combined <= full * 1.15;
        if (pieces && overlap >= narrow * 0.5 && gap <= tall * 0.35) {
          glyphs[i] = {
            x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1),
            y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1),
            ids: a.ids.concat(b.ids)
          };
          glyphs.splice(j, 1);
          changed = true;
        }
      }
    }
  }
  return glyphs;
}

/** Đọc một số: thử các độ nghiêng chữ, chọn độ nghiêng khớp mẫu 7 thanh nhiều nhất. */
function readGlyphGroup(labels: Int32Array, w: number, H: number, group: Glyph[], dots: Comp[]): string {
  // Số 1 xét sau khi dựng thẳng (ảnh nghiêng làm khung số 1 rộng ra ở độ nghiêng 0)
  const ones = group.map(g => glyphIsOne(labels, w, g));
  let best: { parts: string[]; score: number; s: number } | null = null;
  for (let s = -0.3; s <= 0.301; s += 0.05) {
    const parts: string[] = [];
    let score = 0;
    for (const [i, g] of group.entries()) {
      const r = ones[i] ? { text: '1', exact: true } : readGlyph(labels, w, H, g, s);
      parts.push(r.text);
      score += r.exact ? 2 : r.text ? -1 : -3;
    }
    const shear = Math.abs(s) < 0.001 ? 0 : s;
    if (!best || score > best.score || (score === best.score && Math.abs(shear) < Math.abs(best.s))) {
      best = { parts, score, s: shear };
    }
  }
  if (!best) return '';
  // Dấu chấm rời nằm giữa 2 chữ số, sát chân dòng
  let text = '';
  group.forEach((g, i) => {
    text += best!.parts[i];
    const nextG = group[i + 1];
    if (!nextG || text.includes('.')) return;
    // Dấu chấm rời: nằm giữa 2 chữ số theo chiều ngang, ở 1/3 dưới của dòng (tính theo 2 chữ số kề, chịu ảnh nghiêng)
    const top = (g.y0 + nextG.y0) / 2;
    const bottom = (g.y1 + nextG.y1) / 2;
    const hasDot = glyphHasFusedDot(labels, w, g) || dots.some(d => {
      const cx = (d.x0 + d.x1) / 2;
      const cy = (d.y0 + d.y1) / 2;
      return cx > (g.x0 + g.x1) / 2 && cx < nextG.x0 + (nextG.x1 - nextG.x0) * 0.25
        && cy >= top + (bottom - top) * 0.65 && d.y1 <= bottom + H * 0.15;
    });
    if (hasDot) text += '.';
  });
  return text.replace(/\.(?=.*\.)/g, '').replace(/^\./, '').replace(/\.$/, '');
}

/** Vẽ riêng các khối của chữ số (bỏ nét của chữ số bên cạnh), nghiêng theo s. */
function renderGlyph(labels: Int32Array, w: number, g: Glyph, s: number): { local: Uint8Array; gw: number; gh: number; box: Box | null } {
  const gh = g.y1 - g.y0 + 1;
  const extra = Math.ceil(Math.abs(s) * gh) + 2;
  const offset = s < 0 ? Math.ceil(-s * gh) : 0;
  const gw = g.x1 - g.x0 + 1 + extra;
  const local = new Uint8Array(gw * gh);
  const ids = new Set(g.ids);
  for (let y = g.y0; y <= g.y1; y++) {
    const dx = Math.round(s * (g.y1 - y)) + offset;
    for (let x = g.x0; x <= g.x1; x++) {
      if (ids.has(labels[y * w + x])) local[(y - g.y0) * gw + (x - g.x0) + dx] = 1;
    }
  }
  // Khung thật sau khi nghiêng
  let x0 = gw;
  let x1 = -1;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (local[y * gw + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  return { local, gw, gh, box: x1 < 0 ? null : { x0, x1, y0: 0, y1: gh - 1 } };
}

/**
 * Dấu chấm dính chân chữ số (hay gặp ở "1."): dựng thẳng chữ rồi xem các cột bên phải
 * có chỉ có mực ở đáy không. Độ nghiêng dựng thẳng = độ nghiêng cho phần trên 75% của chữ
 * hẹp nhất (đo cả khung thì dấu chấm làm khung rộng ra, chọn nhầm độ nghiêng).
 */
function glyphHasFusedDot(labels: Int32Array, w: number, g: Glyph): boolean {
  const best = uprightGlyph(labels, w, g);
  return !!best && trailingDotColumns(best.local, best.gw, best.box, 0.1) > 0;
}

/** Số 1: sau khi dựng thẳng, phần trên 75% (không tính dấu chấm ở chân) chỉ là một nét dọc mảnh. */
function glyphIsOne(labels: Int32Array, w: number, g: Glyph): boolean {
  const best = uprightGlyph(labels, w, g);
  return !!best && best.upperWidth / (g.y1 - g.y0 + 1) < 0.42;
}

/** Dựng thẳng chữ số: độ nghiêng làm phần trên 75% của chữ hẹp nhất. */
function uprightGlyph(labels: Int32Array, w: number, g: Glyph): { local: Uint8Array; gw: number; box: Box; upperWidth: number } | null {
  let best: { local: Uint8Array; gw: number; box: Box; upperWidth: number } | null = null;
  let bestW = Infinity;
  for (let s = -0.3; s <= 0.301; s += 0.05) {
    const r = renderGlyph(labels, w, g, s);
    if (!r.box) continue;
    let ux0 = r.gw;
    let ux1 = -1;
    for (let y = 0; y < Math.round(r.gh * 0.75); y++) {
      for (let x = 0; x < r.gw; x++) {
        if (r.local[y * r.gw + x]) {
          if (x < ux0) ux0 = x;
          if (x > ux1) ux1 = x;
        }
      }
    }
    const bw = ux1 - ux0 + 1;
    if (ux1 >= 0 && bw < bestW - 0.5) {
      bestW = bw;
      best = { local: r.local, gw: r.gw, box: r.box, upperWidth: bw };
    }
  }
  return best;
}

/** Nhận dạng một chữ số đã vẽ riêng ở độ nghiêng s. */
function readGlyph(labels: Int32Array, w: number, H: number, g: Glyph, s: number): { text: string; exact: boolean } {
  const { local, gw, gh, box: found } = renderGlyph(labels, w, g, s);
  if (!found) return { text: '', exact: false };
  let box: Box = found;
  // Dấu chấm dính sát bên phải chữ số (số 1 + dấu chấm hay bị dính)
  const dotCols = trailingDotColumns(local, gw, box, 0.1);
  if (dotCols) box = { ...box, x1: box.x1 - dotCols };
  const bw = box.x1 - box.x0 + 1;
  const dot = dotCols ? '.' : '';
  // Số 1 trên LED 7 thanh chỉ là một nét dọc: rộng/cao ~0,3 (sau khi làm dày nét); số khác ~0,55–0,75
  if (bw / gh < 0.42) return { text: '1' + dot, exact: true };
  const read = readDigit(local, gw, box);
  return { text: read.digit ? read.digit + dot : '', exact: read.exact };
}

function decodeByRowProjection(source: Uint8Array, w: number, h: number): string[] {
  const ink = clearBorderInk(source, w, h);
  const numbers: string[] = [];
  for (const [y0, y1] of rowBands(ink, w, h)) {
    const bandH = y1 - y0 + 1;
    if (bandH < Math.max(12, h * 0.06)) continue;
    let best: { texts: string[]; score: number } | null = null;
    for (const shear of shearCandidates(ink, w, y0, y1)) {
      const line = shearBand(ink, w, y0, y1, shear);
      const texts: string[] = [];
      let score = 0;
      for (const group of glyphGroups(line.ink, line.w, bandH)) {
        const read = decodeGroup(line.ink, line.w, bandH, group);
        if (!read.text) continue;
        texts.push(read.text);
        score += read.exact * 2 - read.digits;
      }
      if (!best || score > best.score) best = { texts, score };
    }
    if (best) numbers.push(...best.texts);
  }
  return numbers;
}

/** Bỏ vùng mực chạm mép ảnh (viền máy, bóng tối ngoài màn hình). */
function clearBorderInk(source: Uint8Array, w: number, h: number): Uint8Array {
  const ink = source.slice();
  const stack: number[] = [];
  const push = (i: number) => {
    if (ink[i]) {
      ink[i] = 0;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return ink;
}

function rowBands(ink: Uint8Array, w: number, h: number): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  const minInk = Math.max(2, Math.round(w * 0.004));
  let start = -1;
  for (let y = 0; y <= h; y++) {
    let count = 0;
    if (y < h) {
      for (let x = 0; x < w; x++) count += ink[y * w + x];
    }
    if (count >= minInk && start < 0) start = y;
    else if (count < minInk && start >= 0) {
      bands.push([start, y - 1]);
      start = -1;
    }
  }
  // Số không có thanh giữa (1, 7) bị khe giữa thanh trên/dưới cắt đôi: gộp lại.
  const maxH = Math.max(0, ...bands.map(b => b[1] - b[0] + 1));
  const merged: Array<[number, number]> = [];
  for (const band of bands) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const prevH = prev[1] - prev[0] + 1;
      const bandH = band[1] - band[0] + 1;
      const gap = band[0] - prev[1] - 1;
      const halves = prevH < maxH * 0.7 && bandH < maxH * 0.7;
      if (halves && gap <= Math.max(3, Math.min(prevH, bandH) * 0.2)) {
        prev[1] = band[1];
        continue;
      }
    }
    merged.push([band[0], band[1]]);
  }
  return merged;
}

/** LCD thường nghiêng: các độ nghiêng cần thử, xếp theo số cột trống giữa chữ số (nhiều trước). */
function shearCandidates(ink: Uint8Array, w: number, y0: number, y1: number): number[] {
  const scored: Array<{ s: number; empty: number }> = [];
  for (let s = -0.3; s <= 0.301; s += 0.05) {
    const cols = new Uint8Array(w + Math.ceil(Math.abs(s) * (y1 - y0 + 1)) + 2);
    const offset = s < 0 ? Math.ceil(-s * (y1 - y0 + 1)) : 0;
    for (let y = y0; y <= y1; y++) {
      const dx = Math.round(s * (y1 - y)) + offset;
      for (let x = 0; x < w; x++) {
        if (ink[y * w + x]) cols[x + dx] = 1;
      }
    }
    let first = cols.indexOf(1);
    let last = cols.lastIndexOf(1);
    let empty = 0;
    for (let x = first; x >= 0 && x <= last; x++) if (!cols[x]) empty++;
    scored.push({ s: Math.abs(s) < 0.001 ? 0 : s, empty });
  }
  scored.sort((a, b) => b.empty - a.empty || Math.abs(a.s) - Math.abs(b.s));
  return scored.map(c => c.s);
}

function shearBand(ink: Uint8Array, w: number, y0: number, y1: number, s: number): { ink: Uint8Array; w: number } {
  const bandH = y1 - y0 + 1;
  const extra = Math.ceil(Math.abs(s) * bandH) + 2;
  const nw = w + extra;
  const offset = s < 0 ? Math.ceil(-s * bandH) : 0;
  const out = new Uint8Array(nw * bandH);
  for (let y = y0; y <= y1; y++) {
    const dx = Math.round(s * (y1 - y)) + offset;
    for (let x = 0; x < w; x++) {
      if (ink[y * w + x]) out[(y - y0) * nw + x + dx] = 1;
    }
  }
  return { ink: out, w: nw };
}

/** Tách cột thành ký tự, gom các ký tự sát nhau thành một số. */
function glyphGroups(ink: Uint8Array, w: number, h: number): Box[][] {
  const boxes: Box[] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    let has = false;
    if (x < w) {
      for (let y = 0; y < h; y++) {
        if (ink[y * w + x]) { has = true; break; }
      }
    }
    if (has && start < 0) start = x;
    else if (!has && start >= 0) {
      let y0 = h;
      let y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let xx = start; xx < x; xx++) {
          if (ink[y * w + xx]) {
            if (y < y0) y0 = y;
            y1 = y;
            break;
          }
        }
      }
      if (y1 >= 0) boxes.push({ x0: start, x1: x - 1, y0, y1 });
      start = -1;
    }
  }
  if (!boxes.length) return [];

  const digitH = Math.max(...boxes.map(b => b.y1 - b.y0 + 1));
  const groups: Box[][] = [];
  let current: Box[] = [];
  for (const b of boxes) {
    const prev = current[current.length - 1];
    if (prev && b.x0 - prev.x1 > digitH * 0.9) {
      groups.push(current);
      current = [];
    }
    current.push(b);
  }
  if (current.length) groups.push(current);
  return groups;
}

function decodeGroup(
  ink: Uint8Array,
  w: number,
  h: number,
  group: Box[]
): { text: string; digits: number; exact: number } {
  const digitH = Math.max(...group.map(b => b.y1 - b.y0 + 1));
  const empty = { text: '', digits: 0, exact: 0 };
  if (digitH < h * 0.5) return empty;
  let text = '';
  let digits = 0;
  let exact = 0;
  group.forEach((b, index) => {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    if (bh >= digitH * 0.7) {
      const dotCols = index < group.length - 1 && !text.includes('.') ? trailingDotColumns(ink, w, b) : 0;
      const box = dotCols ? { ...b, x1: b.x1 - dotCols } : b;
      const boxW = box.x1 - box.x0 + 1;
      const read = boxW / bh < 0.32 ? { digit: '1', exact: true } : readDigit(ink, w, box);
      if (read.digit) {
        text += read.digit;
        digits++;
        if (read.exact) exact++;
        if (dotCols) text += '.';
      }
      return;
    }
    const nearBottom = b.y1 >= h - digitH * 0.2;
    if (bh <= digitH * 0.25 && bw <= digitH * 0.3 && nearBottom && digits > 0 && !text.includes('.')) {
      text += '.';
    } else if (bh <= digitH * 0.25 && bw >= digitH * 0.25 && !digits) {
      text += '-';
    }
  });
  text = text.replace(/\.$/, '');
  return digits >= 2 ? { text, digits, exact } : empty;
}

/** Dấu chấm dính sát chữ số (ảnh nhỏ / LED tràn sáng): số cột cuối chỉ có mực ở đáy. */
function trailingDotColumns(ink: Uint8Array, w: number, b: Box, minRest = 0.35): number {
  const bh = b.y1 - b.y0 + 1;
  const bottom = b.y1 - Math.round(bh * 0.22);
  let cols = 0;
  for (let x = b.x1; x > b.x0; x--) {
    let any = false;
    let high = false;
    for (let y = b.y0; y <= b.y1; y++) {
      if (!ink[y * w + x]) continue;
      any = true;
      if (y < bottom) { high = true; break; }
    }
    if (high) break;
    if (any) cols++;
    else break;
  }
  const minCols = Math.max(2, Math.round(bh * 0.06));
  return cols >= minCols && cols <= bh * 0.3 && b.x1 - cols - b.x0 + 1 >= bh * minRest ? cols : 0;
}

function readDigit(ink: Uint8Array, w: number, b: Box): { digit: string; exact: boolean } {
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const on = (x: number, y: number) => ink[(b.y0 + y) * w + b.x0 + x] === 1;

  const horizontal = (yFrom: number, yTo: number): boolean => {
    const xa = Math.round(bw * 0.3);
    const xb = Math.round(bw * 0.7);
    const ya = Math.round(bh * yFrom);
    const yb = Math.max(ya, Math.round(bh * yTo) - 1);
    let hit = 0;
    for (let x = xa; x <= xb; x++) {
      for (let y = ya; y <= yb; y++) {
        if (on(x, y)) { hit++; break; }
      }
    }
    return hit >= (xb - xa + 1) * 0.6;
  };

  const vertical = (xFrom: number, xTo: number, yFrom: number, yTo: number): boolean => {
    const xa = Math.round(bw * xFrom);
    const xb = Math.max(xa, Math.round(bw * xTo) - 1);
    const ya = Math.round(bh * yFrom);
    const yb = Math.round(bh * yTo);
    let hit = 0;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        if (on(x, y)) { hit++; break; }
      }
    }
    return hit >= (yb - ya + 1) * 0.6;
  };

  const lit: Record<string, boolean> = {
    a: horizontal(0, 0.18),
    g: horizontal(0.4, 0.6),
    d: horizontal(0.82, 1),
    f: vertical(0, 0.25, 0.18, 0.4),
    b: vertical(0.75, 1, 0.18, 0.4),
    e: vertical(0, 0.25, 0.6, 0.82),
    c: vertical(0.75, 1, 0.6, 0.82)
  };
  const key = SEGMENT_ORDER.filter(s => lit[s]).join('');
  if (SEGMENT_DIGITS[key]) return { digit: SEGMENT_DIGITS[key], exact: true };

  let best = '';
  let bestDist = 2;
  for (const [pattern, digit] of Object.entries(SEGMENT_DIGITS)) {
    let dist = 0;
    for (const s of SEGMENT_ORDER) {
      if (pattern.includes(s) !== !!lit[s]) dist++;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = digit;
    }
  }
  return { digit: best, exact: false };
}
