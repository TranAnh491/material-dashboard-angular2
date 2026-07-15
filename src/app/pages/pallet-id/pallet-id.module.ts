import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { PalletIdComponent } from './pallet-id.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  declarations: [PalletIdComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: PalletIdComponent }
    ]),
    SharedModule
  ],
  exports: [PalletIdComponent]
})
export class PalletIdModule { }
