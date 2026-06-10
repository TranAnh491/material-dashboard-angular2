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
  FINISHED_GOODS_GUIDANCE
} from './layout-warehouse-location.util';



interface MaterialLocationHit {

  materialCode: string;

  location: string;

  poNumber?: string;

  stock?: number;

}



interface SearchResultInfo {
  materialCode?: string;
  location: string;
  shelf: string;
  slot: string | null;
  hitCount?: number;
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

  liveModeActive = false;
  liveLoading = false;
  liveError = '';
  liveMoves: IqcLiveMove[] = [];
  liveShelfCount = 0;
  liveUnmappedCount = 0;
  liveShelfRows: LiveShelfRow[] = [];

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
    private ruleCheckService: LocationRuleCheckService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }



  ngOnInit(): void {

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



      alert(`Không tìm thấy mã hàng hoặc vị trí "${term}"`);

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

  async refreshLiveMoves(): Promise<void> {
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

  async checkRuleStorage(): Promise<void> {
    this.isRuleChecking = true;
    this.ruleCheckError = '';
    this.ruleCheckResult = null;
    this.violationGroups = [];
    this.clearRuleViolationHighlights();

    try {
      const result = await this.ruleCheckService.checkInventoryAgainstRules(this.factory as 'ASM1');
      this.ruleCheckResult = result;
      this.violationGroups = this.buildViolationGroups(result.violations);
      this.highlightRuleViolations(result.violations);
    } catch (err) {
      this.ruleCheckError = (err as Error)?.message || String(err);
    } finally {
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
      `Không có rule,${result.skippedNoRule}`,
      `Không có vị trí,${result.skippedEmptyLocation}`,
      '',
      ['Vị trí', 'Mã hàng', 'PO', 'Lý do', 'Kệ đúng'].map(esc).join(',')
    ];

    for (const v of result.violations) {
      lines.push(
        [v.location, v.materialCode, v.poNumber || '', v.reason, v.expectedLabel].map(esc).join(',')
      );
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
    for (const v of violations) {
      const loc = v.location.toUpperCase();
      const parsed = parseWarehouseLocation(loc, this.knownShelves);
      const candidates: Element[] = [];

      if (parsed) {
        const shelf =
          host.querySelector(`[data-loc="${parsed.shelf}"]`) ||
          host.querySelector(`[data-shelf="${parsed.shelf}"]`);
        if (shelf) candidates.push(shelf);
      }

      const exact = host.querySelector(`[data-loc="${loc}"]`);
      if (exact) candidates.push(exact);

      Array.from(host.querySelectorAll('[data-loc]')).forEach(el => {
        const dataLoc = String(el.getAttribute('data-loc') || '').toUpperCase();
        if (loc.startsWith(dataLoc) || dataLoc.startsWith(loc)) {
          candidates.push(el);
        }
      });

      for (const el of candidates) {
        if (seen.has(el)) continue;
        seen.add(el);
        el.classList.add('lw-zone--violation');
      }
    }
  }

  private clearRuleViolationHighlights(): void {
    const host = this.svgHost?.nativeElement;
    host?.querySelectorAll('.lw-zone--violation').forEach(el => {
      el.classList.remove('lw-zone--violation');
    });
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
    const dotRackCell = mapDotRackLocationToMapCell(upper);

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
    } else if (isFinishedGoodsShelf(this.activeGuidanceLoc, this.knownShelves)) {
      this.guidanceDraft = FINISHED_GOODS_GUIDANCE;
    } else {
      this.guidanceDraft = '';
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
    return String(loc || '').replace(/\s/g, '').toUpperCase();
  }

  private async loadTodayIqcToShelfMoves(): Promise<IqcLiveMove[]> {
    const start = this.getTodayStart();
    const moves: IqcLiveMove[] = [];

    const pushMoveFromDoc = (doc: { data: () => unknown }): void => {
      const d = doc.data() as Record<string, unknown>;
      const fromLocation = String(d['fromLocation'] || '').trim();
      const toLocation = String(d['toLocation'] || '').trim();
      if (!fromLocation || !toLocation) return;
      if (!this.isIqcLocation(fromLocation)) return;
      if (this.isIqcLocation(toLocation)) return;

      moves.push({
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
    const candidates = new Set<string>();
    candidates.add(raw);
    candidates.add(raw.toUpperCase());
    if (parsed?.shelf) candidates.add(parsed.shelf);
    if (parsed?.raw) candidates.add(parsed.raw);

    const compact = raw.toUpperCase().replace(/\s/g, '');
    candidates.add(compact);

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

  /** Chỉ tô ô kệ nhỏ — không tô khu vực lớn (Secured WH, IQC, …). */
  private resolveLiveHighlightTarget(zone: Element): Element | null {
    const shelf = zone.getAttribute('data-shelf')
      ? (zone.closest('[data-loc]') as Element) || zone
      : zone;

    const loc = String(shelf.getAttribute('data-loc') || '').trim();
    if (!loc || loc.includes(' ')) return null;

    const rect = shelf.querySelector('rect:not(.lw-slot-marker)') as SVGRectElement | null;
    if (!rect) return null;

    const w = Number(rect.getAttribute('width') || 0);
    const h = Number(rect.getAttribute('height') || 0);
    if (w > 25 || h > 35) return null;

    return shelf;
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

    if (!moves.length) {
      this.cdr.markForCheck();
      return;
    }

    const groups = new Map<string, IqcLiveMove[]>();
    for (const move of moves) {
      const key = this.normalizeLiveLocKey(move.toLocation);
      const list = groups.get(key) || [];
      list.push(move);
      groups.set(key, list);
    }

    const ns = 'http://www.w3.org/2000/svg';
    const rows: LiveShelfRow[] = [];

    for (const [, groupMoves] of groups) {
      const sample = groupMoves[0];
      const codes = [...new Set(groupMoves.map(m => m.materialCode).filter(Boolean))];
      const count = groupMoves.length;

      const zone = this.findZoneForLocation(sample.toLocation);
      const target = zone ? this.resolveLiveHighlightTarget(zone) : null;

      if (!target) {
        this.liveUnmappedCount += 1;
        rows.push({
          toLocation: sample.toLocation,
          materialCodes: codes,
          count,
          onMap: false
        });
        continue;
      }

      target.classList.add('lw-zone--live');

      const titleText = `${sample.toLocation}: ${codes.join(', ')} (${count} lần)`;
      let titleEl = target.querySelector('title.lw-live-title');
      if (!titleEl) {
        titleEl = document.createElementNS(ns, 'title');
        titleEl.setAttribute('class', 'lw-live-title');
        target.insertBefore(titleEl, target.firstChild);
      }
      titleEl.textContent = titleText;

      this.liveShelfCount += 1;
      rows.push({
        toLocation: sample.toLocation,
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

}


