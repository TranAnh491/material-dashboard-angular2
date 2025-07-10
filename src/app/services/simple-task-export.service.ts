import { Injectable } from '@angular/core';
import { Task } from '../models/task.model';
import * as XLSX from 'xlsx';

export interface CompletedTaskData {
  id: string;
  title: string;
  description: string;
  priority: string;
  creator: string;
  assignees: string;
  labels: string;
  createdAt: Date;
  completedAt: Date;
  completionDuration: number;
  deadline?: Date;
  subtasksCount: number;
  checklistTotal: number;
  checklistCompleted: number;
}

@Injectable({
  providedIn: 'root'
})
export class SimpleTaskExportService {
  private completedTasks: CompletedTaskData[] = [];

  constructor() { }

  // Thêm completed task vào danh sách local
  addCompletedTask(task: Task): void {
    const completedTask: CompletedTaskData = {
      id: task.id,
      title: task.title,
      description: task.description || '',
      priority: this.translatePriority(task.priority),
      creator: task.creator.name,
      assignees: task.assignees.map(a => a.name).join(', '),
      labels: task.labels.map(l => l.name).join(', '),
      createdAt: task.createdAt,
      completedAt: new Date(),
      completionDuration: this.calculateCompletionDuration(task.createdAt, new Date()),
      deadline: task.deadline,
      subtasksCount: task.subtasks.length,
      checklistTotal: task.checklist.length,
      checklistCompleted: task.checklist.filter(c => c.completed).length
    };

    this.completedTasks.push(completedTask);
    console.log('✅ Task completed and stored locally:', task.title);
    console.log('📊 Total completed tasks:', this.completedTasks.length);
  }

  // Lấy danh sách completed tasks
  getCompletedTasks(): CompletedTaskData[] {
    return this.completedTasks;
  }

  // Export Excel
  exportToExcel(): void {
    try {
      if (this.completedTasks.length === 0) {
        alert('Chưa có task nào được hoàn thành để export!');
        return;
      }

      // Chuẩn bị dữ liệu cho Excel
      const excelData = this.completedTasks.map(task => ({
        'ID': task.id,
        'Tên Task': task.title,
        'Mô tả': task.description,
        'Độ ưu tiên': task.priority,
        'Người tạo': task.creator,
        'Người được giao': task.assignees,
        'Labels': task.labels,
        'Ngày tạo': this.formatDate(task.createdAt),
        'Ngày hoàn thành': this.formatDate(task.completedAt),
        'Thời gian hoàn thành (ngày)': task.completionDuration,
        'Deadline': task.deadline ? this.formatDate(task.deadline) : '',
        'Số subtasks': task.subtasksCount,
        'Số checklist items': task.checklistTotal,
        'Checklist hoàn thành': task.checklistCompleted
      }));

      // Tạo workbook
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Completed Tasks');

      // Set column widths
      const colWidths = [
        { wch: 15 }, // ID
        { wch: 30 }, // Tên Task
        { wch: 40 }, // Mô tả
        { wch: 15 }, // Độ ưu tiên
        { wch: 20 }, // Người tạo
        { wch: 30 }, // Người được giao
        { wch: 20 }, // Labels
        { wch: 15 }, // Ngày tạo
        { wch: 15 }, // Ngày hoàn thành
        { wch: 20 }, // Thời gian hoàn thành
        { wch: 15 }, // Deadline
        { wch: 15 }, // Số subtasks
        { wch: 15 }, // Số checklist
        { wch: 20 }  // Checklist hoàn thành
      ];
      ws['!cols'] = colWidths;

      // Tạo tên file với timestamp
      const fileName = `completed_tasks_${this.formatDateForFile(new Date())}.xlsx`;

      // Download file
      XLSX.writeFile(wb, fileName);
      
      console.log(`✅ Exported ${this.completedTasks.length} completed tasks to Excel`);
      alert(`Đã export ${this.completedTasks.length} task hoàn thành vào file Excel!`);
    } catch (error) {
      console.error('❌ Error exporting to Excel:', error);
      alert('Lỗi khi export Excel: ' + error);
    }
  }

  // Clear completed tasks
  clearCompletedTasks(): void {
    this.completedTasks = [];
    console.log('🗑️ Cleared all completed tasks');
  }

  // Get statistics
  getStatistics() {
    return {
      total: this.completedTasks.length,
      byPriority: {
        high: this.completedTasks.filter(t => t.priority === 'Cao').length,
        medium: this.completedTasks.filter(t => t.priority === 'Trung bình').length,
        low: this.completedTasks.filter(t => t.priority === 'Thấp').length
      },
      averageCompletionTime: this.completedTasks.length > 0 
        ? Math.round(this.completedTasks.reduce((sum, t) => sum + t.completionDuration, 0) / this.completedTasks.length)
        : 0
    };
  }

  private calculateCompletionDuration(startDate: Date, endDate: Date): number {
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  private translatePriority(priority: string): string {
    switch (priority) {
      case 'HIGH': return 'Cao';
      case 'MEDIUM': return 'Trung bình';
      case 'LOW': return 'Thấp';
      default: return priority;
    }
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private formatDateForFile(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }
} 