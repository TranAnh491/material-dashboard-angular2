import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { DEFAULT_WEEK_RULES, WeekRules, getWeekRules, setWeekRules } from '../shared/week-code';

/** Rule Week (hạn dùng tem theo khách) — Firestore `week-rules/config`. Nạp 1 lần / 5 phút. */
@Injectable({ providedIn: 'root' })
export class WeekRulesService {
  private static readonly DOC = 'week-rules/config';
  private loadedAt = 0;
  private loading: Promise<WeekRules> | null = null;

  constructor(private firestore: AngularFirestore) {}

  async ensureLoaded(force = false): Promise<WeekRules> {
    if (!force && this.loadedAt && Date.now() - this.loadedAt < 5 * 60000) return getWeekRules();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const snap = await this.firestore.firestore.doc(WeekRulesService.DOC).get();
        setWeekRules(snap.exists ? (snap.data() as Partial<WeekRules>) : DEFAULT_WEEK_RULES);
        this.loadedAt = Date.now();
      } catch (e) {
        console.warn('[Week rules] không đọc được, dùng rule mặc định', e);
      } finally {
        this.loading = null;
      }
      return getWeekRules();
    })();
    return this.loading;
  }

  async save(rules: WeekRules, by: string): Promise<void> {
    setWeekRules(rules);
    const r = getWeekRules();
    await this.firestore.firestore.doc(WeekRulesService.DOC).set({ ...r, updatedAt: new Date(), updatedBy: by || '' });
    this.loadedAt = Date.now();
  }
}
