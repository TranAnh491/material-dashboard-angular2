import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FgStorageDiagramModalComponent } from './fg-storage-diagram-modal.component';

@NgModule({
  declarations: [FgStorageDiagramModalComponent],
  imports: [CommonModule, FormsModule],
  exports: [FgStorageDiagramModalComponent]
})
export class FgStorageSharedModule {}
