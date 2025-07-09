import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { Task, TaskLabel, TaskAssignee, TaskPriority, TaskStatus, AVAILABLE_USERS } from '../models/task.model';

@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private tasks: Task[] = [
    {
      id: '1',
      title: 'Implement Authentication',
      description: 'Add user authentication using Firebase',
      status: 'todo',
      priority: 'HIGH',
      labels: [
        { id: 'l1', name: 'Feature', color: '#4CAF50' },
        { id: 'l2', name: 'Security', color: '#F44336' }
      ],
      creator: AVAILABLE_USERS[0],
      assignees: [AVAILABLE_USERS[0]],
      deadline: new Date('2024-03-01'),
      checklist: [
        {
          id: 'cl1',
          content: 'Research authentication providers',
          completed: true
        },
        {
          id: 'cl2',
          content: 'Implement login flow',
          completed: false
        },
        {
          id: 'cl3',
          content: 'Add password reset functionality',
          completed: false
        }
      ],
      subtasks: [
        {
          id: 'st1',
          title: 'Setup Firebase Config',
          description: 'Configure Firebase authentication settings',
          status: 'todo',
          assignee: AVAILABLE_USERS[0],
          completed: false,
          createdAt: new Date()
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: '2',
      title: 'Design Dashboard Layout',
      description: 'Create responsive dashboard layout with Material Design',
      status: 'in-progress',
      priority: 'MEDIUM',
      labels: [
        { id: 'l3', name: 'UI/UX', color: '#2196F3' }
      ],
      creator: AVAILABLE_USERS[1],
      assignees: [AVAILABLE_USERS[1], AVAILABLE_USERS[2]],
      checklist: [
        {
          id: 'cl4',
          content: 'Create responsive grid layout',
          completed: true
        },
        {
          id: 'cl5',
          content: 'Implement dark mode',
          completed: false
        }
      ],
      subtasks: [],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: '3',
      title: 'Write unit tests',
      description: 'Add comprehensive unit tests for core components',
      status: 'done',
      priority: 'LOW',
      labels: [
        { id: 'l4', name: 'Testing', color: '#FF9800' }
      ],
      creator: AVAILABLE_USERS[3],
      assignees: [AVAILABLE_USERS[3]],
      checklist: [
        {
          id: 'cl6',
          content: 'Set up testing environment',
          completed: true
        },
        {
          id: 'cl7',
          content: 'Write tests for auth service',
          completed: true
        },
        {
          id: 'cl8',
          content: 'Write tests for user service',
          completed: true
        }
      ],
      subtasks: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

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