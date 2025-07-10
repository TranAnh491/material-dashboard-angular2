import { Component, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../../services/task.service';
import { Task, TaskPriority, TaskStatus, ChecklistItem, SubTask } from '../../../models/task.model';
import { AddTaskDialogComponent } from '../dialogs/add-task-dialog/add-task-dialog.component';

@Component({
  selector: 'app-task-board',
  templateUrl: './task-board.component.html',
  styleUrls: ['./task-board.component.scss']
})
export class TaskBoardComponent implements OnInit {
  tasks: Task[] = [];
  searchText = '';
  taskStatuses: TaskStatus[] = ['todo', 'in-progress', 'done'];
  expandedTasks: Set<string> = new Set(); // Track which tasks are expanded

  constructor(
    private taskService: TaskService,
    private dialog: MatDialog
  ) {}

  ngOnInit() {
    this.taskService.getTasks().subscribe(tasks => {
      this.tasks = tasks;
    });
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return this.tasks.filter(task => 
      task.status === status && 
      (this.searchText === '' || 
        task.title.toLowerCase().includes(this.searchText.toLowerCase()) ||
        task.description?.toLowerCase().includes(this.searchText.toLowerCase())
      )
    );
  }

  getConnectedLists(): string[] {
    return this.taskStatuses;
  }

  getPriorityIcon(priority: TaskPriority): string {
    switch (priority) {
      case 'HIGH':
        return 'priority_high';
      case 'MEDIUM':
        return 'drag_handle';
      case 'LOW':
        return 'arrow_downward';
      default:
        return 'drag_handle';
    }
  }

  openNewTaskDialog() {
    const dialogRef = this.dialog.open(AddTaskDialogComponent, {
      width: '500px',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.taskService.addTask(result);
      }
    });
  }

  editTask(task: Task) {
    // TODO: Implement edit task dialog
    console.log('Edit task:', task);
  }

  deleteTask(task: Task) {
    const confirmDelete = confirm('Are you sure you want to delete this task?');
    if (confirmDelete) {
      this.taskService.deleteTask(task.id);
    }
  }

  toggleTaskExpansion(taskId: string) {
    if (this.expandedTasks.has(taskId)) {
      this.expandedTasks.delete(taskId);
    } else {
      this.expandedTasks.add(taskId);
    }
  }

  isTaskExpanded(taskId: string): boolean {
    return this.expandedTasks.has(taskId);
  }

  addSubTask(task: Task) {
    const newSubTask: SubTask = {
      id: Date.now().toString(),
      title: 'New Subtask',
      description: '',
      status: task.status,
      completed: false,
      createdAt: new Date()
    };
    
    const updatedTask = {
      ...task,
      subtasks: [...task.subtasks, newSubTask]
    };
    
    this.taskService.updateTask(updatedTask);
  }

  toggleSubTaskCompletion(task: Task, subtask: SubTask) {
    const updatedTask = {
      ...task,
      subtasks: task.subtasks.map(st => 
        st.id === subtask.id ? { ...st, completed: !st.completed } : st
      )
    };
    
    this.taskService.updateTask(updatedTask);
  }

  getChecklistProgress(task: Task): number {
    if (!task.checklist || task.checklist.length === 0) return 0;
    const completedItems = task.checklist.filter(item => item.completed).length;
    return (completedItems / task.checklist.length) * 100;
  }

  getCompletedItems(task: Task): number {
    return task.checklist.filter(item => item.completed).length;
  }

  updateChecklistItem(task: Task, item: ChecklistItem) {
    const updatedTask = {
      ...task,
      checklist: task.checklist.map(i => 
        i.id === item.id ? { ...i, completed: item.completed } : i
      )
    };
    this.taskService.updateTask(updatedTask);
  }

  drop(event: CdkDragDrop<Task[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );

      // Update task status when moved to a different column
      const task = event.container.data[event.currentIndex];
      const newStatus = event.container.id as TaskStatus;
      const updatedTask = { ...task, status: newStatus };
      this.taskService.updateTask(updatedTask);
    }
  }

  filterTasks() {
    // The filtering is handled in getTasksByStatus
  }

  exportToExcel() {
    console.log('Starting Excel export...');
    this.taskService.exportCompletedTasksToExcel();
  }
} 