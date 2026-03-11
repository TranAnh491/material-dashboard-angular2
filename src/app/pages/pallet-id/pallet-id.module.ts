import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { PalletIdComponent } from './pallet-id.component';

@NgModule({
  declarations: [PalletIdComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: PalletIdComponent }
    ])
  ],
  exports: [PalletIdComponent]
})
export class PalletIdModule { }
