import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as XLSX from 'xlsx';
import {
  extractDmtpRowsFromWorkbook,
  materialProductMapToRecord,
  mergeCustomerMaps,
  parseDmtpFirestoreData,
  parseDmtpRowsToCustomerMap,
  recordToMaterialProductMap,
  ReportDmtpSnapshot,
  ReportXuatMapSnapshot
} from './report-data';

@Injectable({ providedIn: 'root' })
export class ReportDmtpService {
  private static readonly DMTP_DOCS = ['dmtp', 'DMTP'];
  private static readonly XUAT_MAP_DOC = 'xuat-material-product';

  constructor(private firestore: AngularFirestore) {}

  async loadDmtpCustomerMap(): Promise<Map<string, string>> {
    const maps: Map<string, string>[] = [];

    for (const docId of ReportDmtpService.DMTP_DOCS) {
      try {
        const snap = await this.firestore.collection('report-data').doc(docId).get().toPromise();
        if (snap?.exists) {
          const parsed = parseDmtpFirestoreData(snap.data() as Record<string, unknown>);
          if (parsed.size) maps.push(parsed);
        }
      } catch (err) {
        console.warn(`Load report-data/${docId} failed:`, err);
      }
    }

    // report-data/sheets.DMTP hoặc report-data/linkq
    for (const docId of ['sheets', 'linkq', 'workbook']) {
      try {
        const snap = await this.firestore.collection('report-data').doc(docId).get().toPromise();
        if (snap?.exists) {
          const parsed = parseDmtpFirestoreData(snap.data() as Record<string, unknown>);
          if (parsed.size) maps.push(parsed);
        }
      } catch {
        // optional doc
      }
    }

    try {
      const catalogMap = await this.loadFgCatalogCustomerMap();
      if (catalogMap.size) maps.push(catalogMap);
    } catch (err) {
      console.warn('Load fg-catalog for DMTP failed:', err);
    }

    try {
      const rootSnap = await this.firestore.collection('DMTP').get().toPromise();
      const rootMap = new Map<string, string>();
      rootSnap?.docs?.forEach((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const parsed = parseDmtpFirestoreData(d);
        parsed.forEach((v, k) => rootMap.set(k, v));
        const product = String(d.maTp ?? d.materialCode ?? d.ma ?? doc.id ?? '').trim().toUpperCase();
        const customer = String(d.customer ?? d.khachHang ?? d.tenKhachHang ?? '').trim();
        if (product && customer) rootMap.set(product, customer);
      });
      if (rootMap.size) maps.push(rootMap);
    } catch {
      // optional collection
    }

    return mergeCustomerMaps(...maps);
  }

  private async loadFgCatalogCustomerMap(): Promise<Map<string, string>> {
    const snap = await this.firestore.collection('fg-catalog').get().toPromise();
    const map = new Map<string, string>();
    snap?.docs?.forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const product = String(d.materialCode ?? d.maTp ?? '').trim().toUpperCase();
      const customer = String(d.customer ?? d.description ?? d.customerCode ?? '').trim();
      if (product && customer && customer !== 'N/A') {
        map.set(product, customer);
        if (product.includes('_')) map.set(product.split('_')[0], customer);
      }
    });
    return map;
  }

  async saveDmtpFromWorkbook(workbook: XLSX.WorkBook): Promise<void> {
    const rows = extractDmtpRowsFromWorkbook(workbook);
    if (!rows?.length) return;

    const payload: ReportDmtpSnapshot = {
      rows,
      updatedAt: new Date()
    };
    await this.firestore.collection('report-data').doc('dmtp').set(payload);
  }

  async saveXuatMaterialProductMap(map: Map<string, string>): Promise<void> {
    if (!map.size) return;

    const payload: ReportXuatMapSnapshot = {
      map: materialProductMapToRecord(map),
      updatedAt: new Date()
    };
    await this.firestore
      .collection('report-data')
      .doc(ReportDmtpService.XUAT_MAP_DOC)
      .set(payload);
  }

  async loadXuatMaterialProductMap(): Promise<Map<string, string>> {
    try {
      const snap = await this.firestore
        .collection('report-data')
        .doc<ReportXuatMapSnapshot>(ReportDmtpService.XUAT_MAP_DOC)
        .get()
        .toPromise();

      if (snap?.exists) {
        const data = snap.data() as ReportXuatMapSnapshot;
        const map = recordToMaterialProductMap(data?.map);
        if (map.size) return map;
      }
    } catch (err) {
      console.error('Load XUAT material→product map failed:', err);
    }
    return new Map();
  }
}
