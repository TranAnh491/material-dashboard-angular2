import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { Task, TaskLabel, TaskAssignee, TaskPriority, TaskStatus, AVAILABLE_USERS } from '../models/task.model';
import { SimpleTaskExportService } from './simple-task-export.service';

@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private tasks: Task[] = [];

  private tasksSubject = new BehaviorSubject<Task[]>(this.tasks);
  tasks$ = this.tasksSubject.asObservable();

  constructor(private exportService: SimpleTaskExportService) { }

  getTasks(): Observable<Task[]> {
    return this.tasks$;
  }

  async updateTask(task: Task) {
    const index = this.tasks.findIndex(t => t.id === task.id);
    if (index !== -1) {
      const oldTask = this.tasks[index];
      const updatedTask = { ...task, updatedAt: new Date() };
      
      this.tasks[index] = updatedTask;
      this.tasksSubject.next(this.tasks);

      // Nếu task được chuyển sang status "done", lưu vào local storage
      if (oldTask.status !== 'done' && updatedTask.status === 'done') {
        this.exportService.addCompletedTask(updatedTask);
      }
    }
  }

  addTask(task: Task) {
    this.tasks.push(task);
    this.tasksSubject.next(this.tasks);
  }

  deleteTask(taskId: string) {
    this.tasks = this.tasks.filter(task => task.id !== taskId);
    this.tasksSubject.next(this.tasks);
  }

  // Excel Export Methods
  exportCompletedTasksToExcel(): void {
    this.exportService.exportToExcel();
  }

  getCompletedTasksLocal(): any[] {
    return this.exportService.getCompletedTasks();
  }

  getTaskStatistics() {
    return this.exportService.getStatistics();
  }

  clearCompletedTasks(): void {
    this.exportService.clearCompletedTasks();
  }
} 