import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { WorkOrder, WorkOrderStatus } from '../../models/material-lifecycle.model';
import { SafetyService } from '../../services/safety.service';

interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

@Component({
  selector: 'app-assistant',
  templateUrl: './assistant.component.html',
  styleUrls: ['./assistant.component.scss']
})
export class AssistantComponent implements OnInit, OnDestroy {
  @ViewChild('assistantScroll') assistantScroll?: ElementRef<HTMLDivElement>;

  private readonly destroy$ = new Subject<void>();
  private rackRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly rackRefreshMs = 14400000;

  title = 'Assistant';
  assistantSubtitle = 'Trợ lý Kho — hỏi về tồn RM1/RM2, QC, LSX, shipment, rack, IQC staging, Safety…';

  selectedFactory = 'ASM1';
  workOrder = '…';
  yesterdayOverdueCount = 0;
  shipment = '…';
  workOrders: WorkOrder[] = [];
  latestUpdateDate: Date | null = null;

  rackWarnings: Array<{
    position: string;
    usage: number;
    currentLoad: number;
    maxCapacity: number;
    status: 'warning' | 'critical';
  }> = [];
  rackWarningsLoading = false;
  criticalCount = 0;
  warningCount = 0;

  iqcWeekData: Array<{ week: string; count: number }> = [];
  iqcLoading = false;

  messages: AssistantMessage[] = [
    {
      role: 'assistant',
      text: 'Xin chào! Tôi là Trợ lý Kho trên tab Assistant. Hỏi về tồn RM1/RM2, QC, LSX, shipment, rack, IQC, Safety…'
    }
  ];
  inputText = '';
  busy = false;

  khoAsm1DocCount = 0;
  khoAsm1TotalStock = 0;
  khoAsm1NegativeCount = 0;
  khoAsm1StatsLoaded = false;

  khoAsm2DocCount = 0;
  khoAsm2TotalStock = 0;
  khoAsm2NegativeCount = 0;
  khoAsm2StatsLoaded = false;
  khoAsm2Loading = false;

  qcPendingQcIqc = 0;
  qcTodayChecked = 0;
  qcPendingConfirm = 0;
  qcMonthlyPass = 0;
  qcMonthlyNg = 0;
  qcMonthlyLock = 0;
  qcStatsLoaded = false;

  private static readonly QC_WORD_RE = /(^|[^a-z0-9])qc($|[^a-z0-9])/;

