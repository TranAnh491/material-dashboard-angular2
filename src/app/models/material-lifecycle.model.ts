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