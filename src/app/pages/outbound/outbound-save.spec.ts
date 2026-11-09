/**
 * Kiểm tra luồng lưu xuất kho / FG / Inbound trên Firestore giả lập trong bộ nhớ
 * (không cần đăng nhập, không đụng dữ liệu thật).
 * Chạy:  npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/pages/outbound/outbound-save.spec.ts
 */
import { OutboundComponent } from './outbound.component';
import { FgOutComponent } from '../fg-out/fg-out.component';
import { InboundComponent } from '../inbound/inbound.component';

// ---------- Firestore giả lập ----------
type Doc = Record<string, any>;

function incOperand(v: any): number | null {
  const d = v?._delegate ?? v;
  if (!d || typeof d !== 'object' || d._methodName !== 'FieldValue.increment') return null;
  // Tên thuộc tính chứa số cộng dồn bị nén (vd `Ia`) → lấy thuộc tính số duy nhất
  if (typeof d._operand === 'number') return d._operand;
  const nums = Object.keys(d).map((k) => d[k]).filter((x) => typeof x === 'number');
  return nums.length === 1 ? nums[0] : null;
}

class FakeDb {
  store = new Map<string, Map<string, Doc>>();
  failReads = false;
  failCommitsFrom = Infinity; // số thứ tự commit (1-based) bắt đầu lỗi
  commits = 0;
  private seq = 0;

  col(name: string): Map<string, Doc> {
    if (!this.store.has(name)) this.store.set(name, new Map());
    return this.store.get(name)!;
  }

  put(col: string, id: string, data: Doc): void {
    this.col(col).set(id, { ...data });
  }

  snapDoc(col: string, id: string) {
    const data = this.col(col).get(id);
    return { id, exists: !!data, ref: this.ref(col, id), data: () => (data ? { ...data } : undefined) };
  }

  ref(col: string, id?: string) {
    const docId = id || `auto_${++this.seq}`;
    return { id: docId, _col: col, path: `${col}/${docId}` };
  }

