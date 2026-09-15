import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { WorkScheduleComponent } from './work-schedule.component';

const routes: Routes = [
  { path: '', component: WorkScheduleComponent }
];

@NgModule({
  declarations: [WorkScheduleComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes)]
})
export class WorkScheduleModule {}
