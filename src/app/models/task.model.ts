export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

export interface TaskAssignee {
  id: string;
  name: string;
  avatar: string;
  email: string;
}

export interface ChecklistItem {
  id: string;
  content: string;
  completed: boolean;
}

export interface SubTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: TaskAssignee;
  completed: boolean;
  createdAt: Date;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  labels: TaskLabel[];
  creator: TaskAssignee;
  assignees: TaskAssignee[];
  deadline?: Date;
  checklist: ChecklistItem[];
  subtasks: SubTask[];
  createdAt: Date;
  updatedAt: Date;
}

// Danh sách người dùng có sẵn
export const AVAILABLE_USERS: TaskAssignee[] = [
  {
    id: 'user1',
    name: 'Tuấn Anh',
    avatar: 'assets/img/faces/marc.jpg',
    email: 'tuananh@example.com'
  },
  {
    id: 'user2', 
    name: 'Hồng Anh',
    avatar: 'assets/img/faces/marc.jpg',
    email: 'honganh@example.com'
  },
  {
    id: 'user3',
    name: 'Phương Trâm',
    avatar: 'assets/img/faces/marc.jpg', 
    email: 'phuongtram@example.com'
  },
  {
    id: 'user4',
    name: 'Mai Hằng',
    avatar: 'assets/img/faces/marc.jpg',
    email: 'maihang@example.com'
  }
];

export interface TaskColumn {
  id: string;
  title: string;
  taskIds: string[];
}

export interface TaskBoard {
  id: string;
  title: string;
  columns: TaskColumn[];
  tasks: { [key: string]: Task };
} 