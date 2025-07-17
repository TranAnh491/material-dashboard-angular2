import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { DeleteConfirmationDialogComponent, DeleteDialogData } from '../components/delete-confirmation-dialog/delete-confirmation-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class DeleteConfirmationService {

  constructor(private dialog: MatDialog) { }

  /**
   * Opens a delete confirmation dialog with authentication
   * @param title Dialog title
   * @param message Confirmation message
   * @param itemName Optional item name to highlight
   * @returns Observable<boolean> - true if confirmed and authenticated, false otherwise
   */
  confirmDelete(title: string, message: string, itemName?: string): Observable<boolean> {
    const dialogData: DeleteDialogData = {
      title,
      message,
      itemName
    };

    const dialogRef = this.dialog.open(DeleteConfirmationDialogComponent, {
      width: '450px',
      maxWidth: '90vw',
      disableClose: true,
      data: dialogData
    });

    return dialogRef.afterClosed();
  }

  /**
   * Convenience method for standard delete confirmation
   * @param itemType Type of item being deleted (e.g., 'nhân viên', 'báo cáo')
   * @param itemName Name of the specific item
   * @returns Observable<boolean>
   */
  confirmDeleteItem(itemType: string, itemName: string): Observable<boolean> {
    return this.confirmDelete(
      `Xác nhận xóa ${itemType}`,
      `Bạn có chắc chắn muốn xóa ${itemType} này không? Hành động này không thể hoàn tác.`,
      itemName
    );
  }

  /**
   * Convenience method for record deletion
   * @param recordName Name of the record
   * @returns Observable<boolean>
   */
  confirmDeleteRecord(recordName: string): Observable<boolean> {
    return this.confirmDelete(
      'Xác nhận xóa bản ghi',
      'Bạn có chắc chắn muốn xóa bản ghi này không? Tất cả dữ liệu liên quan sẽ bị mất và không thể khôi phục.',
      recordName
    );
  }

  /**
   * Convenience method for multiple items deletion
   * @param count Number of items to delete
   * @param itemType Type of items
   * @returns Observable<boolean>
   */
  confirmDeleteMultiple(count: number, itemType: string): Observable<boolean> {
    return this.confirmDelete(
      `Xác nhận xóa ${count} ${itemType}`,
      `Bạn có chắc chắn muốn xóa ${count} ${itemType} đã chọn không? Hành động này không thể hoàn tác.`
    );
  }
} 