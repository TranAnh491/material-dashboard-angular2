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
export interface WorkOrder {
  id?: string;
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
  checkedBy?: string;
  planReceivedDate: Date;
  notes?: string;
  createdDate: Date;
  lastUpdated: Date;
  // New fields for the updated format
  isUrgent?: boolean;
  missingMaterials?: string;
  materialsComplete?: boolean;
  materialsStatus?: 'sufficient' | 'insufficient'; // Đủ/Thiếu
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
  TRANSFER = 'transfer',
  DONE = 'done',
  DELAY = 'delay'
} 