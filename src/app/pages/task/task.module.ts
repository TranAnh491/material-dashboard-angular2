import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

// Components
import { FlowWorkComponent } from './task-board/task-board.component';

@NgModule({
  declarations: [
    FlowWorkComponent
  ],
  imports: [
    CommonModule,
    RouterModule.forChild([
      { path: '', component: FlowWorkComponent }
    ])
  ]
})
export class TaskModule { } 