import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { PdControlComponent } from './pd-control.component';

const routes: Routes = [{ path: '', component: PdControlComponent }];

@NgModule({
  declarations: [PdControlComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes)]
})
export class PdControlModule {}

