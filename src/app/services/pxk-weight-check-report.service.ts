import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';

export interface PxkWeightCheckReport {
  id: string;
  materialCode: string;
  maKho: string;
  po: string;
  lsx: string;
  reason: string;
  reportedBy: string;
  status: string;
  createdAt: any;
}

/** Báo cáo mã không hợp lý để Check lượng, và mã đã được duyệt loại khỏi check. */
@Injectable({ providedIn: 'root' })
export class PxkWeightCheckReportService {
  static readonly REPORTS = 'pxk-weight-check-reports';
  static readonly EXEMPT = 'pxk-weight-check-exempt';

  constructor(
    private firestore: AngularFirestore,
    private fns: AngularFireFunctions
  ) {}

  async loadExemptCodes(): Promise<string[]> {
    const snap = await firstValueFrom(
      this.firestore.collection(PxkWeightCheckReportService.EXEMPT).get()
    );
    return snap.docs
      .map((d) => String(d.id || '').trim().toUpperCase())
      .filter(Boolean);
  }

  async loadPending(): Promise<PxkWeightCheckReport[]> {
    const snap = await firstValueFrom(
      this.firestore.collection(PxkWeightCheckReportService.REPORTS, (ref) =>
        ref.where('status', '==', 'pending')
      ).get()
    );
    const rows = snap.docs.map((d) => this.toReport(d.id, d.data()));
    rows.sort((a, b) => this.millis(b.createdAt) - this.millis(a.createdAt));
    return rows;
  }

  async submit(payload: {
    lsx: string;
    materialCode: string;
    maKho: string;
    po: string;
    reason: string;
    reportedBy: string;
  }): Promise<{ zaloOk: boolean; zaloError: string }> {
    const materialCode = payload.materialCode.trim().toUpperCase();
    await this.firestore.collection(PxkWeightCheckReportService.REPORTS).add({
      lsx: payload.lsx.trim().slice(0, 40),
      materialCode,
      maKho: payload.maKho.trim().slice(0, 40),
      po: payload.po.trim().slice(0, 80),
      reason: payload.reason.trim().slice(0, 400),
      reportedBy: payload.reportedBy.trim().toUpperCase().slice(0, 20),
      status: 'pending',
      createdAt: new Date()
    });
    try {
      const callable = this.fns.httpsCallable<typeof payload, { ok: boolean }>(
        'notifyPxkWeightCheckReportFn'
      );
      await firstValueFrom(callable({
        lsx: payload.lsx.trim().slice(0, 40),
        materialCode,
        maKho: payload.maKho.trim().slice(0, 40),
        po: payload.po.trim().slice(0, 80),
        reason: payload.reason.trim().slice(0, 400),
        reportedBy: payload.reportedBy.trim().toUpperCase().slice(0, 20)
      }));
      return { zaloOk: true, zaloError: '' };
    } catch (e: unknown) {
      const anyErr = e as { message?: string };
      return { zaloOk: false, zaloError: String(anyErr?.message || e || 'Không gửi được Zalo.') };
    }
  }

  async approve(report: PxkWeightCheckReport, decidedBy: string): Promise<void> {
    const code = report.materialCode.trim().toUpperCase();
    if (!code) throw new Error('Thiếu mã hàng.');
    await this.firestore.collection(PxkWeightCheckReportService.EXEMPT).doc(code).set({
      materialCode: code,
      approvedAt: new Date(),
      approvedBy: decidedBy,
      reportId: report.id,
      reason: report.reason,
      lsx: report.lsx
    }, { merge: true });
    const pending = await this.loadPending();
    const same = pending.filter((row) => row.materialCode === code);
    await Promise.all(same.map((row) =>
      this.firestore.collection(PxkWeightCheckReportService.REPORTS).doc(row.id).update({
        status: 'approved',
        decidedAt: new Date(),
        decidedBy
      })
    ));
  }

  async reject(report: PxkWeightCheckReport, decidedBy: string): Promise<void> {
    await this.firestore.collection(PxkWeightCheckReportService.REPORTS).doc(report.id).update({
      status: 'rejected',
      decidedAt: new Date(),
      decidedBy
    });
  }

  private toReport(id: string, data: any): PxkWeightCheckReport {
    return {
      id,
      materialCode: String(data?.materialCode || '').trim().toUpperCase(),
      maKho: String(data?.maKho || '').trim(),
      po: String(data?.po || '').trim(),
      lsx: String(data?.lsx || '').trim(),
      reason: String(data?.reason || '').trim(),
      reportedBy: String(data?.reportedBy || '').trim(),
      status: String(data?.status || '').trim(),
      createdAt: data?.createdAt
    };
  }

  private millis(value: any): number {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const t = new Date(value).getTime();
    return isNaN(t) ? 0 : t;
  }
}
