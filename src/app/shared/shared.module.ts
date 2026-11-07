import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SafePipe } from '../pipes/safe.pipe';
import { TabBackButtonComponent } from './tab-back-button/tab-back-button.component';
import { ScanBurstDirective } from './scan-burst.directive';
import { ThousandDirective } from './thousand.directive';
import { LocUpdScanComponent } from './loc-upd-scan/loc-upd-scan.component';
import { WeekInputPopupComponent } from './week-input-popup/week-input-popup.component';
import { PageToolbarComponent } from './page-toolbar/page-toolbar.component';

@NgModule({
  declarations: [SafePipe, TabBackButtonComponent, ScanBurstDirective, ThousandDirective, LocUpdScanComponent, WeekInputPopupComponent, PageToolbarComponent],
  exports: [SafePipe, TabBackButtonComponent, ScanBurstDirective, ThousandDirective, LocUpdScanComponent, WeekInputPopupComponent, PageToolbarComponent],
  imports: [CommonModule, FormsModule]
})
export class SharedModule { }