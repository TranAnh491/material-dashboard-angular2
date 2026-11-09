export interface MaterialLifecycle {
  id?: string;
  materialCode: string;
  materialName: string;
  batchNumber: string;
  expiryDate: Date;
  manufacturingDate: Date;
  location: string;
  quantity: number;
  status: MaterialStatus;
  alertLevel: AlertLevel;
  supplier: string;
  costCenter: string;
  unitOfMeasure: string;
  lastUpdated: Date;
  createdBy?: string;
  notes?: string;
}

export enum MaterialStatus {
  ACTIVE = 'active',
  EXPIRING_SOON = 'expiring_soon', 
  EXPIRED = 'expired',
  CONSUMED = 'consumed',
  QUARANTINE = 'quarantine'
}

export enum AlertLevel {
  GREEN = 'green',
  YELLOW = 'yellow', 
  RED = 'red'
}

export interface MaterialAlert {
  id?: string;
  materialId: string;
  alertType: AlertType;
  message: string;
  severity: AlertLevel;
  isRead: boolean;
  createdAt: Date;
  dueDate?: Date;
}

export enum AlertType {
  EXPIRY_WARNING = 'expiry_warning',
  EXPIRED = 'expired',
  LOW_STOCK = 'low_stock',
  QUALITY_ISSUE = 'quality_issue'
}

export interface MaterialTransaction {
  id?: string;
  materialId: string;
  transactionType: TransactionType;
  quantity: number;
  location: string;
  timestamp: Date;
  performedBy: string;
  workOrder?: string;
  notes?: string;
}

export enum TransactionType {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  TRANSFER = 'transfer',
  ADJUSTMENT = 'adjustment',
  QUALITY_CHECK = 'quality_check'
}

// Work Order interfaces and enums
/** 1 dòng còn thiếu khi Xuất thiếu (LSX Partial) */
export interface WoPartialLine {
  code: string;
  po: string;
  /** Lượng PXK */
  need: number;
  /** Đã scan xuất tại thời điểm xuất thiếu */
  scan: number;
  /** Còn treo = need − scan */
  remain: number;
  unit: string;
}

/** 1 lần Xuất thiếu: phần đã xuất được ghi nhận, phần chưa xuất treo lại */
export interface WoPartialExport {
  at: Date | string;
  by: string;
  lines: WoPartialLine[];
}

export interface WorkOrder {
  id?: string;
  /** Cột Partial: cho phép xuất thiếu (không có trong form import) */
  partialAllowed?: boolean;
  /** Standard packing chốt lúc LSX sang Ready (mã NVL → Standard) — LSX đã Ready không theo Standard mới */
  stdSnapshot?: Record<string, number>;
  /** JIT: đã chia NVL nhiều lần giao (Lần 2/3) → Done thành JIT tới khi giao hết */
  jitActive?: boolean;
  /** JIT: kho đã tick Đã giao hết các lần */
  jitDelivered?: boolean;
  stdSnapshotAt?: Date | any;
  /** Phần còn treo của lần xuất thiếu gần nhất (null/không có = không treo) */
  partialPending?: WoPartialExport | null;
  /** Lịch sử các lần xuất thiếu */
  partialExports?: WoPartialExport[];
  factory?: string; // ASM1 or ASM2
  year: number;
  month: number;
  orderNumber: string;
  productCode: string;
  productionOrder: string;
  quantity: number;
  customer: string;
  deliveryDate: Date;
  productionLine: string;
  status: WorkOrderStatus;
  createdBy: string;
  /** Team soạn LSX — chọn trong cột Người soạn. */
  createdByTeam?: string;
  /** true khi Người soạn được gán từ người scan xuất kho (Settings / outbound). */
  createdByFromOutbound?: boolean;
  /** Mã nhân viên scan xuất (ASPxxxx). */
  createdByMemberId?: string;
  checkedBy?: string;
  planReceivedDate: Date;
  notes?: string;
  /** Lần import thứ mấy của cùng LSX trong 30 ngày (2, 3…); không có = lần đầu. LSX gốc giữ nguyên. */
  lsxSeq?: number;
  createdDate: Date;
  lastUpdated: Date;
  /** Thời điểm chuyển sang Kitting (nếu có) */
  kittingStartedAt?: Date;
  /** Thời điểm chuyển sang Ready (nếu có) */
  readyAt?: Date;
  /** Thời điểm chuyển sang Done (nếu có) */
  doneAt?: Date;
  // New fields for the updated format
  isUrgent?: boolean;
  missingMaterials?: string;
  materialsComplete?: boolean;
  materialsStatus?: 'sufficient' | 'insufficient'; // Đủ/Thiếu
  isCompleted?: boolean; // Flag to mark if manually completed
}

export enum FactoryType {
  ASM1 = 'ASM1',
  ASM2 = 'ASM2',
  ASM3 = 'ASM3'
}

export enum WorkOrderStatus {
  WAITING = 'waiting',
  KITTING = 'kitting',
  READY = 'ready',
  READY_IQC = 'ready-iqc',
  TRANSFER = 'transfer',
  DONE = 'done',
  DELAY = 'delay',
  /** Đã chia nhiều lần giao (JIT) — chưa giao hết; giao xong mới tự Done */
  JIT = 'jit'
} 