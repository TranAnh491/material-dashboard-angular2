import {

  AfterViewInit,

  ChangeDetectorRef,

  Component,

  ElementRef,

  HostListener,

  OnDestroy,

  OnInit,

  ViewChild

} from '@angular/core';

import { HttpClient } from '@angular/common/http';

import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { Subscription } from 'rxjs';
import firebase from 'firebase/compat/app';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import {
  LocationRuleCheckService,
  LocationRuleCheckResult,
  RuleViolation
} from '../../services/location-rule-check.service';
import {
  LayoutWarehouseGuidanceService,
  LocationGuidanceDoc
} from '../../services/layout-warehouse-guidance.service';
import { LayoutWarehouseSettingsService } from '../../services/layout-warehouse-settings.service';
import {
  parseWarehouseLocation,
  ParsedWarehouseLocation,
  extractRackLetter,
  extractMaterialPrefix4,
  compareRackLetters,
  isFinishedGoodsShelf,
  isIqcPrefixLocation,
  extractIqcPlusRef,
  mapDotRackLocationToMapCell,
  resolveQualityRackLayoutCell,
  normalizeQualityRackLiveLocation,
  normalizeFinishedGoodsPCode,
  matchesFinishedGoodsPCode,
  mapFgLocationToLayoutShelf,
  extractFgShelfPartFromLocation,
  normalizeMixzoneLiveLocation,
  normalizeLockerLiveLocation,
  normalizeNgLiveLocation,
  isNgPrefixLocation,
  resolveMixzoneShelfFromLocation,
  isAsm3PrefixLocation,
  resolveAsm3WarehouseShelf,
  mapAsm3ShelfToLayoutCell,
  FINISHED_GOODS_GUIDANCE,
  GENERAL_MATERIAL_GUIDANCE,
  GENERAL_MATERIAL_SHELF_RANGE_LABEL,
  getDefaultLocationGuidance,
  isGeneralMaterialRackLetter,
  isLayoutQualityRackCell,
  parseLayoutQualityRackCell,
  locationBelongsToLayoutQualityRack,
  parseQualityRackSlotFromLocation,
  buildQualityRackLevelLabel,
  QUALITY_RACK_LEVEL_COUNT,
  QUALITY_RACK_SLOT_COUNT
} from './layout-warehouse-location.util';
import {
  QualityRackSlotOccupancy,
  QualityRackSlotPick
} from './layout-warehouse-rack-3d.component';



interface MaterialLocationHit {

  materialCode: string;

  location: string;

  poNumber?: string;

  stock?: number;

}



interface SearchLocationHit {
  location: string;
  shelf: string;
  slot: string | null;
  stock?: number;
}

interface SearchResultInfo {
  materialCode?: string;
  location: string;
  shelf: string;
  slot: string | null;
  hitCount?: number;
  searchKind?: 'fg-p' | 'nvl' | 'location';
  locationHits?: SearchLocationHit[];
}

interface ViolationGroup {
  location: string;
  items: RuleViolation[];
}

interface ShelfStorageGuideRow {
  rackLetter: string;
  prefixes: string[];
  itemCount: number;
}

interface IqcLiveMove {
  materialId: string;
  materialCode: string;
  fromLocation: string;
  toLocation: string;
  poNumber: string;
  changedAt: Date | null;
}

interface LiveShelfRow {
  toLocation: string;
  materialCodes: string[];
  count: number;
  onMap: boolean;
}

interface HeatmapShelfRow {
  shelf: string;
  codeCount: number;
  materialCodes: string[];
}

interface PoAgeStats {
  total: number;
  under1y: number;
  under2y: number;
  between2and3y: number;
  overOrEq3y: number;
}



@Component({

  selector: 'app-layout-warehouse',

  templateUrl: './layout-warehouse.component.html',

  styleUrls: ['./layout-warehouse.component.scss']

})

export class LayoutWarehouseComponent implements OnInit, AfterViewInit, OnDestroy {

  private readonly factory = 'ASM1';

  readonly svgWidth = 340;

  readonly svgNativeHeight = 540;

  private fitZoom = 2;



  @ViewChild('svgHost') svgHost?: ElementRef<HTMLDivElement>;

  @ViewChild('viewport') viewportRef?: ElementRef<HTMLDivElement>;



  svgHtml: SafeHtml | null = null;

  isLoading = true;

  isSearching = false;

  loadError = '';

  selectedLoc = '';

  searchLoc = '';

  searchResult: SearchResultInfo | null = null;
  zoom = 2;

  isRuleChecking = false;
  ruleCheckError = '';
  ruleCheckResult: LocationRuleCheckResult | null = null;
  violationGroups: ViolationGroup[] = [];

  showRuleSettingsModal = false;
  ruleSettingsLoading = false;
  ruleSettingsSaving = false;
  ruleSettingsError = '';
  ruleExcludedCodes: string[] = [];
  ruleExcludeDraft = '';

  activeGuidanceLoc = '';
  guidanceDraft = '';
  guidanceLoading = false;
  guidanceSaving = false;
  guidanceError = '';
  guidanceSavedAt: Date | null = null;
  guidanceUpdatedBy = '';

  showStorageGuideModal = false;
  storageGuideLoading = false;
  storageGuideError = '';
  storageGuideRows: ShelfStorageGuideRow[] = [];
  finishedGoodsPrefixes: string[] = [];
  readonly finishedGoodsGuidance = FINISHED_GOODS_GUIDANCE;
  readonly generalMaterialGuidance = GENERAL_MATERIAL_GUIDANCE;
  readonly generalMaterialShelfRangeLabel = GENERAL_MATERIAL_SHELF_RANGE_LABEL;

  liveModeActive = false;
  liveLoading = false;
  liveError = '';
  liveMoves: IqcLiveMove[] = [];
  liveShelfCount = 0;
  liveUnmappedCount = 0;
  liveShelfRows: LiveShelfRow[] = [];

  heatmapModeActive = false;
  heatmapLoading = false;
  heatmapError = '';
  heatmapMaxCount = 0;
  heatmapShelfCount = 0;
  heatmapRows: HeatmapShelfRow[] = [];
  /** Tổng mã ASM3 (vị trí ASM3* hoặc factory ASM3) — hiển thị box Factory 3 */
  asm3HeatmapTotal = 0;

  rack3dActive = false;
  rack3dLoading = false;
  rack3dError = '';
  rack3dCell = '';
  rack3dOccupancy: QualityRackSlotOccupancy[] = [];
  rack3dSelectedLevel: number | null = null;
  rack3dSelectedSlot: number | null = null;
  rack3dSelectedPick: QualityRackSlotPick | null = null;
  readonly qualityRackLevelCount = QUALITY_RACK_LEVEL_COUNT;
  readonly qualityRackSlotCount = 0;

  private knownShelves: string[] = [];
  private guidanceSub?: Subscription;
  private liveRefreshTimer?: ReturnType<typeof setInterval>;
  private readonly materialLocationHistoryCol = 'material-location-history';

  private highlightedEl: Element | null = null;

  private slotMarkerEl: Element | null = null;

  private loadSub?: { unsubscribe: () => void };



  constructor(

    private http: HttpClient,

    private sanitizer: DomSanitizer,

    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private guidanceService: LayoutWarehouseGuidanceService,
    private warehouseSettingsService: LayoutWarehouseSettingsService,
    private ruleCheckService: LocationRuleCheckService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }



  ngOnInit(): void {
    void this.loadRuleExclusions();

    const sub = this.http.get('assets/img/LayoutD.svg', { responseType: 'text' }).subscribe({

      next: svg => {

        this.svgHtml = this.sanitizer.bypassSecurityTrustHtml(svg);

        this.isLoading = false;

        this.cdr.markForCheck();

        setTimeout(() => {

          this.collectKnownShelves();

          this.applyFitZoom();

        }, 0);

      },

      error: err => {

        this.loadError = (err as Error)?.message || String(err);

        this.isLoading = false;

        this.cdr.markForCheck();

      }

    });

    this.loadSub = sub;

  }



