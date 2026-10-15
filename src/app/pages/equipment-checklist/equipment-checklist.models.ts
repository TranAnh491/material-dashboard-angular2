export type EquipmentStatus = 'ACTIVE' | 'REPAIR' | 'INACTIVE' | 'SPARE' | 'DISPOSED';
export type InspectionResult = 'PASS' | 'FAIL' | 'NA' | 'NOT_CHECKED';
export type InspectionFrequency = 'daily' | 'weekly' | 'monthly';
export type EquipmentCheckBy = 'computer' | 'qr';
export type MaintenanceBy = 'internal' | 'external';
export type MaintenanceCycle = 'month' | 'quarter' | 'half' | 'year' | 'custom';

export interface Equipment {
  equipmentId: string;
  stt: number;
  categoryId: string;
  subcategoryId: string;
  equipmentName: string;
  managementCode: string;
  responsiblePerson: string | null;
  /** Mã ASP để nhắc Zalo. Trống nếu chưa gán. */
  responsibleEmployeeId: string | null;
  frequency: InspectionFrequency;
  status: EquipmentStatus;
  /** Máy tính: tick trên danh sách. QR: kiểm tra bằng điện thoại, không tick trên máy tính. */
  checkBy?: EquipmentCheckBy;
  /** Nội bộ hoặc bên ngoài. Trống nếu chưa chọn. */
  maintenanceBy?: MaintenanceBy | null;
  /** Cả nội bộ và bên ngoài: 1 tháng, quý, 6 tháng, 1 năm, hoặc tùy chọn. */
  maintenanceCycle?: MaintenanceCycle | null;
  /** Ngày bắt đầu khi chu kỳ là tùy chọn. */
  maintenanceStartDate?: string | null;
  /** Số ngày lặp lại khi chu kỳ là tùy chọn. */
  maintenanceRepeatDays?: number | null;
  /** Hạng mục riêng của máy này. Không có thì dùng hạng mục của nhóm con. */
  inspectionItems?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ChecklistItem {
  checklistId: string;
  subcategoryId: string;
  itemName: string;
  sequence: number;
  active: boolean;
}

export interface InspectionRecord {
  inspectionId: string;
  equipmentId: string;
  inspectionDate: string;
  inspector: string;
  result: InspectionResult;
  notes?: string;
  defectDescription?: string;
  correctiveAction?: string;
  imageUrl?: string;
  checkedItems?: string[];
  itemResults?: Array<{ itemName: string; result: 'PASS' | 'FAIL' | ''; note?: string }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface EquipmentStaff {
  employeeId: string;
  name: string;
}

export interface EquipmentCategory {
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
}
