import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Task, TaskAssignee, AVAILABLE_USERS } from '../../../../models/task.model';

@Component({
  selector: 'app-add-task-dialog',
  templateUrl: './add-task-dialog.component.html',
  styleUrls: ['./add-task-dialog.component.scss']
})
export class AddTaskDialogComponent {
  availableUsers = AVAILABLE_USERS;
  
  taskData: Partial<Task> = {
    title: '',
    description: '',
    priority: 'MEDIUM',
    creator: this.availableUsers[0], // Default to first user
    assignees: [],
    deadline: undefined
  };

  constructor(
    public dialogRef: MatDialogRef<AddTaskDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  onCreate(): void {
    if (this.isValid()) {
      const newTask: Task = {
        id: Date.now().toString(),
        title: this.taskData.title!,
        description: this.taskData.description || '',
        status: 'todo',
        priority: this.taskData.priority!,
        labels: [],
        creator: this.taskData.creator!,
        assignees: this.taskData.assignees || [],
        deadline: this.taskData.deadline,
        checklist: [],
        subtasks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.dialogRef.close(newTask);
    }
  }

  isValid(): boolean {
    return !!(this.taskData.title && this.taskData.creator && this.taskData.priority);
  }
} 