  ngAfterViewInit(): void {

    setTimeout(() => this.applyFitZoom(), 0);

  }



  @HostListener('window:resize')

  onWindowResize(): void {

    this.applyFitZoom(false);

  }



  ngOnDestroy(): void {

    this.loadSub?.unsubscribe();
    this.unsubscribeGuidance();
    this.stopLiveMode();
    this.stopHeatmapMode();
    this.closeRack3d();

  }



  onZoneClick(event: Event): void {

    const g = (event.target as Element | null)?.closest?.('[data-loc]');

    if (!g) return;

    this.selectZoneElement(g);

  }



  async jumpToLocation(): Promise<void> {

    const term = String(this.searchLoc || '').trim();

    if (!term) return;



    this.isSearching = true;

    this.clearHighlights();

    this.searchResult = null;



    try {
      const fgPCode = normalizeFinishedGoodsPCode(term);
      if (fgPCode) {
        const fgHits = await this.lookupFgInventoryByPCode(fgPCode);
        if (fgHits.length) {
          this.applyFgSearchResult(fgPCode, fgHits);
          return;
        }
      }

      if (term.length >= 3) {

        const hits = await this.lookupMaterialByCode(term);

        if (hits.length) {

          const exact = hits.filter(h => h.materialCode.toUpperCase() === term.toUpperCase());

          const pick = (exact.length ? exact : hits).find(h => (h.stock ?? 0) > 0) || (exact[0] || hits[0]);

          const parsed = parseWarehouseLocation(pick.location, this.knownShelves);

          if (parsed) {

            this.searchResult = {

              materialCode: pick.materialCode,

              location: pick.location,

              shelf: parsed.shelf,

              slot: parsed.slot,

              hitCount: hits.length

            };

            this.highlightParsedLocation(parsed);

            return;

          }

        }

      }



      const parsedDirect = parseWarehouseLocation(term, this.knownShelves);

      if (parsedDirect) {

        this.searchResult = {

          location: parsedDirect.raw,

          shelf: parsedDirect.shelf,

          slot: parsedDirect.slot

        };

        this.highlightParsedLocation(parsedDirect);

        return;

      }



      const zone = this.findMapZone(term);

      if (zone) {

        this.selectZoneElement(zone);

        this.searchResult = {

          location: term,

          shelf: String(zone.getAttribute('data-loc') || term),

          slot: null

        };

        zone.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

        return;

      }



      if (fgPCode) {
        alert(`Không tìm thấy mã ${fgPCode} trong FG Inventory (kho thành phẩm).`);
      } else {
        alert(`Không tìm thấy mã hàng hoặc vị trí "${term}"`);
      }

    } catch (e) {
      console.error('[LayoutWarehouse] jumpToLocation failed', e);
      alert('Lỗi tra cứu. Vui lòng thử lại sau.');
    } finally {

      this.isSearching = false;

      this.cdr.markForCheck();

    }

  }



  clearSelection(): void {

    this.clearHighlights();

    this.selectedLoc = '';

    this.searchLoc = '';

    this.searchResult = null;

    this.clearGuidanceState();
    this.closeRack3d();

  }

  get canOpenRack3d(): boolean {
    return !!this.resolveSelectedQualityRackCell() && !this.rack3dActive;
  }

  private resolveSelectedQualityRackCell(): string {
    const raw = String(this.selectedLoc || '').trim();
    if (isLayoutQualityRackCell(raw)) return raw;

    const head = raw.split('—')[0].trim();
    if (isLayoutQualityRackCell(head)) return head;

    const compact = raw.replace(/\s/g, '').toUpperCase();
    const m = /^([RSTUVWXYZO]\d\([LR]\))/.exec(compact);
    if (m && isLayoutQualityRackCell(m[1])) return m[1];

    const shelf = String(this.searchResult?.shelf || '').trim();
    if (isLayoutQualityRackCell(shelf)) return shelf;

    return '';
  }

  get rack3dLevelSummaries(): { level: number; label: string; occupied: number }[] {
    const cell = parseLayoutQualityRackCell(this.rack3dCell);
    if (!cell) return [];
    const rows: { level: number; label: string; occupied: number }[] = [];
    for (let level = 1; level <= QUALITY_RACK_LEVEL_COUNT; level++) {
      const occupied = this.uniqueRack3dLevelCount(level);
      rows.push({
        level,
        label: buildQualityRackLevelLabel(cell, level),
        occupied
      });
    }
    return rows;
  }

  get rack3dSelectedLevelPoStats(): PoAgeStats | null {
    if (!this.rack3dSelectedLevel) return null;
    const rows = this.rack3dOccupancy.filter(o => o.level === this.rack3dSelectedLevel);
    if (!rows.length) {
      return { total: 0, under1y: 0, under2y: 0, between2and3y: 0, overOrEq3y: 0 };
    }
    return this.calcPoAgeStats(rows.map(r => r.poNumber));
  }

  private uniqueRack3dLevelCount(level: number): number {
    const set = new Set<string>();
    for (const row of this.rack3dOccupancy) {
      if (row.level !== level) continue;
      // Unique theo materialCode + PO + IMD để đúng nhu cầu "mỗi mã hàng, po, imd"
      const key = `${row.materialCode}\0${row.poNumber}\0${row.imd ? row.imd.toISOString().slice(0, 10) : ''}`;
      set.add(key);
    }
    return set.size;
  }

  private parsePoMmyy(po: string): { month: number; year: number } | null {
    const raw = String(po || '').trim();
    const m = /^(\d{2})(\d{2})\/\d+/.exec(raw);
    if (!m) return null;
    const month = Number(m[1]);
    const yy = Number(m[2]);
    if (!Number.isFinite(month) || month < 1 || month > 12) return null;
    // PO mmyy -> assume 20yy
    const year = 2000 + yy;
    return { month, year };
  }

  private monthsDiff(fromYear: number, fromMonth: number, to: Date): number {
    const y2 = to.getFullYear();
    const m2 = to.getMonth() + 1;
    return (y2 - fromYear) * 12 + (m2 - fromMonth);
  }

  private calcPoAgeStats(pos: string[]): PoAgeStats {
    const now = new Date();
    const stats: PoAgeStats = { total: 0, under1y: 0, under2y: 0, between2and3y: 0, overOrEq3y: 0 };
    for (const po of pos) {
      const parsed = this.parsePoMmyy(po);
      if (!parsed) continue;
      const months = this.monthsDiff(parsed.year, parsed.month, now);
      if (!Number.isFinite(months) || months < 0) continue;
      stats.total += 1;
      if (months < 12) stats.under1y += 1;
      else if (months < 24) stats.under2y += 1;
      else if (months < 36) stats.between2and3y += 1;
      else stats.overOrEq3y += 1;
    }
    return stats;
  }

  async openRack3d(): Promise<void> {
    const label = this.resolveSelectedQualityRackCell();
    const cell = parseLayoutQualityRackCell(label);
    if (!cell) return;

    this.rack3dCell = cell.label;
    this.rack3dActive = true;
    this.rack3dSelectedLevel = null;
    this.rack3dSelectedSlot = null;
    this.rack3dSelectedPick = null;
    this.rack3dError = '';
    this.cdr.markForCheck();

    await this.loadRack3dInventory();
  }

  closeRack3d(): void {
    this.rack3dActive = false;
    this.rack3dLoading = false;
    this.rack3dError = '';
    this.rack3dCell = '';
    this.rack3dOccupancy = [];
    this.rack3dSelectedLevel = null;
    this.rack3dSelectedSlot = null;
    this.rack3dSelectedPick = null;
    this.cdr.markForCheck();
  }

  onRack3dSlotPick(pick: QualityRackSlotPick): void {
    this.rack3dSelectedLevel = pick.level;
    this.rack3dSelectedSlot = null;
    this.rack3dSelectedPick = pick;
    this.cdr.markForCheck();
  }

