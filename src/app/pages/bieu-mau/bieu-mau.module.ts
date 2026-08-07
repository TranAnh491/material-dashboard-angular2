import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { BieuMauComponent } from './bieu-mau.component';

const routes: Routes = [{ path: '', component: BieuMauComponent }];

@NgModule({
  declarations: [BieuMauComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes)],
  exports: [BieuMauComponent]
})
export class BieuMauModule {}