  constructor(
    private firestore: AngularFirestore,
    private safetyService: SafetyService,
    private fns: AngularFireFunctions,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const saved = localStorage.getItem('selectedFactory');
    if (saved) {
      this.selectedFactory = saved;
    }

    this.loadSafetyLatest();
    this.loadRackWarnings();
    this.loadKhoAsm2Stats();
    this.loadIQCByWeek();
    this.subscribeWorkOrders();
    this.subscribeShipments();

    this.rackRefreshInterval = setInterval(() => {
      this.loadRackWarnings();
      this.loadKhoAsm2Stats();
    }, this.rackRefreshMs);

    window.addEventListener('factoryChanged', this.onFactoryChanged);
    window.addEventListener('storage', this.onStorage);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.rackRefreshInterval) {
      clearInterval(this.rackRefreshInterval);
    }
    window.removeEventListener('factoryChanged', this.onFactoryChanged);
    window.removeEventListener('storage', this.onStorage);
  }

  private onFactoryChanged = (event: Event): void => {
    const ce = event as CustomEvent;
    this.selectedFactory = ce.detail?.factory ?? 'ASM1';
    this.cdr.detectChanges();
  };

  private onStorage = (event: StorageEvent): void => {
    if (event.key === 'selectedFactory') {
      this.selectedFactory = event.newValue || 'ASM1';
      this.cdr.detectChanges();
    }
  };

  refreshAll(): void {
    this.loadSafetyLatest();
    this.loadRackWarnings();
    this.loadKhoAsm2Stats();
    this.loadIQCByWeek();
  }

  private loadSafetyLatest(): void {
    this.safetyService
      .getSafetyMaterials()
      .pipe(takeUntil(this.destroy$))
      .subscribe(materials => {
        const scanDates = new Set<string>();
        materials.forEach(m => {
          if (m.scanDate && m.scanDate > new Date(0)) {
            scanDates.add(m.scanDate.toDateString());
          }
        });
        const all = Array.from(scanDates).map(s => new Date(s));
        this.latestUpdateDate = all.length ? all.reduce((a, b) => (a > b ? a : b)) : null;
        this.cdr.detectChanges();
      });
  }

  private subscribeWorkOrders(): void {
    this.firestore
      .collection('work-orders')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        const factoryFilter =
          this.selectedFactory === 'ASM1' ? ['ASM1', 'Sample 1'] : ['ASM2', 'Sample 2'];
        const list = actions.map(a => {
          const data = a.payload.doc.data() as any;
          const id = a.payload.doc.id;
          let deliveryDate: Date | null = null;
          if (data.deliveryDate) {
            if (typeof data.deliveryDate === 'object' && data.deliveryDate !== null && 'toDate' in data.deliveryDate) {
              deliveryDate = data.deliveryDate.toDate();
            } else if (data.deliveryDate instanceof Date) {
              deliveryDate = data.deliveryDate;
            } else {
              deliveryDate = new Date(data.deliveryDate);
            }
          }
          return { id, ...data, deliveryDate } as WorkOrder;
        });
        this.workOrders = list.filter(wo => {
          const woFactory = wo.factory || 'ASM1';
          const nf = (woFactory || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
          const targets = factoryFilter.map(f => (f || '').toString().trim().toLowerCase().replace(/\s+/g, ' '));
          return targets.includes(nf);
        });
        this.updateWorkOrderSummary();
        this.yesterdayOverdueCount = this.getYesterdayOverdueCount(new Date());
        this.cdr.detectChanges();
      });
  }

  private isWorkOrderInCurrentMonth(wo: WorkOrder): boolean {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    const y = Number(wo.year);
    const m = Number(wo.month);
    if (Number.isFinite(y) && Number.isFinite(m) && y > 0 && m >= 1 && m <= 12) {
      return y === cy && m === cm;
    }
    if (!wo.deliveryDate) {
      return false;
    }
    let d: Date;
    if (wo.deliveryDate instanceof Date) {
      d = wo.deliveryDate;
    } else if (typeof wo.deliveryDate === 'object' && wo.deliveryDate !== null && 'toDate' in (wo.deliveryDate as any)) {
      d = (wo.deliveryDate as any).toDate();
    } else {
      d = new Date(wo.deliveryDate as any);
    }
    return d.getFullYear() === cy && d.getMonth() + 1 === cm;
  }

  private updateWorkOrderSummary(): void {
    const monthOrders = this.workOrders.filter(wo => this.isWorkOrderInCurrentMonth(wo));
    if (monthOrders.length === 0) {
      this.workOrder = '0';
      return;
    }
    const total = monthOrders.length;
    const done = monthOrders.filter(
      wo => wo.isCompleted || wo.status === WorkOrderStatus.DONE
    ).length;
    this.workOrder = `${done}/${total}`;
  }

  private getYesterdayOverdueCount(today: Date): number {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return this.workOrders.filter(wo => {
      if (!wo.deliveryDate) {
        return false;
      }
      let deliveryDate: Date;
      if (wo.deliveryDate instanceof Date) {
        deliveryDate = wo.deliveryDate;
      } else if (typeof wo.deliveryDate === 'object' && wo.deliveryDate !== null && 'toDate' in wo.deliveryDate) {
        deliveryDate = (wo.deliveryDate as any).toDate();
      } else {
        deliveryDate = new Date(wo.deliveryDate as any);
      }
      const isYesterday = deliveryDate.toDateString() === yesterday.toDateString();
      const isDone = wo.status === WorkOrderStatus.DONE || !!wo.isCompleted;
      return isYesterday && !isDone;
    }).length;
  }

  private subscribeShipments(): void {
    this.firestore
      .collection('shipments')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: actions => {
          const all = actions.map(a => {
            const data = a.payload.doc.data() as any;
            return { ...data, status: data.status || 'Chờ soạn' };
          });
          const groups = new Map<string, any[]>();
          all.forEach(s => {
            const code = String(s.shipmentCode || '').trim().toUpperCase();
            if (!code) {
              return;
            }
            if (!groups.has(code)) {
              groups.set(code, []);
            }
            groups.get(code)!.push(s);
          });
          let completed = 0;
          groups.forEach(items => {
            if (items.every((i: any) => i.status === 'Đã Ship')) {
              completed++;
            }
          });
          this.shipment = `${completed}/${groups.size}`;
          this.cdr.detectChanges();
        },
        error: () => {
          this.shipment = '0/0';
        }
      });
  }

  async loadRackWarnings(): Promise<void> {
    this.rackWarningsLoading = true;
    try {
      const inventorySnapshot = await this.firestore
        .collection('inventory-materials', ref => ref.where('factory', '==', 'ASM1'))
        .get()
        .toPromise();
      const materials = inventorySnapshot.docs.map(d => d.data() as any);
      this.applyAsm1KhoAndQcStats(materials);

      const catalogSnapshot = await this.firestore.collection('materials').get().toPromise();
      const catalogCache = new Map<string, any>();
      catalogSnapshot.docs.forEach(doc => {
        const item = doc.data();
        if (item['materialCode']) {
          const code = item['materialCode'].toString().trim().toUpperCase();
          catalogCache.set(code, { unitWeight: item['unitWeight'] || item['unit_weight'] || 0 });
        }
      });

      const positionMap = new Map<string, { totalWeightKg: number; itemCount: number }>();
      materials.forEach(material => {
        const position = this.normalizePosition(material.location || '');
        if (!position) {
          return;
        }
        const opening =
          material.openingStock !== null && material.openingStock !== undefined ? material.openingStock : 0;
        const stockQty = opening + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
        if (stockQty <= 0) {
          return;
        }
        const materialCode = material.materialCode?.toString().trim().toUpperCase();
        const unitG = catalogCache.get(materialCode)?.unitWeight || 0;
        if (unitG <= 0) {
          return;
        }
        const weightKg = (stockQty * unitG) / 1000;
        if (!positionMap.has(position)) {
          positionMap.set(position, { totalWeightKg: 0, itemCount: 0 });
        }
        const pos = positionMap.get(position)!;
        pos.totalWeightKg += weightKg;
        pos.itemCount++;
      });

      const warnings: typeof this.rackWarnings = [];
      positionMap.forEach((data, position) => {
        const maxCapacity = position.endsWith('1') ? 5000 : 1300;
        const usage = (data.totalWeightKg / maxCapacity) * 100;
        if (usage >= 80) {
          warnings.push({
            position,
            usage,
            currentLoad: data.totalWeightKg,
            maxCapacity,
            status: usage >= 95 ? 'critical' : 'warning'
          });
        }
      });
      warnings.sort((a, b) => b.usage - a.usage);
      this.rackWarnings = warnings;
      this.criticalCount = warnings.filter(w => w.status === 'critical').length;
      this.warningCount = warnings.filter(w => w.status === 'warning').length;
    } catch (e) {
      console.error('Assistant loadRackWarnings', e);
      this.khoAsm1StatsLoaded = false;
      this.qcStatsLoaded = false;
    } finally {
      this.rackWarningsLoading = false;
      this.cdr.detectChanges();
    }
  }

  private normalizePosition(location: string): string {
    if (!location) {
      return '';
    }
    const cleaned = location.replace(/[.,]/g, '').substring(0, 3).toUpperCase();
    return /^[A-G]\d{2}$/.test(cleaned) ? cleaned : '';
  }

  private buildContextSnapshot(): any {
    return {
      factorySelected: this.selectedFactory,
      workOrder: {
        monthProgress: this.workOrder,
        yesterdayOverdueCount: this.yesterdayOverdueCount
      },
      shipment: {
        summary: this.shipment
      },
      kho: {
        asm1: {
          loaded: this.khoAsm1StatsLoaded,
          docCount: this.khoAsm1DocCount,
          totalStockApprox: Math.round(this.khoAsm1TotalStock),
          negativeLineCount: this.khoAsm1NegativeCount
        },
        asm2: {
          loaded: this.khoAsm2StatsLoaded,
          docCount: this.khoAsm2DocCount,
          totalStockApprox: Math.round(this.khoAsm2TotalStock),
          negativeLineCount: this.khoAsm2NegativeCount
        }
      },
      qc: {
        loaded: this.qcStatsLoaded,
        pendingQcAtIqcPrefix: this.qcPendingQcIqc,
        pendingConfirm: this.qcPendingConfirm,
        todayCheckedUser: this.qcTodayChecked,
        monthly: {
          pass: this.qcMonthlyPass,
          ng: this.qcMonthlyNg,
          lock: this.qcMonthlyLock
        }
      },
      rack: {
        loading: this.rackWarningsLoading,
        criticalCount: this.criticalCount,
        warningCount: this.warningCount,
        top: this.rackWarnings.slice(0, 5).map(w => ({
          position: w.position,
          usage: Math.round(w.usage * 10) / 10,
          status: w.status
        }))
      },
      iqc: {
        loading: this.iqcLoading,
        weekCounts: this.iqcWeekData
      },
      safety: {
        latestScanDate: this.latestUpdateDate ? this.latestUpdateDate.toISOString() : null
      }
    };
  }

  async sendMessage(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.busy) {
      return;
    }
    this.inputText = '';
    this.messages.push({ role: 'user', text });
    this.busy = true;
    this.cdr.detectChanges();
    this.scrollToEnd();

    try {
      const context = this.buildContextSnapshot();
      const payload = {
        message: text,
        contextData: {
          ...context,
          chatHistory: this.messages.slice(-12)
        }
      };
      const callable = this.fns.httpsCallable('chatAI');
      const res: any = await firstValueFrom(callable(payload));
      const reply = (res?.content || res?.data?.content || res?.text || res?.data?.text || '').toString().trim();
      this.messages.push({
        role: 'assistant',
        text: reply || 'Mình chưa nhận được phản hồi từ AI. Thử lại giúp mình.'
      });
    } catch (e: any) {
      console.error('assistantChat failed', e);
      const errMsg =
        (e?.details && typeof e.details === 'string' && e.details.trim()) ||
        (e?.message && typeof e.message === 'string' && e.message.trim()) ||
        '';
      const fallback = this.buildReply(text);
      this.messages.push({
        role: 'assistant',
        text:
          `Không gọi được AI cloud (OpenAI). ${errMsg ? `Lỗi: ${errMsg}\n\n` : ''}` +
          'Mình tạm trả lời theo dữ liệu local trên trang.\n\n' +
          fallback
      });
    } finally {
      this.busy = false;
      this.cdr.detectChanges();
      this.scrollToEnd();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.assistantScroll?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  private normalizeChatKey(s: string): string {
    return (s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private buildReply(userText: string): string {
    const q = this.normalizeChatKey(userText);
    if (!q) {
      return 'Bạn gõ nội dung rồi nhấn Gửi nhé.';
    }

    if (/^(hi|hello|hey|chao|xin chao|chào|alo)\b/.test(q) || (q.length < 8 && /chao|hello|hi/.test(q))) {
      return `Chào bạn! Xưởng đang chọn: ${this.selectedFactory}. Hỏi: kho rm1/rm2, qc, lsx, shipment, rack, iqc, safety…`;
    }

    if (q.includes('giup') || q.includes('help') || q.includes('lam gi')) {
      return 'Gợi ý: kho rm1 / asm1 — dòng, tổng tồn, mã âm; kho rm2 / asm2; qc; lsx; shipment; rack; iqc staging; safety.';
    }

    if (this.matchesKhoAsm1Query(q)) {
      return this.replyKhoAsm1();
    }
    if (this.matchesKhoAsm2Query(q)) {
      return this.replyKhoAsm2();
    }
    if (this.matchesQcQuery(q)) {
      return this.replyQcSummary();
    }

    if (q.includes('lsx') || q.includes('work order') || q.includes('lenh san xuat') || q.includes('don hang')) {
      const scope = this.selectedFactory === 'ASM1' ? 'ASM1 + Sample 1' : 'ASM2 + Sample 2';
      return `Work Order (${scope}, tháng hiện tại): ${this.workOrder} (hoàn thành/tổng). LSX giao hôm qua chưa xong: ${this.yesterdayOverdueCount}.`;
    }

    if (q.includes('shipment') || q.includes('xuat hang') || q.includes('van chuyen')) {
      return `Shipment: ${this.shipment} (lô đã ship hết / tổng lô). Chi tiết xem tab Shipment.`;
    }

    if (q.includes('xuong') || q.includes('factory') || (q.includes('asm') && !q.includes('asm1') && !q.includes('asm2'))) {
      return `Đang chọn xưởng: ${this.selectedFactory}. Đổi trên navbar để cập nhật LSX.`;
    }

    if (q.includes('rack') || q.includes('ke hang') || q.includes('utilization')) {
      if (this.rackWarningsLoading) {
        return 'Đang tải rack…';
      }
      if (this.rackWarnings.length === 0) {
        return 'Rack ASM1: không cảnh báo tải (≥80%).';
      }
      return `Rack ASM1: ${this.criticalCount} critical, ${this.warningCount} warning.`;
    }

    if (q.includes('iqc') || q.includes('staging') || q.includes('putaway')) {
      if (this.iqcLoading) {
        return 'Đang tải IQC…';
      }
      const parts = this.iqcWeekData.map(w => `${w.week}: ${w.count}`).join(', ');
      return parts ? `Putaway staging (IQC): ${parts}.` : 'Chưa có dữ liệu tuần IQC.';
    }

    if (q.includes('hom qua') || q.includes('tre') || q.includes('overdue') || q.includes('delay')) {
      return `LSX giao hôm qua chưa xong: ${this.yesterdayOverdueCount}.`;
    }

    if (q.includes('safety') || q.includes('an toan') || q.includes('stock level')) {
      const label = this.latestUpdateDate
        ? `Lần quét gần nhất (Safety): ${this.latestUpdateDate.toLocaleDateString('vi-VN')}.`
        : 'Chưa thấy ngày quét Safety.';
      return `Safety Stock: ${label} Chi tiết lịch xem tab Safety.`;
    }

    return 'Thử: kho rm1, kho rm2, qc, lsx, shipment, rack, iqc, safety, hoặc "giúp".';
  }

  private matchesKhoAsm1Query(q: string): boolean {
    if (q.includes('rm1') || q.includes('asm1') || q.includes('inventory asm1')) {
      if (
        q.includes('kho') ||
        q.includes('ton') ||
        q.includes('dong') ||
        q.includes('bao nhieu') ||
        q.includes('tong') ||
        q.includes('ma am') ||
        q.includes('so ma')
      ) {
        return true;
      }
    }
    if (q.includes('kho') && (q.includes('1') || q.includes('mot'))) {
      return true;
    }
    return (
      (q.includes('tong ton') && (q.includes('asm1') || q.includes('rm1'))) ||
      (q.includes('ma am') && (q.includes('asm1') || q.includes('rm1') || !q.includes('asm2')))
    );
  }

  private matchesKhoAsm2Query(q: string): boolean {
    if (q.includes('rm2') || q.includes('asm2') || q.includes('inventory asm2')) {
      if (
        q.includes('kho') ||
        q.includes('ton') ||
        q.includes('dong') ||
        q.includes('bao nhieu') ||
        q.includes('tong') ||
        q.includes('ma am') ||
        q.includes('so ma')
      ) {
        return true;
      }
    }
    if (q.includes('kho') && q.includes('2')) {
      return true;
    }
    return (q.includes('tong ton') && q.includes('asm2')) || (q.includes('ma am') && q.includes('asm2'));
  }

  private matchesQcQuery(q: string): boolean {
    if (q.includes('iqc')) {
      return false;
    }
    if (AssistantComponent.QC_WORD_RE.test(q)) {
      return true;
    }
    if (q.includes('chat luong') || q.includes('kiem tra chat luong')) {
      return true;
    }
    if (q.includes('cho kiem') || q.includes('cho xac nhan')) {
      return true;
    }
    if (q.includes('hom nay') && (q.includes('kiem') || q.includes('qc'))) {
      return true;
    }
    if (
      (/\bpass\b/.test(q) || /\bng\b/.test(q) || /\block\b/.test(q)) &&
      (q.includes('thang') || q.includes('month'))
    ) {
      return true;
    }
    return false;
  }

  private replyKhoAsm1(): string {
    if (this.rackWarningsLoading && !this.khoAsm1StatsLoaded) {
      return 'Đang tải kho ASM1…';
    }
    if (!this.khoAsm1StatsLoaded) {
      return 'Chưa có số liệu kho ASM1.';
    }
    const neg =
      this.khoAsm1NegativeCount > 0
        ? `${this.khoAsm1NegativeCount} dòng tồn âm.`
        : 'Không có dòng tồn âm.';
    return `Kho RM1 (ASM1): ${this.khoAsm1DocCount} dòng, tổng tồn ~${Math.round(this.khoAsm1TotalStock)}. ${neg}`;
  }

  private replyKhoAsm2(): string {
    if (this.khoAsm2Loading) {
      return 'Đang tải kho ASM2…';
    }
    if (!this.khoAsm2StatsLoaded) {
      return 'Chưa có số liệu kho ASM2.';
    }
    const neg =
      this.khoAsm2NegativeCount > 0 ? `${this.khoAsm2NegativeCount} dòng tồn âm.` : 'Không có dòng tồn âm.';
    return `Kho RM2 (ASM2): ${this.khoAsm2DocCount} dòng, tổng tồn ~${Math.round(this.khoAsm2TotalStock)}. ${neg}`;
  }

  private replyQcSummary(): string {
    if (this.rackWarningsLoading && !this.qcStatsLoaded) {
      return 'Đang tải QC…';
    }
    if (!this.qcStatsLoaded) {
      return 'Chưa có số liệu QC.';
    }
    return (
      `QC ASM1: Chờ kiểm IQC: ${this.qcPendingQcIqc}. Chờ xác nhận: ${this.qcPendingConfirm}. ` +
      `Kiểm có người xác nhận hôm nay: ${this.qcTodayChecked}. Tháng này PASS/NG/LOCK: ${this.qcMonthlyPass} / ${this.qcMonthlyNg} / ${this.qcMonthlyLock}.`
    );
  }

  private calcInventoryLineStock(data: any): number {
    const opening = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
    return opening + (Number(data.quantity) || 0) - (Number(data.exported) || 0) - (Number(data.xt) || 0);
  }

  private normalizeLocationUpper(location: any): string {
    return (location ?? '').toString().trim().toUpperCase();
  }

  private isLocationAtIqcArea(location: any): boolean {
    const loc = this.normalizeLocationUpper(location);
    return loc.length > 0 && loc.startsWith('IQC');
  }

  private isAsm1PendingQcAtIqc(data: any): boolean {
    const status = (data?.iqcStatus ?? '').toString().trim();
    return status === 'CHỜ KIỂM' && this.isLocationAtIqcArea(data?.location);
  }

  private parseFirestoreDateDash(value: any): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (value?.toDate) {
      return value.toDate();
    }
    if (value?.seconds) {
      return new Date(value.seconds * 1000);
    }
    if (typeof value === 'number') {
      return new Date(value);
    }
    if (typeof value === 'string') {
      const p = new Date(value);
      return isNaN(p.getTime()) ? null : p;
    }
    return null;
  }

  private getCurrentMonthRangeDash(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }

  private applyAsm1KhoAndQcStats(materials: any[]): void {
    let totalStock = 0;
    let negativeCount = 0;
    for (const d of materials) {
      const s = this.calcInventoryLineStock(d);
      totalStock += s;
      if (s < 0) {
        negativeCount++;
      }
    }
    this.khoAsm1DocCount = materials.length;
    this.khoAsm1TotalStock = totalStock;
    this.khoAsm1NegativeCount = negativeCount;
    this.khoAsm1StatsLoaded = true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let pendingQc = 0;
    let pendingConfirm = 0;
    for (const d of materials) {
      if (this.isAsm1PendingQcAtIqc(d)) {
        pendingQc++;
      }
      if ((d?.iqcStatus ?? '').toString().trim() === 'CHỜ XÁC NHẬN') {
        pendingConfirm++;
      }
    }
    this.qcPendingQcIqc = pendingQc;
    this.qcPendingConfirm = pendingConfirm;

    let todayChecked = 0;
    for (const d of materials) {
      const qcCheckedAt = this.parseFirestoreDateDash(d.qcCheckedAt);
      const iqcStatus = d.iqcStatus;
      const qcCheckedBy = (d.qcCheckedBy || '').toString();
      const location = this.normalizeLocationUpper(d.location);
      if (!qcCheckedAt || qcCheckedAt < today || qcCheckedAt >= tomorrow) {
        continue;
      }
      const isAutoPass =
        (location === 'F62' || location === 'F62TRA') && iqcStatus === 'Pass' && !qcCheckedBy;
      const hasUserChecked = qcCheckedBy.trim() !== '' && qcCheckedAt;
      if (iqcStatus && iqcStatus !== 'CHỜ KIỂM' && hasUserChecked && !isAutoPass) {
        todayChecked++;
      }
    }
    this.qcTodayChecked = todayChecked;

    const { start, end } = this.getCurrentMonthRangeDash();
    let pass = 0;
    let ng = 0;
    let lock = 0;
    for (const d of materials) {
      const eventTime =
        this.parseFirestoreDateDash(d.qcCheckedAt) || this.parseFirestoreDateDash(d.updatedAt) || null;
      if (!eventTime || eventTime < start || eventTime >= end) {
        continue;
      }
      const statusNorm = (d.iqcStatus || '').toString().trim().toUpperCase();
      const qcCheckedBy = (d.qcCheckedBy || '').toString();
      const loc = (d.location || '').toString().trim().toUpperCase();
      const isAutoPass =
        (loc === 'F62' || loc === 'F62TRA') && statusNorm === 'PASS' && (!qcCheckedBy || qcCheckedBy.trim() === '');
      if (isAutoPass) {
        continue;
      }
      if (statusNorm === 'PASS') {
        pass++;
      } else if (statusNorm === 'NG') {
        ng++;
      } else if (statusNorm === 'LOCK') {
        lock++;
      }
    }
    this.qcMonthlyPass = pass;
    this.qcMonthlyNg = ng;
    this.qcMonthlyLock = lock;
    this.qcStatsLoaded = true;
  }

  async loadKhoAsm2Stats(): Promise<void> {
    this.khoAsm2Loading = true;
    try {
      const snap = await this.firestore
        .collection('inventory-materials', ref => ref.where('factory', '==', 'ASM2'))
        .get()
        .toPromise();
      const rows = (snap?.docs || []).map(doc => doc.data() as any);
      let total = 0;
      let neg = 0;
      for (const d of rows) {
        const s = this.calcInventoryLineStock(d);
        total += s;
        if (s < 0) {
          neg++;
        }
      }
      this.khoAsm2DocCount = rows.length;
      this.khoAsm2TotalStock = total;
      this.khoAsm2NegativeCount = neg;
      this.khoAsm2StatsLoaded = true;
    } catch (e) {
      console.error('loadKhoAsm2Stats', e);
      this.khoAsm2StatsLoaded = false;
    } finally {
      this.khoAsm2Loading = false;
      this.cdr.detectChanges();
    }
  }

  async loadIQCByWeek(): Promise<void> {
    this.iqcLoading = true;
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentWeek = this.getISOWeek(now);
      const weeks: Array<{ week: string; weekNum: number; startDate: Date; endDate: Date }> = [];
      for (let i = 7; i >= 0; i--) {
        let weekNum = currentWeek - i;
        let year = currentYear;
        if (weekNum <= 0) {
          year--;
          const lastWeekOfYear = this.getISOWeek(new Date(year, 11, 31));
          weekNum = lastWeekOfYear + weekNum;
        }
        const weekDate = this.getDateFromISOWeek(year, weekNum);
        weeks.push({
          week: `W${weekNum}`,
          weekNum,
          startDate: this.getStartOfWeek(weekDate),
          endDate: this.getEndOfWeek(weekDate)
        });
      }

      const snapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', 'ASM1').where('location', '==', 'IQC')
        )
        .get()
        .toPromise();

      if (!snapshot || snapshot.empty) {
        this.iqcWeekData = weeks.map(w => ({ week: w.week, count: 0 }));
        return;
      }

      const weekCounts = new Map<string, Set<string>>();
      weeks.forEach(w => weekCounts.set(w.week, new Set()));

      snapshot.forEach(doc => {
        const data = doc.data() as any;
        if ((data.location || '').toUpperCase().trim() !== 'IQC') {
          return;
        }
        const opening =
          data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
        const stock = opening + (Number(data.quantity) || 0) - (Number(data.exported) || 0) - (Number(data.xt) || 0);
        if (stock <= 0) {
          return;
        }
        const iqcStatus = (data.iqcStatus || '').trim();
        if (
          iqcStatus !== 'Chờ kiểm' &&
          iqcStatus !== 'CHỜ KIỂM' &&
          iqcStatus !== 'Chờ kiểm tra' &&
          iqcStatus !== 'CHỜ XÁC NHẬN'
        ) {
          return;
        }
        let materialDate: Date | null = null;
        if (data.importDate) {
          materialDate = data.importDate.toDate?.() ?? new Date(data.importDate);
        }
        if (!materialDate && data.lastUpdated) {
          materialDate = data.lastUpdated.toDate?.() ?? new Date(data.lastUpdated);
        }
        if (!materialDate && data.createdAt) {
          materialDate = data.createdAt.toDate?.() ?? new Date(data.createdAt);
        }
        if (!materialDate) {
          return;
        }
        for (const week of weeks) {
          if (materialDate >= week.startDate && materialDate <= week.endDate) {
            const materialCode = (data.materialCode || '').toUpperCase().trim();
            const poNumber = (data.poNumber || '').trim();
            const batchNumber = (data.batchNumber || '').trim();
            const imd = this.getIMDFromDate(materialDate, batchNumber);
            weekCounts.get(week.week)?.add(`${materialCode}_${poNumber}_${imd}`);
            break;
          }
        }
      });

      this.iqcWeekData = weeks.map(w => ({ week: w.week, count: weekCounts.get(w.week)?.size || 0 }));
    } catch (e) {
      console.error('loadIQCByWeek', e);
      this.iqcWeekData = [];
    } finally {
      this.iqcLoading = false;
      this.cdr.detectChanges();
    }
  }

  private getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  private getDateFromISOWeek(year: number, week: number): Date {
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) {
      ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
      ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    return ISOweekStart;
  }

  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }

  private getEndOfWeek(date: Date): Date {
    const start = this.getStartOfWeek(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  private getIMDFromDate(date: Date, _batchNumber: string): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${day}${month}${year}`;
  }
}
