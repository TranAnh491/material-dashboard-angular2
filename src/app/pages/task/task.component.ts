import { Component, OnInit } from '@angular/core';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Task {
  id?: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in-progress' | 'done';
}

@Component({
  selector: 'app-task',
  templateUrl: './task.component.html',
  styleUrls: ['./task.component.css']
})
export class TaskComponent implements OnInit {
  
  tasksCollection: AngularFirestoreCollection<Task>;
  
  todo: Task[] = [];
  inProgress: Task[] = [];
  done: Task[] = [];

  showAddModal = false;
  newTask: Partial<Task> = {
    title: '',
    description: '',
    priority: 'medium',
  };

  constructor(private afs: AngularFirestore) {
    this.tasksCollection = afs.collection<Task>('tasks');
  }

  ngOnInit(): void {
    this.tasksCollection.snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as Task;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    ).subscribe(tasks => {
      this.todo = tasks.filter(task => task.status === 'todo');
      this.inProgress = tasks.filter(task => task.status === 'in-progress');
      this.done = tasks.filter(task => task.status === 'done');
    });
  }

  drop(event: CdkDragDrop<Task[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      const movedTask = event.previousContainer.data[event.previousIndex];
      const newStatus = event.container.id as 'todo' | 'in-progress' | 'done';
      this.tasksCollection.doc(movedTask.id).update({ status: newStatus });

      transferArrayItem(event.previousContainer.data,
                        event.container.data,
                        event.previousIndex,
                        event.currentIndex);
    }
  }

  openAddModal() {
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
    this.newTask = { title: '', description: '', priority: 'medium' };
  }

  addTask() {
    if (this.newTask.title) {
      const taskToAdd: Task = {
        ...this.newTask,
        status: 'todo'
      } as Task;
      this.tasksCollection.add(taskToAdd);
      this.closeAddModal();
    }
  }

  deleteTask(taskId: string) {
    if (confirm('Are you sure you want to delete this task?')) {
      this.tasksCollection.doc(taskId).delete();
    }
  }
} 