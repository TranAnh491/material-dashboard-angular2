import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import {
  WAREHOUSE_TRAINING_MANUAL_PAGES,
  ManualPage,
  MANUAL_DOC_META
} from './warehouse-training-manual.data';

type ManualPageView = ManualPage & { flowRows?: string[][] };

@Component({
  selector: 'app-warehouse-manual',
  templateUrl: './warehouse-manual.component.html',
  styleUrls: ['./warehouse-manual.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseManualComponent implements OnInit {
  pages: ManualPageView[] = [];
  docMeta = MANUAL_DOC_META;
  selectedPageIndex = 0;
  logoSrc = '/assets/img/logo.png';
  printingAll = false;

  stepAcknowledged: Record<string, boolean> = {};
  flowAcknowledged: Record<string, boolean> = {};

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.pages = WAREHOUSE_TRAINING_MANUAL_PAGES.map(page => ({
      ...page,
      flowRows: page.flow ? this.buildFlowRows(page.flow) : undefined
    }));
  }

  get selectedPage(): ManualPageView {
    return this.pages[this.selectedPageIndex];
  }

  get totalPages(): number {
    return this.pages.length;
  }

  trackByIndex(index: number): number {
    return index;
  }

  trackByPageNum(_index: number, page: ManualPageView): number {
    return page.pageNum;
  }

  selectPage(index: number): void {
    this.selectedPageIndex = index;
    this.cdr.markForCheck();
  }

  prevPage(): void {
    if (this.selectedPageIndex > 0) {
      this.selectedPageIndex--;
      this.cdr.markForCheck();
    }
  }

  nextPage(): void {
    if (this.selectedPageIndex < this.pages.length - 1) {
      this.selectedPageIndex++;
      this.cdr.markForCheck();
    }
  }

  getStepKey(pageNum: number, stepNum: number): string {
    return `p${pageNum}-s${stepNum}`;
  }

  getFlowKey(pageNum: number, index: number): string {
    return `p${pageNum}-f${index}`;
  }

  onStepAckChange(key: string, checked: boolean): void {
    this.stepAcknowledged[key] = checked;
    this.cdr.markForCheck();
  }

  onFlowAckChange(key: string, checked: boolean): void {
    this.flowAcknowledged[key] = checked;
    this.cdr.markForCheck();
  }

  isStepAck(key: string): boolean {
    return !!this.stepAcknowledged[key];
  }

  isFlowAck(key: string): boolean {
    return !!this.flowAcknowledged[key];
  }

  private buildFlowRows(flow: string[], perRow = 7): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < flow.length; i += perRow) {
      rows.push(flow.slice(i, i + perRow));
    }
    return rows;
  }

  getFlowRowStartIndex(rowIndex: number, perRow = 7): number {
    return rowIndex * perRow;
  }

  resetAcknowledgments(): void {
    this.stepAcknowledged = {};
    this.flowAcknowledged = {};
    this.cdr.markForCheck();
  }

  printAll(): void {
    this.printingAll = true;
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      window.print();
      this.printingAll = false;
      this.cdr.markForCheck();
    });
  }

  printCurrent(): void {
    const el = document.getElementById('manualPrintArea');
    if (!el) {
      window.print();
      return;
    }
    el.classList.add('print-single-page');
    window.print();
    el.classList.remove('print-single-page');
  }
}
