import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { Task, TaskLabel, TaskAssignee, TaskPriority, TaskStatus, AVAILABLE_USERS } from '../models/task.model';

@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private tasks: Task[] = [];

  private tasksSubject = new BehaviorSubject<Task[]>(this.tasks);
  tasks$ = this.tasksSubject.asObservable();

  constructor() { }

  getTasks(): Observable<Task[]> {
    return this.tasks$;
  }

  updateTask(task: Task) {
    const index = this.tasks.findIndex(t => t.id === task.id);
    if (index !== -1) {
      this.tasks[index] = task;
      this.tasksSubject.next(this.tasks);
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
} 