import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export type WoGuideRole = '' | 'chinh' | 'phu';

export interface WoGuideJob {
  id: string;
  label: string;
}

export interface WoGuideStaff {
  id: string;
  name: string;
  team: string;
  roles: Record<string, WoGuideRole>;
}

export interface WoGuideData {
  jobs: WoGuideJob[];
  staff: WoGuideStaff[];
}

@Injectable({ providedIn: 'root' })
export class WoLsxGuideService {
  private readonly docPath = 'wo-settings/lsx-guide';
  private cached: WoGuideData | null = null;

  constructor(private firestore: AngularFirestore) {}

  defaults(): WoGuideData {
    const jobs: WoGuideJob[] = [
      { id: 'nhanNvl', label: 'Nhận NVL' },
      { id: 'soanS', label: 'Soạn NVL Kệ S' },
      { id: 'soanR', label: 'Soạn NVL Kệ R' },
      { id: 'catS', label: 'Cất NVL Kệ S' },
      { id: 'catR', label: 'Cất NVL Kệ R' },
      { id: 'giao', label: 'Giao LSX' }
    ];
    const staff: WoGuideStaff[] = [
      { id: 'dat', name: 'Đạt', team: '', roles: { nhanNvl: 'chinh', catR: 'phu' } },
      { id: 'huong', name: 'Hương', team: '', roles: { soanS: 'chinh', catS: 'phu' } },
      { id: 'linh', name: 'Linh', team: '', roles: { soanR: 'chinh', giao: 'phu' } },
      { id: 'nhan', name: 'Nhân', team: '', roles: { soanR: 'chinh', catR: 'phu' } },
      { id: 'tinh', name: 'Tình', team: '', roles: { soanS: 'chinh', catS: 'phu' } },
      { id: 'tuan', name: 'Tuấn', team: '', roles: { nhanNvl: 'chinh', catR: 'phu' } },
      { id: 'tuan-nho', name: 'Tuấn nhỏ', team: '', roles: { soanR: 'phu', giao: 'chinh' } },
      { id: 'thai', name: 'Thái', team: '', roles: { soanR: 'chinh', giao: 'phu' } },
      { id: 'thanh', name: 'Thanh', team: '', roles: { nhanNvl: 'phu', catR: 'chinh' } },
      { id: 'thuy', name: 'Thủy', team: '', roles: { soanS: 'chinh', catS: 'phu' } }
    ];
    return { jobs, staff };
  }

  newId(): string {
    return this.firestore.createId();
  }

  isLockedJob(jobId: string): boolean {
    return this.defaults().jobs.some((j) => j.id === jobId);
  }

  async load(forceRefresh = false): Promise<WoGuideData> {
    if (!forceRefresh && this.cached) return this.clone(this.cached);
    const snap = await this.firestore.doc(this.docPath).get().toPromise();
    if (!snap?.exists) {
      const data = this.defaults();
      await this.firestore.doc(this.docPath).set({ ...data, updatedAt: new Date() });
      this.cached = data;
      return this.clone(data);
    }
    const raw = snap.data() as Partial<WoGuideData> | undefined;
    const data = this.normalize(raw);
    this.cached = data;
    return this.clone(data);
  }

  async save(data: WoGuideData): Promise<void> {
    const next = this.normalize(data);
    await this.firestore.doc(this.docPath).set({ ...next, updatedAt: new Date() }, { merge: true });
    this.cached = next;
  }

  roleOf(staff: WoGuideStaff, jobId: string): WoGuideRole {
    const role = staff?.roles?.[jobId];
    return role === 'chinh' || role === 'phu' ? role : '';
  }

  nextRole(role: WoGuideRole): WoGuideRole {
    if (role === 'chinh') return 'phu';
    if (role === 'phu') return '';
    return 'chinh';
  }

  private normalize(raw: Partial<WoGuideData> | null | undefined): WoGuideData {
    const fallback = this.defaults();
    const savedJobs = Array.isArray(raw?.jobs) ? raw.jobs : [];
    const savedLabelById = new Map<string, string>();
    for (const j of savedJobs) {
      const id = String(j?.id || '').trim();
      const label = String(j?.label || '').trim();
      if (id && label) savedLabelById.set(id, label);
    }
    const lockedIds = new Set(fallback.jobs.map((j) => j.id));
    const jobs: WoGuideJob[] = fallback.jobs.map((j) => ({
      id: j.id,
      label: savedLabelById.get(j.id) || j.label
    }));
    for (const j of savedJobs) {
      const id = String(j?.id || this.newId());
      const label = String(j?.label || '').trim();
      if (!label || lockedIds.has(id) || jobs.some((x) => x.id === id)) continue;
      jobs.push({ id, label });
    }
    const staff = Array.isArray(raw?.staff)
      ? raw.staff
          .map((s) => {
            const roles: Record<string, WoGuideRole> = {};
            const src = s?.roles && typeof s.roles === 'object' ? s.roles : {};
            for (const job of jobs) {
              const role = src[job.id];
              if (role === 'chinh' || role === 'phu') roles[job.id] = role;
            }
            return {
              id: String(s?.id || this.newId()),
              name: String(s?.name || '').trim(),
              team: String(s?.team || '').trim(),
              roles
            };
          })
          .filter((s) => s.name)
      : fallback.staff;
    return { jobs, staff: staff.length ? staff : fallback.staff };
  }

  private clone(data: WoGuideData): WoGuideData {
    return {
      jobs: data.jobs.map((j) => ({ ...j })),
      staff: data.staff.map((s) => ({
        id: s.id,
        name: s.name,
        team: s.team || '',
        roles: { ...s.roles }
      }))
    };
  }
}
