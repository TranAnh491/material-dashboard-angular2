import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';

// Material Modules
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';

// Components
import { TaskBoardComponent } from './task-board/task-board.component';
import { AddLabelDialogComponent } from './dialogs/add-label-dialog/add-label-dialog.component';
import { AddAssigneeDialogComponent } from './dialogs/add-assignee-dialog/add-assignee-dialog.component';
import { AddTaskDialogComponent } from './dialogs/add-task-dialog/add-task-dialog.component';

@NgModule({
  declarations: [
    TaskBoardComponent,
    AddLabelDialogComponent,
    AddAssigneeDialogComponent,
    AddTaskDialogComponent
  ],
  imports: [
    CommonModule,
    RouterModule.forChild([
      { path: '', component: TaskBoardComponent }
    ]),
    FormsModule,
    ReactiveFormsModule,
    DragDropModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatChipsModule,
    MatCheckboxModule,
    MatButtonToggleModule,
    MatTooltipModule,
    MatDialogModule,
    MatListModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatProgressBarModule,
    MatDividerModule
  ]
})
export class TaskModule { } 