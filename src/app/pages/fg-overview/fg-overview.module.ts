import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { FgOverviewComponent } from './fg-overview.component';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [{ path: '', component: FgOverviewComponent }];

@NgModule({
  declarations: [FgOverviewComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes), SharedModule]
})
export class FgOverviewModule {}
