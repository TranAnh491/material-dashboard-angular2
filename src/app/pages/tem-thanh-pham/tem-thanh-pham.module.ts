import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TemThanhPhamComponent } from './tem-thanh-pham.component';
import { TemShellComponent } from './tem-shell.component';
import { TemPrintHistoryComponent } from './tem-print-history.component';

@NgModule({
  declarations: [TemShellComponent, TemThanhPhamComponent, TemPrintHistoryComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      {
        path: '',
        component: TemShellComponent,
        children: [
          { path: '', component: TemThanhPhamComponent },
          { path: 'lich-su', component: TemPrintHistoryComponent }
        ]
      }
    ])
  ]
})
export class TemThanhPhamModule {}