  collection(name: string) {
    const db = this;
    const filters: Array<[string, any]> = [];
    const q: any = {
      where(field: string, _op: string, value: any) { filters.push([field, value]); return q; },
      limit() { return q; },
      doc(id?: string) { return db.ref(name, id); },
      async get() {
        if (db.failReads) throw new Error('network');
        const docs = [...db.col(name).entries()]
          .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
          .map(([id]) => db.snapDoc(name, id));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
      async add(data: Doc) { const r = db.ref(name); db.put(name, r.id, data); return r; }
    };
    return q;
  }

  private apply(col: string, id: string, data: Doc, merge: boolean): void {
    const cur = merge ? { ...(this.col(col).get(id) || {}) } : {};
    for (const [k, v] of Object.entries(data)) {
      const inc = incOperand(v);
      cur[k] = inc !== null ? (Number(cur[k]) || 0) + inc : v;
    }
    this.col(col).set(id, cur);
  }

  batch() {
    const ops: Array<() => void> = [];
    const db = this;
    return {
      set(ref: any, data: Doc) { ops.push(() => db.apply(ref._col, ref.id, data, false)); },
      update(ref: any, data: Doc) {
        ops.push(() => {
          if (!db.col(ref._col).has(ref.id)) throw new Error(`update missing ${ref.path}`);
          db.apply(ref._col, ref.id, data, true);
        });
      },
      delete(ref: any) { ops.push(() => db.col(ref._col).delete(ref.id)); },
      async commit() {
        db.commits++;
        if (db.commits >= db.failCommitsFrom) throw new Error('commit failed');
        ops.forEach((op) => op());
      }
    };
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const db = this;
    const tx = {
      get: async (ref: any) => db.snapDoc(ref._col, ref.id),
      set: (ref: any, data: Doc) => { writes.push(() => db.apply(ref._col, ref.id, data, false)); },
      update: (ref: any, data: Doc) => { writes.push(() => db.apply(ref._col, ref.id, data, true)); }
    };
    const r = await fn(tx);
    writes.forEach((w) => w());
    return r;
  }
}

// ---------- Outbound ----------
function makeOutbound(db: FakeDb): any {
  const c: any = Object.create(OutboundComponent.prototype);
  c.firestore = { firestore: db };
  c.selectedFactory = 'ASM1';
  c.batchEmployeeId = 'ASP0001';
  c.batchProductionOrder = 'KZLSX1126/0001';
  c.pendingScanData = [];
  c.calls = { lsxLog: 0, locks: 0, sync: 0 };
  c.rmBagHistory = {
    parseQrPart4: (p4: string) => {
      const s = String(p4 || '');
      const m = /^(\d{8})(?:-(\d+)\/(\d+))?/.exec(s);
      return { imdKey: m ? m[1] : '', bagDelta: m && m[2] ? 1 : 0, bagFractionLabel: m && m[2] ? `${m[2]}/${m[3]}` : '', bagNumberDisplay: '' };
    },
    extractBagLabelFromQrPart4: () => '',
    log: async () => undefined
  };
  c.leExportQty = () => 0;
  c.savePendingToStorage = () => undefined;
  c.markTemLeClExported = () => undefined;
  c.writeLsxLog = () => { c.calls.lsxLog++; };
  c.markScanLocksSaved = () => { c.calls.locks++; };
  c.syncWorkOrderCreatedByFor = () => { c.calls.sync++; };
  c.logBagHistoryAfterExport = async () => undefined;
  return c;
}

function tem(code: string, po: string, qty: number, part4: string) {
  return {
    materialCode: code, poNumber: po, quantity: qty, scanCount: 1, importDate: part4,
    exportedBagsDelta: /-\d+\/\d+/.test(part4) ? 1 : 0, bagBatch: '', bagNumberDisplay: '', location: 'N/A',
    productionOrder: 'KZLSX1126/0001', employeeId: 'ASP0001', scanTime: new Date('2026-11-07T08:00:00')
  };
}

function seedInv(db: FakeDb) {
  db.put('inventory-materials', 'L1', { factory: 'ASM1', materialCode: 'B009001', poNumber: 'PO1', importDate: '01102026', batchNumber: '01102026', openingStock: 0, quantity: 100, exported: 0, xt: 0, totalBags: 4, exportedBags: 0 });
  db.put('inventory-materials', 'L2', { factory: 'ASM1', materialCode: 'B009001', poNumber: 'PO1', importDate: '15102026', batchNumber: '15102026', openingStock: 0, quantity: 50, exported: 10, xt: 0, totalBags: 2, exportedBags: 0 });
}

describe('Outbound — lưu phiếu xuất + trừ tồn cùng 1 batch', () => {
  it('nhiều tem cùng lô / khác lô: trừ tồn đúng từng dòng, phiếu xuất đúng, bỏ tem khỏi danh sách chờ', async () => {
    const db = new FakeDb(); seedInv(db);
    const c = makeOutbound(db);
    c.pendingScanData = [tem('B009001', 'PO1', 25, '01102026-1/4'), tem('B009001', 'PO1', 25, '01102026-2/4'), tem('B009001', 'PO1', 20, '15102026-1/2')];
    await c.batchUpdateAllScanData();
    expect(db.col('inventory-materials').get('L1')!.exported).toBe(50);
    expect(db.col('inventory-materials').get('L1')!.exportedBags).toBe(2);
    expect(db.col('inventory-materials').get('L2')!.exported).toBe(30);
    const recs = [...db.col('outbound-materials').values()];
    expect(recs.length).toBe(3);
    expect(recs.reduce((s, r) => s + r.quantity, 0)).toBe(70);
    expect(c.pendingScanData.length).toBe(0);
    expect(db.commits).toBe(1);
  });

  it('tem trùng đủ 6 trường (vd số lẻ của lô gộp vào tem): phiếu xuất CỘNG lượng, tồn trừ đủ', async () => {
    const db = new FakeDb(); seedInv(db);
    const c = makeOutbound(db);
    c.pendingScanData = [tem('B009001', 'PO1', 30, '01102026'), { ...tem('B009001', 'PO1', 0.25, '01102026'), crumbOnly: true }];
    await c.batchUpdateAllScanData();
    const recs = [...db.col('outbound-materials').values()];
    expect(recs.length).toBe(1);
    expect(recs[0].quantity).toBe(30.25);
    expect(db.col('inventory-materials').get('L1')!.exported).toBe(30.25);
  });

  it('lỗi mạng khi đọc tồn: không ghi gì, giữ nguyên tem', async () => {
    const db = new FakeDb(); seedInv(db); db.failReads = true;
    const c = makeOutbound(db);
    c.pendingScanData = [tem('B009001', 'PO1', 25, '01102026-1/4')];
    await expectAsync(c.batchUpdateAllScanData()).toBeRejected();
    expect(db.col('outbound-materials').size).toBe(0);
    expect(db.col('inventory-materials').get('L1')!.exported).toBe(0);
    expect(c.pendingScanData.length).toBe(1);
  });

  it('mã không có trong tồn: không ghi gì (kể cả các tem khác trong cùng lần lưu)', async () => {
    const db = new FakeDb(); seedInv(db);
    const c = makeOutbound(db);
    c.pendingScanData = [tem('B009001', 'PO1', 25, '01102026-1/4'), tem('B999999', 'PO9', 5, '01102026')];
    await expectAsync(c.batchUpdateAllScanData()).toBeRejected();
    expect(db.col('outbound-materials').size).toBe(0);
    expect(db.col('inventory-materials').get('L1')!.exported).toBe(0);
    expect(c.pendingScanData.length).toBe(2);
  });

  it('ghi (commit) lỗi: không có phiếu xuất, tồn không đổi, giữ nguyên tem', async () => {
    const db = new FakeDb(); seedInv(db); db.failCommitsFrom = 1;
    const c = makeOutbound(db);
    c.pendingScanData = [tem('B009001', 'PO1', 25, '01102026-1/4')];
    await expectAsync(c.batchUpdateAllScanData()).toBeRejected();
    expect(db.col('outbound-materials').size).toBe(0);
    expect(db.col('inventory-materials').get('L1')!.exported).toBe(0);
    expect(c.pendingScanData.length).toBe(1);
  });

  it('việc phụ sau khi lưu bị lỗi: tem vẫn được bỏ khỏi danh sách → bấm lưu lại không trừ tồn lần hai', async () => {
    const db = new FakeDb(); seedInv(db);
    const c = makeOutbound(db);
    c.writeLsxLog = () => { throw new Error('log lỗi'); };
    c.markScanLocksSaved = () => { throw new Error('lock lỗi'); };
    c.pendingScanData = [tem('B009001', 'PO1', 25, '01102026-1/4')];
    await c.batchUpdateAllScanData();
    expect(c.pendingScanData.length).toBe(0);
    await c.batchUpdateAllScanData(); // lưu lại: không còn gì
    expect(db.col('inventory-materials').get('L1')!.exported).toBe(25);
    expect(db.col('outbound-materials').size).toBe(1);
  });

  it('> 150 tem, nhóm thứ 2 ghi lỗi: nhóm 1 đã lưu được bỏ khỏi danh sách, nhóm 2 còn lại; lưu lại không trùng', async () => {
    const db = new FakeDb();
    db.put('inventory-materials', 'BIG', { factory: 'ASM1', materialCode: 'B016001', poNumber: 'PO2', importDate: '01102026', quantity: 10000, exported: 0, totalBags: 200, exportedBags: 0 });
    const c = makeOutbound(db);
    c.pendingScanData = Array.from({ length: 160 }, (_, i) => tem('B016001', 'PO2', 10, `01102026-${i + 1}/200`));
    db.failCommitsFrom = 2;
    await expectAsync(c.batchUpdateAllScanData()).toBeRejected();
    expect(db.col('inventory-materials').get('BIG')!.exported).toBe(1500);
    expect(c.pendingScanData.length).toBe(10);
    db.failCommitsFrom = Infinity;
    await c.batchUpdateAllScanData();
    expect(db.col('inventory-materials').get('BIG')!.exported).toBe(1600);
    expect(c.pendingScanData.length).toBe(0);
  });

  it('tự lưu (pauseSaveBatch): tem quét thêm TRONG LÚC đang lưu không bị xóa', async () => {
    const db = new FakeDb(); seedInv(db);
    const c = makeOutbound(db);
    c.cdr = { detectChanges: () => undefined };
    c.setScanFlash = () => undefined;
    c.playScanBeep = () => undefined;
    c.focusScannerInput = () => undefined;
    c.loadBatchPxkExportedTotals = async () => new Map();
    c.pendingScanData = [tem('B009001', 'PO1', 25, '01102026-1/4')];
    const realBatch = db.batch.bind(db);
    db.batch = () => {
      const b = realBatch();
      const commit = b.commit;
      b.commit = async () => {
        c.pendingScanData = [...c.pendingScanData, tem('B009001', 'PO1', 25, '01102026-2/4')]; // quét thêm khi đang lưu
        return commit();
      };
      return b;
    };
    await c.pauseSaveBatch();
    expect(c.pendingScanData.length).toBe(1);
    expect(c.pendingScanData[0].importDate).toBe('01102026-2/4');
    expect(db.col('inventory-materials').get('L1')!.exported).toBe(25);
  });
});

// ---------- FG ----------
describe('FG Out — trừ tồn + fg-export cùng 1 batch, cộng dồn', () => {
  function makeFg(db: FakeDb): any {
    const c: any = Object.create(FgOutComponent.prototype);
    c.firestore = { firestore: db };
    return c;
  }
  const mat = { materialCode: 'P030105', batchNumber: 'B1', lsx: 'L1', lot: 'T1', quantity: 120, shipment: 'S1', pushNo: '1' } as any;

  it('trừ qua 2 vị trí FIFO + 1 bản ghi fg-export', async () => {
    const db = new FakeDb();
    db.put('fg-inventory', 'A', { materialCode: 'P030105', ton: 100, xuat: 0, exported: 0 });
    db.put('fg-inventory', 'B', { materialCode: 'P030105', ton: 50, xuat: 5, exported: 5 });
    const c = makeFg(db);
    await c.subtractFromInventoryDocs([db.snapDoc('fg-inventory', 'A'), db.snapDoc('fg-inventory', 'B')], 120, mat);
    expect(db.col('fg-inventory').get('A')).toEqual(jasmine.objectContaining({ ton: 0, xuat: 100, exported: 100 }));
    expect(db.col('fg-inventory').get('B')).toEqual(jasmine.objectContaining({ ton: 30, xuat: 25, exported: 25 }));
    expect(db.col('fg-export').size).toBe(1);
  });

  it('dòng cũ dùng `stock` thay `ton`: trừ đúng trường stock, không tạo ton âm', async () => {
    const db = new FakeDb();
    db.put('fg-inventory', 'C', { materialCode: 'P030105', stock: 200, exported: 0 });
    const c = makeFg(db);
    await c.subtractFromInventoryDocs([db.snapDoc('fg-inventory', 'C')], 120, mat);
    const d = db.col('fg-inventory').get('C')!;
    expect(d.stock).toBe(80);
    expect(d.ton).toBeUndefined();
    expect(d.exported).toBe(120);
    expect(d.xuat).toBe(120);
  });

  it('2 máy duyệt xuất cùng lúc từ cùng ảnh dữ liệu cũ: không mất lần trừ nào', async () => {
    const db = new FakeDb();
    db.put('fg-inventory', 'A', { materialCode: 'P030105', ton: 300, xuat: 0, exported: 0 });
    const c = makeFg(db);
    const stale1 = db.snapDoc('fg-inventory', 'A');
    const stale2 = db.snapDoc('fg-inventory', 'A');
    await Promise.all([
      c.subtractFromInventoryDocs([stale1], 100, mat),
      c.subtractFromInventoryDocs([stale2], 100, { ...mat, pushNo: '2' })
    ]);
    expect(db.col('fg-inventory').get('A')).toEqual(jasmine.objectContaining({ ton: 100, xuat: 200, exported: 200 }));
    expect(db.col('fg-export').size).toBe(2);
  });

  it('không đủ tồn qua các vị trí: không ghi gì', async () => {
    const db = new FakeDb();
    db.put('fg-inventory', 'A', { materialCode: 'P030105', ton: 50, xuat: 0, exported: 0 });
    const c = makeFg(db);
    spyOn(window, 'alert').and.stub();
    await c.subtractFromInventoryDocs([db.snapDoc('fg-inventory', 'A')], 120, mat);
    expect(db.col('fg-inventory').get('A')!.ton).toBe(50);
    expect(db.col('fg-export').size).toBe(0);
  });
});

// ---------- Inbound ----------
describe('Inbound — tạo dòng tồn không trùng', () => {
  it('gọi 2 lần (2 máy / bấm lại): chỉ 1 dòng tồn IB_<id>, lần 2 created=false', async () => {
    const db = new FakeDb();
    const c: any = Object.create(InboundComponent.prototype);
    c.firestore = { firestore: db };
    const m = { id: 'INB123', materialCode: 'B009001', poNumber: 'PO1' } as any;
    const r1 = await c.createInventoryRowOnce(m, { materialCode: 'B009001', quantity: 100, exported: 0 });
    const r2 = await c.createInventoryRowOnce(m, { materialCode: 'B009001', quantity: 100, exported: 0 });
    expect(r1.created).toBeTrue();
    expect(r2.created).toBeFalse();
    expect(db.col('inventory-materials').size).toBe(1);
    expect(db.col('inventory-materials').get('IB_INB123')!.inboundDocId).toBe('INB123');
  });
});
