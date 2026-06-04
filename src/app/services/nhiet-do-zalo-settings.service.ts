import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export type NhietDoZaloFactory = 'ASM1' | 'ASM2';

export interface ZaloLinkRow {
  docId: string;
  memberId: string;
  name: string;
  chatId: string;
}

export interface NhietDoZaloFactorySettings {
  factory: NhietDoZaloFactory;
  memberIds: string[];
  enabled: boolean;
  updatedAt?: Date;
}

@Injectable({ providedIn: 'root' })
export class NhietDoZaloSettingsService {
  private readonly settingsCollection = 'nhiet-do-zalo-settings';

  constructor(private firestore: AngularFirestore) {}

  normalizeMemberId(raw: string): string {
    const t = String(raw || '').trim();
    if (!t) return '';
    const id = t.substring(0, 7).toUpperCase();
    if (id.length === 7 && id.startsWith('ASP') && /^\d{4}$/.test(id.substring(3))) {
      return id;
    }
    return t.toUpperCase();
  }

  async loadZaloLinks(): Promise<ZaloLinkRow[]> {
    const snap = await this.firestore.collection('zalo_links').get().toPromise();
    const rows: ZaloLinkRow[] = [];
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as { memberId?: string; name?: string; chatId?: string };
      const memberId = this.normalizeMemberId(d.memberId || '');
      if (!memberId) return;
      rows.push({
        docId: doc.id,
        memberId,
        name: String(d.name || '').trim() || memberId,
        chatId: String(d.chatId || doc.id).trim()
      });
    });
    rows.sort((a, b) => a.memberId.localeCompare(b.memberId));
    return rows;
  }

  async loadFactorySettings(factory: NhietDoZaloFactory): Promise<NhietDoZaloFactorySettings> {
    const snap = await this.firestore.collection(this.settingsCollection).doc(factory).get().toPromise();
    const d = snap?.data() as { memberIds?: string[]; enabled?: boolean; updatedAt?: unknown } | undefined;
    const memberIds = Array.isArray(d?.memberIds)
      ? [...new Set(d!.memberIds.map(m => this.normalizeMemberId(m)).filter(Boolean))]
      : [];
    return {
      factory,
      memberIds,
      enabled: d?.enabled !== false
    };
  }

  async saveFactorySettings(
    factory: NhietDoZaloFactory,
    memberIds: string[],
    enabled: boolean
  ): Promise<void> {
    const ids = [...new Set(memberIds.map(m => this.normalizeMemberId(m)).filter(Boolean))];
    await this.firestore.collection(this.settingsCollection).doc(factory).set(
      {
        factory,
        memberIds: ids,
        enabled,
        updatedAt: new Date()
      },
      { merge: true }
    );
  }
}
