import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafePipe } from '../pipes/safe.pipe';
import { TabBackButtonComponent } from './tab-back-button/tab-back-button.component';

@NgModule({
  declarations: [SafePipe, TabBackButtonComponent],
  exports: [SafePipe, TabBackButtonComponent],
  imports: [CommonModule]
})
export class SharedModule { }