import { Component, OnDestroy, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type Factory = 'ASM1' | 'ASM2' | 'ALL';

interface ZaloConfig {
  botEnabled: boolean;
  allowSendFromFactories: Factory[];
  notifyOnOutbound: boolean;
  notifyOnInbound: boolean;
  // Không ép user phải nhập secret ở đây; nếu cần có thể dùng Cloud Functions config.
  oaId?: string;
  webhookUrl?: string;
  updatedAt?: any;
  updatedBy?: string;
}

interface ZaloUserLink {
  id?: string;
  employeeId: string; // ASPxxxx
  displayName?: string;
  department?: string;
  factory?: Factory;
  zaloUserId: string; // userId từ Zalo
  zaloDisplayName?: string;
  phone?: string;
  enabled: boolean;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
  updatedBy?: string;
}

interface ZaloOrderRule {
  id?: string;
  /** LSX / lệnh sản xuất */
  lsx: string;
  factory: Factory;
  enabled: boolean;
  /** Danh sách employeeId (ASPxxxx) được phép/được gán cho lệnh */
  memberEmployeeIds: string[];
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
  updatedBy?: string;
}

@Component({
  selector: 'app-zalo',
  templateUrl: './zalo.component.html',
  styleUrls: ['./zalo.component.scss']
})
export class ZaloComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  isLoading = false;
  saveBusy = false;
  saveMessage = '';

  config: ZaloConfig = {
    botEnabled: false,
    allowSendFromFactories: ['ALL'],
    notifyOnOutbound: true,
    notifyOnInbound: false,
    oaId: '',
    webhookUrl: ''
  };

  userLinks: ZaloUserLink[] = [];
  userFilter = '';

  orderRules: ZaloOrderRule[] = [];
  orderFilter = '';
  newOrder: { lsx: string; factory: Factory; enabled: boolean; notes: string } = {
    lsx: '',
    factory: 'ASM1',
    enabled: true,
    notes: ''
  };

  addMemberSelection: { [orderId: string]: string } = {};

  newLink: ZaloUserLink = {
    employeeId: '',
    zaloUserId: '',
    enabled: true,
    factory: 'ALL',
    displayName: '',
    department: '',
    zaloDisplayName: '',
    phone: '',
    notes: ''
  };

  constructor(
    private afs: AngularFirestore,
    private afAuth: AngularFireAuth
  ) {}

  ngOnInit(): void {
    this.loadConfig();
    this.subscribeUserLinks();
    this.subscribeOrderRules();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get filteredLinks(): ZaloUserLink[] {
    const q = (this.userFilter || '').trim().toLowerCase();
    if (!q) return this.userLinks;
    return this.userLinks.filter((u) => {
      const hay = [
        u.employeeId,
        u.displayName,
        u.department,
        u.factory,
        u.zaloUserId,
        u.zaloDisplayName,
        u.phone,
        u.notes
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  get filteredOrders(): ZaloOrderRule[] {
    const q = (this.orderFilter || '').trim().toLowerCase();
    if (!q) return this.orderRules;
    return this.orderRules.filter((o) => {
      const hay = [o.lsx, o.factory, o.enabled ? 'on' : 'off', o.notes, ...(o.memberEmployeeIds || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  private sanitizeLsx(raw: string): string {
    return String(raw ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
  }

  private lsxDocId(lsx: string): string {
    // DocId không được có '/'...
    return this.sanitizeLsx(lsx).replace(/[^A-Z0-9_-]/g, '_').slice(0, 200) || '_';
  }

  private async loadConfig(): Promise<void> {
    this.isLoading = true;
    this.saveMessage = '';
    try {
      const snap = await this.afs.collection('zalo-config').doc('global').get().toPromise();
      const data = snap?.data() as Partial<ZaloConfig> | undefined;
      if (data) {
        this.config = {
          ...this.config,
          ...data,
          botEnabled: !!data.botEnabled,
          notifyOnOutbound: data.notifyOnOutbound !== false,
          notifyOnInbound: !!data.notifyOnInbound,
          allowSendFromFactories:
            Array.isArray(data.allowSendFromFactories) && data.allowSendFromFactories.length
              ? (data.allowSendFromFactories as Factory[])
              : ['ALL'],
          oaId: String(data.oaId ?? ''),
          webhookUrl: String(data.webhookUrl ?? '')
        };
      }
    } catch (e) {
      console.error('❌ Zalo: loadConfig error', e);
      this.saveMessage = 'Không load được cấu hình Zalo (kiểm tra quyền Firestore).';
    } finally {
      this.isLoading = false;
    }
  }

  private subscribeUserLinks(): void {
    this.afs
      .collection('zalo-user-links', (ref) => ref.orderBy('employeeId'))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (snap) => {
          this.userLinks = snap.map((d) => {
            const id = d.payload.doc.id;
            const v = d.payload.doc.data() as any;
            return {
              id,
              employeeId: String(v.employeeId ?? '').trim(),
              displayName: String(v.displayName ?? '').trim(),
              department: String(v.department ?? '').trim(),
              factory: (String(v.factory ?? 'ALL').trim().toUpperCase() as Factory) || 'ALL',
              zaloUserId: String(v.zaloUserId ?? '').trim(),
              zaloDisplayName: String(v.zaloDisplayName ?? '').trim(),
              phone: String(v.phone ?? '').trim(),
              enabled: v.enabled !== false,
              notes: String(v.notes ?? '').trim(),
              createdAt: v.createdAt,
              updatedAt: v.updatedAt,
              updatedBy: String(v.updatedBy ?? '').trim()
            } as ZaloUserLink;
          });
        },
        error: (err) => {
          console.error('❌ Zalo: subscribeUserLinks error', err);
          this.saveMessage = 'Không load được danh sách user Zalo (kiểm tra quyền Firestore).';
        }
      });
  }

  private subscribeOrderRules(): void {
    this.afs
      .collection('zalo-order-rules', (ref) => ref.orderBy('updatedAt', 'desc'))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (snap) => {
          this.orderRules = snap.map((d) => {
            const id = d.payload.doc.id;
            const v = d.payload.doc.data() as any;
            const membersRaw = Array.isArray(v.memberEmployeeIds) ? v.memberEmployeeIds : [];
            const memberEmployeeIds = membersRaw
              .map((x: unknown) => String(x ?? '').trim().toUpperCase())
              .filter((x: string) => !!x);
            return {
              id,
              lsx: String(v.lsx ?? '').trim(),
              factory: (String(v.factory ?? 'ASM1').trim().toUpperCase() as Factory) || 'ASM1',
              enabled: v.enabled !== false,
              memberEmployeeIds,
              notes: String(v.notes ?? '').trim(),
              createdAt: v.createdAt,
              updatedAt: v.updatedAt,
              updatedBy: String(v.updatedBy ?? '').trim()
            } as ZaloOrderRule;
          });
        },
        error: (err) => {
          console.error('❌ Zalo: subscribeOrderRules error', err);
          this.saveMessage = 'Không load được danh sách lệnh (kiểm tra quyền Firestore).';
        }
      });
  }

  async saveConfig(): Promise<void> {
    if (this.saveBusy) return;
    this.saveBusy = true;
    this.saveMessage = '';
    try {
      const userEmail = (await this.afAuth.currentUser)?.email || '';
      const payload: ZaloConfig = {
        botEnabled: !!this.config.botEnabled,
        allowSendFromFactories: Array.isArray(this.config.allowSendFromFactories) && this.config.allowSendFromFactories.length
          ? this.config.allowSendFromFactories
          : ['ALL'],
        notifyOnOutbound: !!this.config.notifyOnOutbound,
        notifyOnInbound: !!this.config.notifyOnInbound,
        oaId: String(this.config.oaId ?? '').trim(),
        webhookUrl: String(this.config.webhookUrl ?? '').trim(),
        updatedAt: new Date(),
        updatedBy: userEmail
      };
      await this.afs.collection('zalo-config').doc('global').set(payload, { merge: true });
      this.saveMessage = '✅ Đã lưu cấu hình Zalo.';
    } catch (e) {
      console.error('❌ Zalo: saveConfig error', e);
      this.saveMessage = '❌ Lỗi lưu cấu hình Zalo.';
    } finally {
      this.saveBusy = false;
    }
  }

  async addOrUpdateOrder(): Promise<void> {
    const lsx = this.sanitizeLsx(this.newOrder.lsx);
    if (!lsx) {
      this.saveMessage = 'Vui lòng nhập LSX/lệnh.';
      return;
    }
    this.saveMessage = '';
    try {
      const userEmail = (await this.afAuth.currentUser)?.email || '';
      const docId = this.lsxDocId(lsx);
      const payload: Partial<ZaloOrderRule> = {
        lsx,
        factory: this.newOrder.factory || 'ASM1',
        enabled: this.newOrder.enabled !== false,
        notes: String(this.newOrder.notes ?? '').trim(),
        updatedAt: new Date(),
        updatedBy: userEmail
      };
      // nếu mới tạo thì set createdAt
      await this.afs.collection('zalo-order-rules').doc(docId).set(
        {
          ...payload,
          createdAt: new Date()
        },
        { merge: true }
      );
      this.newOrder = { lsx: '', factory: 'ASM1', enabled: true, notes: '' };
      this.saveMessage = '✅ Đã lưu lệnh.';
    } catch (e) {
      console.error('❌ Zalo: addOrUpdateOrder error', e);
      this.saveMessage = '❌ Lỗi lưu lệnh.';
    }
  }

  getLinkDisplay(employeeId: string): string {
    const e = String(employeeId ?? '').trim().toUpperCase();
    const u = this.userLinks.find((x) => (x.employeeId || '').toUpperCase() === e);
    if (!u) return e;
    const parts = [u.employeeId, u.displayName].filter(Boolean);
    return parts.join(' - ');
  }

  getAvailableMembersForOrder(o: ZaloOrderRule): ZaloUserLink[] {
    const used = new Set((o.memberEmployeeIds || []).map((x) => String(x).trim().toUpperCase()));
    return this.userLinks
      .filter((u) => u.enabled !== false)
      .filter((u) => !used.has(String(u.employeeId || '').trim().toUpperCase()))
      .sort((a, b) => (a.employeeId || '').localeCompare(b.employeeId || '', undefined, { sensitivity: 'base' }));
  }

  async addMemberToOrder(order: ZaloOrderRule): Promise<void> {
    const id = order?.id;
    if (!id) return;
    const selected = String(this.addMemberSelection[id] ?? '').trim().toUpperCase();
    if (!selected) {
      this.saveMessage = 'Chọn người để thêm.';
      return;
    }
    this.saveMessage = '';
    try {
      const userEmail = (await this.afAuth.currentUser)?.email || '';
      const next = Array.from(
        new Set([...(order.memberEmployeeIds || []).map((x) => String(x).trim().toUpperCase()), selected])
      );
      await this.afs.collection('zalo-order-rules').doc(id).set(
        {
          memberEmployeeIds: next,
          updatedAt: new Date(),
          updatedBy: userEmail
        },
        { merge: true }
      );
      this.addMemberSelection[id] = '';
    } catch (e) {
      console.error('❌ Zalo: addMemberToOrder error', e);
      this.saveMessage = '❌ Lỗi thêm người vào lệnh.';
    }
  }

  async removeMemberFromOrder(order: ZaloOrderRule, employeeId: string): Promise<void> {
    const id = order?.id;
    if (!id) return;
    const e = String(employeeId ?? '').trim().toUpperCase();
    this.saveMessage = '';
    try {
      const userEmail = (await this.afAuth.currentUser)?.email || '';
      const next = (order.memberEmployeeIds || []).map((x) => String(x).trim().toUpperCase()).filter((x) => x !== e);
      await this.afs.collection('zalo-order-rules').doc(id).set(
        {
          memberEmployeeIds: next,
          updatedAt: new Date(),
          updatedBy: userEmail
        },
        { merge: true }
      );
    } catch (e2) {
      console.error('❌ Zalo: removeMemberFromOrder error', e2);
      this.saveMessage = '❌ Lỗi xóa người khỏi lệnh.';
    }
  }

  async toggleOrderEnabled(order: ZaloOrderRule): Promise<void> {
    const id = order?.id;
    if (!id) return;
    try {
      const userEmail = (await this.afAuth.currentUser)?.email || '';
      await this.afs.collection('zalo-order-rules').doc(id).set(
        { enabled: !order.enabled, updatedAt: new Date(), updatedBy: userEmail },
        { merge: true }
      );
    } catch (e) {
      console.error('❌ Zalo: toggleOrderEnabled error', e);
      this.saveMessage = '❌ Lỗi cập nhật enabled của lệnh.';
    }
  }

  async deleteOrder(order: ZaloOrderRule): Promise<void> {
    const id = order?.id;
    if (!id) return;
    const ok = confirm(`Xóa lệnh "${order.lsx}"?`);
    if (!ok) return;
    try {
      await this.afs.collection('zalo-order-rules').doc(id).delete();
      this.saveMessage = '✅ Đã xóa lệnh.';
    } catch (e) {
      console.error('❌ Zalo: deleteOrder error', e);
      this.saveMessage = '❌ Lỗi xóa lệnh.';
    }
  }

  async addUserLink(): Promise<void> {
    const employeeId = String(this.newLink.employeeId ?? '').trim().toUpperCase();
    const zaloUserId = String(this.newLink.zaloUserId ?? '').trim();
    if (!employeeId || !zaloUserId) {
      this.saveMessage = 'Vui lòng nhập Employee ID và Zalo User ID.';
      return;
    }
    this.saveMessage = '';
    try {
      const userEmail = (await this.afAuth.currentUser)?.email || '';
      const payload: ZaloUserLink = {
        employeeId,
        zaloUserId,
        enabled: this.newLink.enabled !== false,
        factory: (String(this.newLink.factory ?? 'ALL').toUpperCase() as Factory) || 'ALL',
        displayName: String(this.newLink.displayName ?? '').trim(),
        department: String(this.newLink.department ?? '').trim(),
        zaloDisplayName: String(this.newLink.zaloDisplayName ?? '').trim(),
        phone: String(this.newLink.phone ?? '').trim(),
        notes: String(this.newLink.notes ?? '').trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userEmail
      };
      // docId theo employeeId để dễ quản lý và không trùng
      await this.afs.collection('zalo-user-links').doc(employeeId).set(payload, { merge: true });
      this.newLink = { employeeId: '', zaloUserId: '', enabled: true, factory: 'ALL', displayName: '', department: '', zaloDisplayName: '', phone: '', notes: '' };
      this.saveMessage = '✅ Đã thêm/cập nhật user Zalo.';
    } catch (e) {
      console.error('❌ Zalo: addUserLink error', e);
      this.saveMessage = '❌ Lỗi thêm user Zalo.';
    }
  }

  async toggleEnabled(u: ZaloUserLink): Promise<void> {
    if (!u?.id) return;
    try {
      const userEmail = (await this.afAuth.currentUser)?.email || '';
      await this.afs.collection('zalo-user-links').doc(u.id).set(
        { enabled: !u.enabled, updatedAt: new Date(), updatedBy: userEmail },
        { merge: true }
      );
    } catch (e) {
      console.error('❌ Zalo: toggleEnabled error', e);
      this.saveMessage = '❌ Lỗi cập nhật enabled.';
    }
  }

  async deleteLink(u: ZaloUserLink): Promise<void> {
    if (!u?.id) return;
    const ok = confirm(`Xóa liên kết Zalo của ${u.employeeId}?`);
    if (!ok) return;
    try {
      await this.afs.collection('zalo-user-links').doc(u.id).delete();
      this.saveMessage = '✅ Đã xóa user Zalo.';
    } catch (e) {
      console.error('❌ Zalo: deleteLink error', e);
      this.saveMessage = '❌ Lỗi xóa user Zalo.';
    }
  }
}