  jumpToRack3dLevel(level: number): void {
    this.rack3dSelectedLevel = level;
    this.rack3dSelectedSlot = null;
    const cell = parseLayoutQualityRackCell(this.rack3dCell);
    if (!cell) return;
    const items = this.rack3dOccupancy.filter(o => o.level === level);
    this.rack3dSelectedPick = {
      level,
      location: buildQualityRackLevelLabel(cell, level),
      items
    };
    this.cdr.markForCheck();
  }

  private async loadRack3dInventory(): Promise<void> {
    const layoutCell = this.rack3dCell;
    if (!layoutCell) return;

    this.rack3dLoading = true;
    this.rack3dError = '';
    this.rack3dOccupancy = [];
    this.cdr.markForCheck();

    try {
      const snap = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', this.factory).limit(10000)
        )
        .get()
        .toPromise();

      const rows: QualityRackSlotOccupancy[] = [];

      for (const doc of snap?.docs || []) {
        const data = doc.data() as Record<string, unknown>;
        const materialCode = String(data['materialCode'] || '').trim();
        const location = String(data['location'] ?? data['viTri'] ?? '').trim();
        if (!materialCode || !location) continue;
        if (!locationBelongsToLayoutQualityRack(location, layoutCell)) continue;

        const qty = Number(data['quantity']) || 0;
        const exported = Number(data['exported']) || 0;
        const stockField = Number(data['stock']) || 0;
        const stock = qty > 0 ? qty - exported : stockField;
        if (stock <= 0) continue;

        const slotInfo = parseQualityRackSlotFromLocation(location);
        if (!slotInfo) continue;

        const poNumber = String(data['poNumber'] || '').trim();
        const imd = this.toDate(data['importDate'] as unknown as LocationGuidanceDoc['updatedAt']);

        rows.push({
          level: slotInfo.level,
          location,
          materialCode,
          poNumber,
          imd,
          stock
        });
      }

      this.rack3dOccupancy = rows;
    } catch (err) {
      this.rack3dError = (err as Error)?.message || String(err);
    } finally {
      this.rack3dLoading = false;
      this.cdr.markForCheck();
    }
  }

  openStorageGuide(): void {
    this.showStorageGuideModal = true;
    void this.loadStorageGuide();
  }

  closeStorageGuide(): void {
    this.showStorageGuideModal = false;
  }

  async toggleLiveMode(): Promise<void> {
    if (this.liveModeActive) {
      this.stopLiveMode();
      return;
    }
    this.stopHeatmapMode();
    this.liveModeActive = true;
    await this.refreshLiveMoves();
    this.liveRefreshTimer = setInterval(() => void this.refreshLiveMoves(), 120_000);
  }

  stopLiveMode(): void {
    this.liveModeActive = false;
    this.liveLoading = false;
    this.liveError = '';
    this.liveMoves = [];
    this.liveShelfCount = 0;
    this.liveUnmappedCount = 0;
    this.liveShelfRows = [];
    if (this.liveRefreshTimer) {
      clearInterval(this.liveRefreshTimer);
      this.liveRefreshTimer = undefined;
    }
    this.clearLiveHighlights();
    this.cdr.markForCheck();
  }

  async toggleHeatmapMode(): Promise<void> {
    if (this.heatmapModeActive) {
      this.stopHeatmapMode();
      return;
    }
    this.stopLiveMode();
    this.heatmapModeActive = true;
    await this.refreshHeatmap();
  }

  stopHeatmapMode(): void {
    this.heatmapModeActive = false;
    this.heatmapLoading = false;
    this.heatmapError = '';
    this.heatmapMaxCount = 0;
    this.heatmapShelfCount = 0;
    this.heatmapRows = [];
    this.asm3HeatmapTotal = 0;
    this.clearHeatmapHighlights();
    this.cdr.markForCheck();
  }

  async refreshHeatmap(): Promise<void> {
    if (!this.heatmapModeActive) return;

    this.heatmapLoading = true;
    this.heatmapError = '';
    this.cdr.markForCheck();

    try {
      if (!this.knownShelves.length) {
        this.collectKnownShelves();
      }
      const shelfCounts = await this.loadHeatmapShelfCounts();
      this.applyHeatmapHighlights(shelfCounts.byShelf, shelfCounts.asm3Total);
    } catch (err) {
      this.heatmapError = (err as Error)?.message || String(err);
      this.clearHeatmapHighlights();
    } finally {
      this.heatmapLoading = false;
      this.cdr.markForCheck();
    }
  }

  jumpToHeatmapShelf(row: HeatmapShelfRow): void {
    const zone = this.findZoneForLocation(row.shelf);
    if (!zone) return;
    this.selectZoneElement(zone);
    zone.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  private async loadHeatmapShelfCounts(): Promise<{
    byShelf: Map<string, Set<string>>;
    asm3Total: Set<string>;
  }> {
    const [asm1Snap, asm3Snap] = await Promise.all([
      this.firestore
        .collection('inventory-materials', ref => ref.where('factory', '==', 'ASM1').limit(10000))
        .get()
        .toPromise(),
      this.firestore
        .collection('inventory-materials', ref => ref.where('factory', '==', 'ASM3').limit(10000))
        .get()
        .toPromise()
    ]);

    const byShelf = new Map<string, Set<string>>();
    const asm3Total = new Set<string>();

    const ingest = (data: Record<string, unknown>, factory: string): void => {
      const materialCode = String(data['materialCode'] || '').trim().toUpperCase();
      const location = String(data['location'] ?? data['viTri'] ?? '').trim();
      if (!materialCode || !location || location.toUpperCase() === 'TEMPORARY') return;

      const qty = Number(data['quantity']) || 0;
      const exported = Number(data['exported']) || 0;
      const stockField = Number(data['stock']) || 0;
      const openingStock =
        data['openingStock'] != null ? Number(data['openingStock']) : 0;
      const xt = Number(data['xt']) || 0;
      const available =
        qty > 0 ? openingStock + qty - exported - xt : stockField > 0 ? stockField : openingStock;
      if (available <= 0) return;

      const isAsm3Loc = isAsm3PrefixLocation(location) || factory === 'ASM3';
      if (isAsm3Loc) {
        asm3Total.add(materialCode);
        const asm3Shelf = resolveAsm3WarehouseShelf(location, factory);
        if (asm3Shelf) {
          const codes = byShelf.get(asm3Shelf) || new Set<string>();
          codes.add(materialCode);
          byShelf.set(asm3Shelf, codes);
        }
        return;
      }

      const shelfKey = this.resolveHeatmapMapKey(location);
      if (!shelfKey) return;

      const codes = byShelf.get(shelfKey) || new Set<string>();
      codes.add(materialCode);
      byShelf.set(shelfKey, codes);
    };

    for (const doc of asm1Snap?.docs || []) {
      ingest(doc.data() as Record<string, unknown>, 'ASM1');
    }
    for (const doc of asm3Snap?.docs || []) {
      ingest(doc.data() as Record<string, unknown>, 'ASM3');
    }

    return { byShelf, asm3Total };
  }

  private resolveHeatmapMapKey(location: string): string | null {
    const asm3Shelf = resolveAsm3WarehouseShelf(location);
    if (asm3Shelf) {
      return asm3Shelf;
    }

    const zone = this.findZoneForLocation(location);
    if (!zone) return null;
    const target = this.resolveLiveHighlightTarget(zone);
    if (!target) return null;
    const shelf = String(target.getAttribute('data-shelf') || '').trim().toUpperCase();
    const loc = String(target.getAttribute('data-loc') || '').trim().toUpperCase();
    return shelf || loc || null;
  }

  private heatmapColors(count: number, max: number): { fill: string; stroke: string } {
    if (count <= 0 || max <= 0) {
      return { fill: '#ffffff', stroke: '#94a3b8' };
    }
    const t = Math.min(1, count / max);
    const lightness = Math.round(94 - t * 54);
    const saturation = Math.round(65 + t * 30);
    const strokeLight = Math.max(22, lightness - 18);
    return {
      fill: `hsl(217, ${saturation}%, ${lightness}%)`,
      stroke: `hsl(217, ${saturation}%, ${strokeLight}%)`
    };
  }

  private async refreshLiveMoves(): Promise<void> {
    if (!this.liveModeActive) return;

    this.liveLoading = true;
    this.liveError = '';
    this.cdr.markForCheck();

    try {
      if (!this.knownShelves.length) {
        this.collectKnownShelves();
      }
      this.liveMoves = await this.loadTodayIqcToShelfMoves();
      this.applyLiveHighlights(this.liveMoves);
    } catch (err) {
      this.liveError = (err as Error)?.message || String(err);
      this.clearLiveHighlights();
    } finally {
      this.liveLoading = false;
      this.cdr.markForCheck();
    }
  }

  async loadStorageGuide(): Promise<void> {
    this.storageGuideLoading = true;
    this.storageGuideError = '';
    this.storageGuideRows = [];
    this.finishedGoodsPrefixes = [];
    this.cdr.markForCheck();

    try {
      if (!this.knownShelves.length) {
        this.collectKnownShelves();
      }

      const snap = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', this.factory).limit(10000)
        )
        .get()
        .toPromise();

      const byRack = new Map<string, Set<string>>();
      const finishedSet = new Set<string>();

      for (const doc of snap?.docs || []) {
        const data = doc.data() as Record<string, unknown>;
        const materialCode = String(data['materialCode'] || '').trim();
        const location = String(data['location'] ?? data['viTri'] ?? '').trim();
        if (!materialCode || !location) continue;

        const qty = Number(data['quantity']) || 0;
        const exported = Number(data['exported']) || 0;
        const stockField = Number(data['stock']) || 0;
        const available = qty > 0 ? qty - exported : stockField;
        if (available <= 0) continue;

        const prefix = extractMaterialPrefix4(materialCode);
        if (!prefix) continue;

        if (isFinishedGoodsShelf(location, this.knownShelves)) {
          finishedSet.add(prefix);
          continue;
        }

        const rack = extractRackLetter(location, this.knownShelves);
        if (!rack) continue;

        if (!byRack.has(rack)) byRack.set(rack, new Set());
        byRack.get(rack)!.add(prefix);
      }

      this.finishedGoodsPrefixes = Array.from(finishedSet).sort((a, b) =>
        a.localeCompare(b, 'vi', { numeric: true })
      );

      this.storageGuideRows = Array.from(byRack.entries())
        .map(([rackLetter, prefixes]) => ({
          rackLetter,
          prefixes: Array.from(prefixes).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
          itemCount: prefixes.size
        }))
        .sort((a, b) => compareRackLetters(a.rackLetter, b.rackLetter));
    } catch (err) {
      this.storageGuideError = (err as Error)?.message || String(err);
    } finally {
      this.storageGuideLoading = false;
      this.cdr.markForCheck();
    }
  }

  async saveLocationGuidance(): Promise<void> {
    if (!this.activeGuidanceLoc) return;

    this.guidanceSaving = true;
    this.guidanceError = '';

    try {
      const updatedBy = await this.resolveOperatorId();
      await this.guidanceService.saveGuidance(
        this.factory,
        this.activeGuidanceLoc,
        this.guidanceDraft,
        updatedBy
      );
      this.guidanceSavedAt = new Date();
      this.guidanceUpdatedBy = updatedBy;
    } catch (err) {
      this.guidanceError = (err as Error)?.message || String(err);
    } finally {
      this.guidanceSaving = false;
      this.cdr.markForCheck();
    }
  }



  setZoom(delta: number): void {

    this.zoom = Math.min(5, Math.max(0.6, Math.round((this.zoom + delta) * 10) / 10));

  }



  resetZoom(): void {

    this.zoom = this.fitZoom;

  }



  get slotDetailText(): string {
    if (!this.searchResult?.slot) return 'Toàn kệ';
    return `Ô ${this.searchResult.slot}`;
  }

  isGeneralMaterialRack(rackLetter: string): boolean {
    return isGeneralMaterialRackLetter(rackLetter);
  }

  async openRuleSettings(): Promise<void> {
    this.showRuleSettingsModal = true;
    this.ruleSettingsError = '';
    this.ruleExcludeDraft = '';
    await this.loadRuleExclusions();
    this.cdr.markForCheck();
  }

  closeRuleSettings(): void {
    this.showRuleSettingsModal = false;
    this.ruleSettingsError = '';
    this.ruleExcludeDraft = '';
    this.cdr.markForCheck();
  }

  private async loadRuleExclusions(): Promise<void> {
    this.ruleSettingsLoading = true;
    try {
      this.ruleExcludedCodes = await this.warehouseSettingsService.loadRuleExclusions(this.factory);
    } catch (err) {
      this.ruleSettingsError = (err as Error)?.message || String(err);
    } finally {
      this.ruleSettingsLoading = false;
      this.cdr.markForCheck();
    }
  }

  addRuleExclusionFromDraft(): void {
    const added = this.warehouseSettingsService.parseExcludedCodesInput(this.ruleExcludeDraft);
    if (!added.length) return;
    const merged = new Set([...this.ruleExcludedCodes, ...added]);
    this.ruleExcludedCodes = Array.from(merged).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    this.ruleExcludeDraft = '';
    this.cdr.markForCheck();
  }

  removeRuleExclusion(code: string): void {
    const norm = this.warehouseSettingsService.normalizeExcludedCode(code);
    this.ruleExcludedCodes = this.ruleExcludedCodes.filter(c => c !== norm);
    this.cdr.markForCheck();
  }

  async saveRuleExclusions(): Promise<void> {
    this.ruleSettingsSaving = true;
    this.ruleSettingsError = '';
    try {
      if (this.ruleExcludeDraft.trim()) {
        this.addRuleExclusionFromDraft();
      }
      const user = await this.auth.currentUser;
      const updatedBy = user?.email || user?.displayName || 'layout-warehouse';
      await this.warehouseSettingsService.saveRuleExclusions(
        this.factory,
        this.ruleExcludedCodes,
        updatedBy
      );
      this.showRuleSettingsModal = false;
      this.ruleExcludeDraft = '';
      this.cdr.markForCheck();
    } catch (err) {
      this.ruleSettingsError = (err as Error)?.message || String(err);
      this.cdr.markForCheck();
    } finally {
      this.ruleSettingsSaving = false;
      this.cdr.markForCheck();
    }
  }

  async checkRuleStorage(): Promise<void> {
    this.isRuleChecking = true;
    this.ruleCheckError = '';
    this.ruleCheckResult = null;
    this.violationGroups = [];
    this.clearRuleViolationHighlights();

    try {
      const result = await this.ruleCheckService.checkInventoryAgainstRules(this.factory as 'ASM1', undefined, {
        excludedMaterialCodes: this.ruleExcludedCodes
      });
      this.ruleCheckResult = result;
      this.violationGroups = this.buildViolationGroups(result.violations);
      this.isRuleChecking = false;
      this.cdr.markForCheck();
      requestAnimationFrame(() => this.highlightRuleViolations(result.violations));
    } catch (err) {
      this.ruleCheckError = (err as Error)?.message || String(err);
      this.isRuleChecking = false;
      this.cdr.markForCheck();
    }
  }

  clearRuleCheck(): void {
    this.ruleCheckResult = null;
    this.violationGroups = [];
    this.ruleCheckError = '';
    this.clearRuleViolationHighlights();
    this.cdr.markForCheck();
  }

  get canDownloadRuleResults(): boolean {
    return !!this.ruleCheckResult && !this.isRuleChecking;
  }

  downloadRuleCheckResults(): void {
    const result = this.ruleCheckResult;
    if (!result) return;

    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const now = new Date();
    const ts = now.toLocaleString('vi-VN');
    const lines: string[] = [
      `Báo cáo Check Rule Storage - ${this.factory}`,
      `Thời gian,${esc(ts)}`,
      `Đã kiểm tra,${result.checkedCount}`,
      `Sai rule,${result.violations.length}`,
      `Bỏ qua (IQC/NG/ASM3),${result.skippedExempt}`,
      `Loại trừ (setting),${result.skippedExcluded}`,
      `Không có rule,${result.skippedNoRule}`,
      `Không có vị trí,${result.skippedEmptyLocation}`,
      '',
      ['Mã hàng', 'Vị trí sai'].map(esc).join(',')
    ];

    for (const v of result.violations) {
      lines.push([v.materialCode, v.location].map(esc).join(','));
    }

    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = now.toISOString().slice(0, 10);
    a.href = url;
    a.download = `CheckRuleStorage-${this.factory}-${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  jumpToViolation(group: ViolationGroup): void {
    const parsed = parseWarehouseLocation(group.location, this.knownShelves);
    if (parsed) {
      this.highlightParsedLocation(parsed);
      this.searchResult = {
        location: group.location,
        shelf: parsed.shelf,
        slot: parsed.slot
      };
      this.selectedLoc = `${group.location} (${group.items.length} sai rule)`;
    } else {
      const zone = this.findMapZone(group.location);
      if (zone) {
        this.selectZoneElement(zone);
        zone.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }
    this.cdr.markForCheck();
  }

  private buildViolationGroups(violations: RuleViolation[]): ViolationGroup[] {
    const map = new Map<string, RuleViolation[]>();
    for (const v of violations) {
      const key = v.location.toUpperCase();
      const list = map.get(key) || [];
      list.push(v);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([location, items]) => ({ location, items }))
      .sort((a, b) => a.location.localeCompare(b.location, 'vi', { numeric: true }));
  }

  private highlightRuleViolations(violations: RuleViolation[]): void {
    const host = this.svgHost?.nativeElement;
    if (!host) return;

    const seen = new Set<Element>();
    const uniqueLocs = [...new Set(violations.map(v => v.location))];

    for (const loc of uniqueLocs) {
      const zone = this.findZoneForLocation(loc);
      if (!zone || seen.has(zone)) continue;
      seen.add(zone);
      zone.classList.add('lw-zone--violation');
    }
  }

  private clearRuleViolationHighlights(): void {
    const host = this.svgHost?.nativeElement;
    host?.querySelectorAll('.lw-zone--violation').forEach(el => {
      el.classList.remove('lw-zone--violation');
    });
  }



  /** Prefix trên materialCode — không kèm factory (tránh composite index). */
  private async queryFgInventoryDocsByMaterialPrefix(prefix: string): Promise<firebase.firestore.QueryDocumentSnapshot[]> {
    try {
      const snap = await this.firestore
        .collection('fg-inventory', ref =>
          ref
            .where('materialCode', '>=', prefix)
            .where('materialCode', '<=', prefix + '\uf8ff')
            .limit(500)
        )
        .get()
        .toPromise();
      return snap?.docs || [];
    } catch {
      return [];
    }
  }

  /** Fallback: quét theo factory (cùng pattern fgs-dashboard). */
  private async queryFgInventoryDocsByFactory(): Promise<firebase.firestore.QueryDocumentSnapshot[]> {
    const snap = await this.firestore
      .collection('fg-inventory', ref => ref.where('factory', '==', this.factory))
      .get()
      .toPromise();
    return snap?.docs || [];
  }

  private async lookupFgInventoryByPCode(pCode: string): Promise<MaterialLocationHit[]> {
    const prefix = pCode.toUpperCase();
    let docs = await this.queryFgInventoryDocsByMaterialPrefix(prefix);
    if (!docs.length) {
      docs = await this.queryFgInventoryDocsByFactory();
    }

    const byLocation = new Map<string, { materialCode: string; stock: number }>();

    for (const doc of docs) {
      const data = doc.data() as Record<string, unknown>;
      if (String(data['factory'] || '').toUpperCase() !== this.factory) continue;

      const materialCode = String(data['materialCode'] || data['maTP'] || '').trim().toUpperCase();
      if (!matchesFinishedGoodsPCode(materialCode, prefix)) continue;

      const location = String(data['location'] || data['viTri'] || '').trim().toUpperCase();
      if (!location || location === 'TEMPORARY') continue;

      const tonDau = Number(data['tonDau'] ?? 0);
      const nhap = Number(data['nhap'] ?? data['quantity'] ?? 0);
      const xuat = Number(data['xuat'] ?? data['exported'] ?? 0);
      const ton =
        data['ton'] != null
          ? Number(data['ton'])
          : data['stock'] != null
            ? Number(data['stock'])
            : tonDau + nhap - xuat;

      if (ton <= 0) continue;

      const prev = byLocation.get(location);
      byLocation.set(location, {
        materialCode: prev?.materialCode || materialCode,
        stock: (prev?.stock || 0) + ton
      });
    }

    return Array.from(byLocation.entries())
      .map(([location, v]) => ({
        materialCode: v.materialCode,
        location,
        stock: v.stock
      }))
      .sort((a, b) => a.location.localeCompare(b.location, 'vi', { numeric: true }));
  }

  private applyFgSearchResult(pCode: string, hits: MaterialLocationHit[]): void {
    const locationHits: SearchLocationHit[] = hits.map(hit => {
      const layoutShelf = mapFgLocationToLayoutShelf(hit.location, this.knownShelves);
      const shelfPart = extractFgShelfPartFromLocation(hit.location);
      const parsed = shelfPart
        ? parseWarehouseLocation(shelfPart, this.knownShelves)
        : null;
      return {
        location: hit.location,
        shelf: layoutShelf || hit.location,
        slot: parsed?.slot ?? null,
        stock: hit.stock
      };
    });

    const first = locationHits[0];
    this.searchResult = {
      materialCode: pCode,
      location: first.location,
      shelf: first.shelf,
      slot: first.slot,
      hitCount: locationHits.length,
      searchKind: 'fg-p',
      locationHits
    };

    this.highlightFgLocations(locationHits);
    this.selectedLoc = `${pCode} · ${locationHits.length} kệ`;
  }

  jumpToFgLocation(hit: SearchLocationHit): void {
    const layoutShelf = mapFgLocationToLayoutShelf(hit.location, this.knownShelves);
    if (!layoutShelf) return;

    const shelfPart = extractFgShelfPartFromLocation(hit.location);
    const parsed = shelfPart ? parseWarehouseLocation(shelfPart, this.knownShelves) : null;
    if (parsed) {
      this.highlightParsedLocation(parsed);
    } else {
      const zone = this.findMapZone(layoutShelf);
      if (zone) {
        this.selectZoneElement(zone);
        zone.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }
    if (this.searchResult) {
      this.searchResult = {
        ...this.searchResult,
        location: hit.location,
        shelf: hit.shelf,
        slot: hit.slot
      };
    }
    this.cdr.markForCheck();
  }

  private highlightFgLocations(hits: SearchLocationHit[]): void {
    this.clearHighlights();
    const host = this.svgHost?.nativeElement;
    if (!host) return;

    const seen = new Set<Element>();
    let firstEl: Element | null = null;

    for (const hit of hits) {
      const layoutShelf = mapFgLocationToLayoutShelf(hit.location, this.knownShelves);
      if (!layoutShelf) continue;

      const zone =
        host.querySelector(`[data-loc="${layoutShelf}"]`) ||
        host.querySelector(`[data-shelf="${layoutShelf}"]`) ||
        this.findMapZone(layoutShelf);

      if (!zone || seen.has(zone)) continue;
      seen.add(zone);
      const target = zone.getAttribute('data-shelf') ? zone.closest('[data-loc]') || zone : zone;
      target.classList.add('lw-zone--shelf');
      if (!firstEl) firstEl = target;
    }

    if (firstEl) {
      this.highlightedEl = firstEl;
      firstEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }

  private async lookupMaterialByCode(code: string): Promise<MaterialLocationHit[]> {

    const normalized = code.trim().toUpperCase();



    let snap = await this.firestore

      .collection('inventory-materials', ref =>

        ref.where('factory', '==', this.factory).where('materialCode', '==', normalized).limit(50)

      )

      .get()

      .toPromise();



    if (!snap || snap.empty) {

      snap = await this.firestore

        .collection('inventory-materials', ref =>

          ref

            .where('factory', '==', this.factory)

            .where('materialCode', '>=', normalized)

            .where('materialCode', '<=', normalized + '\uf8ff')

            .limit(100)

        )

        .get()

        .toPromise();

    }



    return (snap?.docs || [])

      .map(doc => {

        const data = doc.data() as Record<string, unknown>;

        const location = String(data['location'] ?? data['viTri'] ?? '').trim().toUpperCase();

        return {

          materialCode: String(data['materialCode'] || ''),

          location,

          poNumber: String(data['poNumber'] || ''),

          stock: Number(data['stock'] ?? data['quantity'] ?? 0)

        };

      })

      .filter(hit => hit.location);

  }



  private collectKnownShelves(): void {

    const host = this.svgHost?.nativeElement;

    if (!host) return;



    const shelves = new Set<string>();

    host.querySelectorAll('[data-loc]').forEach(el => {

      const loc = String(el.getAttribute('data-loc') || '').trim();

      if (loc) shelves.add(loc);

    });

    host.querySelectorAll('[data-shelf]').forEach(el => {

      const shelf = String(el.getAttribute('data-shelf') || '').trim();

      if (shelf) shelves.add(shelf);

    });



    this.knownShelves = Array.from(shelves);

  }



  private findMapZone(term: string): Element | null {

    const host = this.svgHost?.nativeElement;

    if (!host) return null;



    const upper = term.toUpperCase();
    const qualityCell = resolveQualityRackLayoutCell(term);
    const dotRackCell = qualityCell || mapDotRackLocationToMapCell(upper);

    return (

      host.querySelector(`[data-loc="${term}"]`) ||

      host.querySelector(`[data-loc="${upper}"]`) ||

      (dotRackCell ? host.querySelector(`[data-loc="${dotRackCell}"]`) : null) ||

      host.querySelector(`[data-shelf="${upper}"]`) ||

      Array.from(host.querySelectorAll('[data-loc]')).find(el => {

        const loc = String(el.getAttribute('data-loc') || '').toUpperCase();

        if (loc === upper || loc.startsWith(upper)) return true;

        const aliases = String(el.getAttribute('data-loc-alias') || '')

          .split(',')

          .map(a => a.trim().toUpperCase())

          .filter(Boolean);

        return aliases.some(alias => alias === upper || alias.includes(upper));

      }) ||

      null

    );

  }



  private highlightParsedLocation(parsed: ParsedWarehouseLocation): void {

    const host = this.svgHost?.nativeElement;

    if (!host) return;



    const shelfEl =

      host.querySelector(`[data-loc="${parsed.shelf}"]`) ||

      host.querySelector(`[data-shelf="${parsed.shelf}"]`) ||

      this.findMapZone(parsed.shelf);



    if (!shelfEl) {

      alert(`Không tìm thấy kệ "${parsed.shelf}" trên sơ đồ`);

      return;

    }



    this.highlightShelfElement(shelfEl, parsed.slot);

    this.selectedLoc = parsed.shelf + (parsed.slot ? ` — ô ${parsed.slot}` : '');

    this.loadGuidanceForLocation(parsed.shelf);

    shelfEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

    this.cdr.markForCheck();

  }



  private highlightShelfElement(shelfEl: Element, slot: string | null): void {

    this.clearHighlights();



    const target =

      shelfEl.getAttribute('data-shelf') ? shelfEl : shelfEl.closest('[data-loc]') || shelfEl;



    target.classList.add('lw-zone--shelf');

    this.highlightedEl = target;



    if (slot) {

      this.drawSlotMarker(target, slot);

    }

  }



  private drawSlotMarker(shelfEl: Element, slot: string): void {

    const slotNum = parseInt(slot, 10);

    if (!slotNum || slotNum < 1) return;



    const baseRect =

      shelfEl.querySelector('rect.lw-zone-inner') ||

      shelfEl.querySelector('rect:not(.lw-slot-marker)');

    if (!baseRect) return;



    const x = Number(baseRect.getAttribute('x') || 0);

    const y = Number(baseRect.getAttribute('y') || 0);

    const w = Number(baseRect.getAttribute('width') || 10);

    const h = Number(baseRect.getAttribute('height') || 30);

    const slotsPerShelf = 3;

    const slotH = h / slotsPerShelf;

    const slotIndex = Math.min(slotNum, slotsPerShelf) - 1;



    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'rect');

    marker.setAttribute('class', 'lw-slot-marker');

    marker.setAttribute('x', String(x));

    marker.setAttribute('y', String(y + slotIndex * slotH));

    marker.setAttribute('width', String(w));

    marker.setAttribute('height', String(slotH));

    marker.setAttribute('fill', '#43a047');

    marker.setAttribute('stroke', '#1b5e20');

    marker.setAttribute('stroke-width', '1.2');



    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');

    label.setAttribute('class', 'lw-slot-label');

    label.setAttribute('x', String(x + w / 2));

    label.setAttribute('y', String(y + slotIndex * slotH + slotH / 2));

    label.setAttribute('font-size', '5');

    label.setAttribute('text-anchor', 'middle');

    label.setAttribute('dominant-baseline', 'middle');

    label.setAttribute('fill', '#fff');

    label.setAttribute('font-weight', 'bold');

    label.textContent = slot;



    const parent = shelfEl.closest('[data-loc]') || shelfEl;

    parent.appendChild(marker);

    parent.appendChild(label);

    this.slotMarkerEl = marker;

  }



  private clearHighlights(): void {

    const host = this.svgHost?.nativeElement;

    if (host) {

      host.querySelectorAll('.lw-zone--active, .lw-zone--shelf').forEach(el => {

        el.classList.remove('lw-zone--active', 'lw-zone--shelf');

      });

      host.querySelectorAll('.lw-slot-marker, .lw-slot-label').forEach(el => el.remove());

    }

    this.highlightedEl = null;

    this.slotMarkerEl = null;

  }



  private applyFitZoom(updateCurrent = true): void {

    const vp = this.viewportRef?.nativeElement;

    if (!vp) return;



    const padTop = 24;

    const padSide = 16;

    const availableH = vp.clientHeight - padTop - padSide;

    const availableW = vp.clientWidth - padSide * 2;

    const scaleH = availableH / this.svgNativeHeight;

    const scaleW = availableW / this.svgWidth;

    const fit = Math.min(scaleH, scaleW) * 0.96;



    this.fitZoom = Math.min(5, Math.max(1.8, Math.round(fit * 10) / 10));

    if (updateCurrent) {

      this.zoom = this.fitZoom;

      this.cdr.markForCheck();

    }

    vp.scrollTop = 0;

  }



  private selectZoneElement(g: Element): void {

    this.clearHighlights();

    g.classList.add('lw-zone--active');

    this.highlightedEl = g;

    const loc = String(g.getAttribute('data-loc') || '').trim();
    this.selectedLoc = loc;
    this.searchLoc = loc;
    this.searchResult = null;
    this.loadGuidanceForLocation(loc);
    this.cdr.markForCheck();

  }

  private loadGuidanceForLocation(location: string): void {
    const loc = String(location || '').trim();
    if (!loc) {
      this.clearGuidanceState();
      return;
    }

    this.unsubscribeGuidance();
    this.activeGuidanceLoc = loc;
    this.guidanceDraft = '';
    this.guidanceLoading = true;
    this.guidanceError = '';
    this.guidanceSavedAt = null;
    this.guidanceUpdatedBy = '';

    this.guidanceSub = this.guidanceService.watchGuidance(this.factory, loc).subscribe({
      next: doc => this.applyGuidanceDoc(doc),
      error: err => {
        this.guidanceLoading = false;
        this.guidanceError = (err as Error)?.message || String(err);
        this.cdr.markForCheck();
      }
    });
  }

  private applyGuidanceDoc(doc: LocationGuidanceDoc | null): void {
    const saved = String(doc?.guidance || '').trim();
    if (saved) {
      this.guidanceDraft = saved;
    } else {
      this.guidanceDraft = getDefaultLocationGuidance(this.activeGuidanceLoc, this.knownShelves);
    }
    this.guidanceUpdatedBy = String(doc?.updatedBy || '');
    this.guidanceSavedAt = this.toDate(doc?.updatedAt);
    this.guidanceLoading = false;
    this.cdr.markForCheck();
  }

  private clearGuidanceState(): void {
    this.unsubscribeGuidance();
    this.activeGuidanceLoc = '';
    this.guidanceDraft = '';
    this.guidanceLoading = false;
    this.guidanceSaving = false;
    this.guidanceError = '';
    this.guidanceSavedAt = null;
    this.guidanceUpdatedBy = '';
  }

  private unsubscribeGuidance(): void {
    this.guidanceSub?.unsubscribe();
    this.guidanceSub = undefined;
  }

  private toDate(value: LocationGuidanceDoc['updatedAt']): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate();
    }
    return null;
  }

  private async resolveOperatorId(): Promise<string> {
    const user = await this.auth.currentUser;
    if (!user) return 'UNKNOWN';
    const email = String(user.email || '').trim();
    const asp = email.toUpperCase().match(/ASP\d{4}/);
    if (asp) return asp[0];
    const name = String(user.displayName || '').trim();
    if (name) return name.substring(0, 24);
    return email.substring(0, 24) || 'UNKNOWN';
  }

  private getTodayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  private isIqcLocation(loc: string): boolean {
    return isIqcPrefixLocation(loc);
  }

  private normalizeLiveLocKey(loc: string): string {
    const locker = normalizeLockerLiveLocation(loc);
    if (locker) return locker;
    const ng = normalizeNgLiveLocation(loc);
    if (ng) return ng;
    const quality = normalizeQualityRackLiveLocation(loc);
    if (quality) return quality;
    return normalizeMixzoneLiveLocation(loc, this.knownShelves);
  }

  /** Mỗi mã chỉ giữ lần đổi vị trí mới nhất trong ngày (F71 → P thì hiện P, không còn F71). */
  private collapseLatestMovePerMaterial(moves: IqcLiveMove[]): IqcLiveMove[] {
    const latest = new Map<string, IqcLiveMove>();
    const sorted = [...moves].sort(
      (a, b) => (b.changedAt?.getTime() || 0) - (a.changedAt?.getTime() || 0)
    );
    for (const move of sorted) {
      const key = move.materialId || `${move.materialCode}\0${move.poNumber}`;
      if (!latest.has(key)) latest.set(key, move);
    }
    return Array.from(latest.values());
  }

  private async loadTodayIqcToShelfMoves(): Promise<IqcLiveMove[]> {
    const start = this.getTodayStart();
    const moves: IqcLiveMove[] = [];

    const pushMoveFromDoc = (doc: { data: () => unknown }): void => {
      const d = doc.data() as Record<string, unknown>;
      const fromLocation = String(d['fromLocation'] || '').trim();
      const toLocation = String(d['toLocation'] || '').trim();
      if (!fromLocation || !toLocation) return;

      moves.push({
        materialId: String(d['materialId'] || '').trim(),
        materialCode: String(d['materialCode'] || '').trim(),
        fromLocation,
        toLocation,
        poNumber: String(d['poNumber'] || '').trim(),
        changedAt: this.toDate(d['changedAt'] as LocationGuidanceDoc['updatedAt'])
      });
    };

    try {
      const snap = await this.firestore
        .collection(this.materialLocationHistoryCol, ref =>
          ref
            .where('factory', '==', this.factory)
            .where('changedAt', '>=', start)
            .orderBy('changedAt', 'desc')
            .limit(500)
        )
        .get()
        .toPromise();
      for (const doc of snap?.docs || []) {
        pushMoveFromDoc(doc);
      }
    } catch {
      const snap = await this.firestore
        .collection(this.materialLocationHistoryCol, ref =>
          ref.where('factory', '==', this.factory).limit(3000)
        )
        .get()
        .toPromise();
      for (const doc of snap?.docs || []) {
        const raw = doc.data() as Record<string, unknown>;
        const changedAt = this.toDate(raw['changedAt'] as LocationGuidanceDoc['updatedAt']);
        if (!changedAt || changedAt < start) continue;
        pushMoveFromDoc(doc);
      }
    }

    return moves.sort(
      (a, b) => (b.changedAt?.getTime() || 0) - (a.changedAt?.getTime() || 0)
    );
  }

  private findZoneForLocation(location: string): Element | null {
    const host = this.svgHost?.nativeElement;
    if (!host) return null;

    const raw = String(location || '').trim();
    if (!raw) return null;

    const parsed = parseWarehouseLocation(raw, this.knownShelves);
    const mixzoneShelf = resolveMixzoneShelfFromLocation(raw);
    const candidates = new Set<string>();
    candidates.add(raw);
    candidates.add(raw.toUpperCase());
    if (mixzoneShelf) {
      candidates.add(mixzoneShelf);
      if (mixzoneShelf !== 'P') candidates.add('P');
    }
    if (parsed?.shelf) candidates.add(parsed.shelf);
    if (parsed?.raw) candidates.add(parsed.raw);
    if (parsed?.shelf?.toUpperCase() === 'LOCKER') {
      candidates.add('Locker');
      if (parsed.slot) {
        candidates.add(`Locker${parsed.slot}`);
        candidates.add(`Locker+${parsed.slot}`);
      }
    }

    const asm3Shelf = resolveAsm3WarehouseShelf(raw);
    if (asm3Shelf) {
      candidates.add(asm3Shelf);
      const mapCell = mapAsm3ShelfToLayoutCell(asm3Shelf);
      if (mapCell) candidates.add(mapCell);
    }

    const compact = raw.toUpperCase().replace(/\s/g, '');
    candidates.add(compact);

    if (isNgPrefixLocation(compact)) {
      candidates.add('NG');
    }

    const qualityCell = resolveQualityRackLayoutCell(raw);
    if (qualityCell) candidates.add(qualityCell);

    const dotRackCell = mapDotRackLocationToMapCell(compact);
    if (dotRackCell) candidates.add(dotRackCell);

    const iqcPlusRef = extractIqcPlusRef(compact);
    if (iqcPlusRef) {
      candidates.add(iqcPlusRef);
      const iqcShelf = iqcPlusRef.match(/^([A-Z]+\d*)/)?.[1];
      if (iqcShelf) candidates.add(iqcShelf);
    }

    for (const term of candidates) {
      const zone =
        host.querySelector(`[data-loc="${term}"]`) ||
        host.querySelector(`[data-shelf="${term}"]`) ||
        this.findMapZone(term);
      if (zone) return zone;
    }

    return null;
  }

  jumpToLiveShelf(row: LiveShelfRow): void {
    if (!row.onMap) return;
    const zone = this.findZoneForLocation(row.toLocation);
    if (!zone) return;
    this.selectZoneElement(zone);
    zone.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  /** Chỉ tô ô kệ nhỏ — không tô khu Secured WH; MIXZONE P được tô các ô F7–G9 bên trong. */
  private resolveLiveHighlightTarget(zone: Element): Element | null {
    if (zone.getAttribute('data-shelf')) {
      const inner = zone.querySelector('rect:not(.lw-slot-marker)') as SVGRectElement | null;
      if (inner && this.isLiveHighlightRect(inner)) return zone;
    }

    const loc = String(zone.getAttribute('data-loc') || '').trim();
    if (
      zone.getAttribute('data-zone-border') === 'mixzone' ||
      zone.getAttribute('data-zone-border') === 'ng' ||
      loc === 'P' ||
      loc === 'NG'
    ) {
      return zone;
    }

    if (!loc || loc.includes(' ')) return null;

    const rect = zone.querySelector('rect:not(.lw-slot-marker)') as SVGRectElement | null;
    if (!rect || !this.isLiveHighlightRect(rect)) return null;

    return zone;
  }

  private isLiveHighlightRect(rect: SVGRectElement): boolean {
    const w = Number(rect.getAttribute('width') || 0);
    const h = Number(rect.getAttribute('height') || 0);
    return w <= 25 && h <= 35;
  }

  private clearLiveHighlights(): void {
    const host = this.svgHost?.nativeElement;
    if (!host) return;
    host.querySelectorAll('.lw-zone--live').forEach(el => el.classList.remove('lw-zone--live'));
    host.querySelectorAll('title.lw-live-title').forEach(el => el.remove());
    host.querySelector('#lw-live-layer')?.remove();
  }

  private applyLiveHighlights(moves: IqcLiveMove[]): void {
    this.clearLiveHighlights();
    this.liveShelfCount = 0;
    this.liveUnmappedCount = 0;
    this.liveShelfRows = [];

    const effective = this.collapseLatestMovePerMaterial(moves);
    if (!effective.length) {
      this.cdr.markForCheck();
      return;
    }

    const groups = new Map<string, IqcLiveMove[]>();
    for (const move of effective) {
      const key = this.normalizeLiveLocKey(move.toLocation);
      const list = groups.get(key) || [];
      list.push(move);
      groups.set(key, list);
    }

    const ns = 'http://www.w3.org/2000/svg';
    const rows: LiveShelfRow[] = [];

    for (const [, groupMoves] of groups) {
      const displayLoc = this.normalizeLiveLocKey(groupMoves[0].toLocation);
      const codes = [...new Set(groupMoves.map(m => m.materialCode).filter(Boolean))];
      const count = groupMoves.length;

      const zone = this.findZoneForLocation(displayLoc === 'P' ? 'P' : groupMoves[0].toLocation);
      const target = zone ? this.resolveLiveHighlightTarget(zone) : null;

      if (!target) {
        this.liveUnmappedCount += 1;
        rows.push({
          toLocation: displayLoc,
          materialCodes: codes,
          count,
          onMap: false
        });
        continue;
      }

      this.markLiveHighlight(target, ns, `${displayLoc}: ${codes.join(', ')} (${count} mã)`);

      this.liveShelfCount += 1;
      rows.push({
        toLocation: displayLoc,
        materialCodes: codes,
        count,
        onMap: true
      });
    }

    this.liveShelfRows = rows.sort((a, b) =>
      a.toLocation.localeCompare(b.toLocation, 'vi', { numeric: true })
    );

    this.cdr.markForCheck();
  }

  private markLiveHighlight(target: Element, ns: string, titleText: string): void {
    target.classList.add('lw-zone--live');
    if (target.getAttribute('data-zone-border') === 'mixzone') {
      target.querySelectorAll('g[data-shelf]').forEach(el => el.classList.add('lw-zone--live'));
    }

    let titleEl = target.querySelector('title.lw-live-title');
    if (!titleEl) {
      titleEl = document.createElementNS(ns, 'title');
      titleEl.setAttribute('class', 'lw-live-title');
      target.insertBefore(titleEl, target.firstChild);
    }
    titleEl.textContent = titleText;
  }

  private clearHeatmapHighlights(): void {
    const host = this.svgHost?.nativeElement;
    if (!host) return;
    host.querySelectorAll('.lw-zone--heatmap').forEach(el => {
      el.classList.remove('lw-zone--heatmap');
      el.querySelectorAll('rect').forEach(rect => {
        const r = rect as SVGRectElement;
        r.style.removeProperty('fill');
        r.style.removeProperty('stroke');
        r.style.removeProperty('stroke-width');
      });
    });
    host.querySelectorAll('title.lw-heatmap-title').forEach(el => el.remove());
    host.querySelectorAll('.lw-heatmap-count-label').forEach(el => el.remove());
  }

  private applyHeatmapHighlights(
    shelfCounts: Map<string, Set<string>>,
    asm3Total: Set<string>
  ): void {
    this.clearHeatmapHighlights();
    this.heatmapMaxCount = 0;
    this.heatmapShelfCount = 0;
    this.heatmapRows = [];
    this.asm3HeatmapTotal = asm3Total.size;

    if (!shelfCounts.size && !asm3Total.size) {
      this.cdr.markForCheck();
      return;
    }

    const host = this.svgHost?.nativeElement;
    if (!host) return;

    const ns = 'http://www.w3.org/2000/svg';
    const rows: HeatmapShelfRow[] = [];

    for (const [, codes] of shelfCounts) {
      if (codes.size > this.heatmapMaxCount) this.heatmapMaxCount = codes.size;
    }
    const max = this.heatmapMaxCount;

    for (const [shelf, codes] of shelfCounts) {
      const count = codes.size;
      const mapCell = mapAsm3ShelfToLayoutCell(shelf) || shelf;
      const zone =
        this.findZoneForLocation(mapCell) ||
        this.findZoneForLocation(shelf);
      const target = zone ? this.resolveLiveHighlightTarget(zone) : null;
      if (!target) continue;

      const { fill, stroke } = this.heatmapColors(count, max);
      this.paintHeatmapTarget(
        target,
        fill,
        stroke,
        ns,
        `${shelf}: ${count} mã`,
        count
      );

      this.heatmapShelfCount += 1;
      rows.push({
        shelf,
        codeCount: count,
        materialCodes: [...codes].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))
      });
    }

    this.heatmapRows = rows.sort(
      (a, b) => b.codeCount - a.codeCount || a.shelf.localeCompare(b.shelf, 'vi', { numeric: true })
    );
    this.cdr.markForCheck();
  }

  private paintHeatmapTarget(
    target: Element,
    fill: string,
    stroke: string,
    ns: string,
    titleText: string,
    count: number
  ): void {
    const paintRects = (el: Element): void => {
      el.classList.add('lw-zone--heatmap');
      el.setAttribute('data-heat-count', String(count));
      el.querySelectorAll('rect:not(.lw-slot-marker)').forEach(rect => {
        const r = rect as SVGRectElement;
        r.style.fill = fill;
        r.style.stroke = stroke;
        r.style.strokeWidth = '1px';
      });
    };

    if (target.getAttribute('data-zone-border') === 'mixzone') {
      target.querySelectorAll('g[data-shelf]').forEach(el => paintRects(el));
    } else {
      paintRects(target);
    }

    let titleEl = target.querySelector('title.lw-heatmap-title');
    if (!titleEl) {
      titleEl = document.createElementNS(ns, 'title');
      titleEl.setAttribute('class', 'lw-heatmap-title');
      target.insertBefore(titleEl, target.firstChild);
    }
    titleEl.textContent = titleText;

    if (count > 0) {
      const rect = target.querySelector('rect:not(.lw-slot-marker)') as SVGRectElement | null;
      if (rect) {
        const x = Number(rect.getAttribute('x') || 0);
        const y = Number(rect.getAttribute('y') || 0);
        const w = Number(rect.getAttribute('width') || 10);
        const h = Number(rect.getAttribute('height') || 10);
        let labelEl = target.querySelector('.lw-heatmap-count-label');
        if (!labelEl) {
          labelEl = document.createElementNS(ns, 'text');
          labelEl.setAttribute('class', 'lw-heatmap-count-label');
          target.appendChild(labelEl);
        }
        labelEl.setAttribute('x', String(x + w - 0.5));
        labelEl.setAttribute('y', String(y + 3.2));
        labelEl.setAttribute('font-size', String(Math.min(4.5, w * 0.35)));
        labelEl.setAttribute('text-anchor', 'end');
        labelEl.setAttribute('dominant-baseline', 'middle');
        labelEl.setAttribute('fill', '#1e3a8a');
        labelEl.setAttribute('font-weight', 'bold');
        labelEl.textContent = String(count);
      }
    }
  }

}
