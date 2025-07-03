import { Injectable } from '@angular/core';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { 
  MaterialLifecycle, 
  MaterialAlert, 
  MaterialTransaction, 
  MaterialStatus, 
  AlertLevel,
  AlertType,
  TransactionType,
  WorkOrder,
  WorkOrderStatus,
  FactoryType
} from '../models/material-lifecycle.model';

@Injectable({
  providedIn: 'root'
})
export class MaterialLifecycleService {
  private materialsCollection: AngularFirestoreCollection<MaterialLifecycle>;
  private alertsCollection: AngularFirestoreCollection<MaterialAlert>;
  private transactionsCollection: AngularFirestoreCollection<MaterialTransaction>;
  private workOrdersCollection: AngularFirestoreCollection<WorkOrder>;

  constructor(private firestore: AngularFirestore) {
    this.materialsCollection = firestore.collection<MaterialLifecycle>('materials');
    this.alertsCollection = firestore.collection<MaterialAlert>('material-alerts');
    this.transactionsCollection = firestore.collection<MaterialTransaction>('material-transactions');
    this.workOrdersCollection = firestore.collection<WorkOrder>('work-orders');
  }

  // Materials CRUD Operations
  getMaterials(): Observable<MaterialLifecycle[]> {
    return this.materialsCollection.snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as MaterialLifecycle;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getMaterialById(id: string): Observable<MaterialLifecycle> {
    return this.materialsCollection.doc(id).valueChanges().pipe(
      map(material => ({ id, ...material }))
    );
  }

  addMaterial(material: MaterialLifecycle): Promise<any> {
    material.lastUpdated = new Date();
    material.alertLevel = this.calculateAlertLevel(material.expiryDate);
    material.status = this.calculateStatus(material.expiryDate, material.quantity);
    
    return this.materialsCollection.add(material).then(docRef => {
      this.checkAndCreateAlerts(docRef.id, material);
      this.addTransaction({
        materialId: docRef.id,
        transactionType: TransactionType.INBOUND,
        quantity: material.quantity,
        location: material.location,
        timestamp: new Date(),
        performedBy: material.createdBy || 'System',
        notes: 'Material added to system'
      });
      return docRef;
    });
  }

  updateMaterial(id: string, material: Partial<MaterialLifecycle>): Promise<void> {
    material.lastUpdated = new Date();
    if (material.expiryDate) {
      material.alertLevel = this.calculateAlertLevel(material.expiryDate);
      material.status = this.calculateStatus(material.expiryDate, material.quantity || 0);
    }
    
    return this.materialsCollection.doc(id).update(material).then(() => {
      this.checkAndCreateAlerts(id, material as MaterialLifecycle);
    });
  }

  deleteMaterial(id: string): Promise<void> {
    return this.materialsCollection.doc(id).delete();
  }

  // Search and Filter
  searchMaterials(searchTerm: string): Observable<MaterialLifecycle[]> {
    return this.getMaterials().pipe(
      map(materials => materials.filter(material =>
        material.materialCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        material.materialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        material.batchNumber.toLowerCase().includes(searchTerm.toLowerCase())
      ))
    );
  }

  getMaterialsByStatus(status: MaterialStatus): Observable<MaterialLifecycle[]> {
    return this.firestore.collection<MaterialLifecycle>('materials', 
      ref => ref.where('status', '==', status)
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as MaterialLifecycle;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getMaterialsByLocation(location: string): Observable<MaterialLifecycle[]> {
    return this.firestore.collection<MaterialLifecycle>('materials',
      ref => ref.where('location', '==', location)
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as MaterialLifecycle;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  // Alert Management
  getAlerts(): Observable<MaterialAlert[]> {
    return this.alertsCollection.snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as MaterialAlert;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getUnreadAlerts(): Observable<MaterialAlert[]> {
    return this.firestore.collection<MaterialAlert>('material-alerts',
      ref => ref.where('isRead', '==', false).orderBy('createdAt', 'desc')
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as MaterialAlert;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  markAlertAsRead(alertId: string): Promise<void> {
    return this.alertsCollection.doc(alertId).update({ isRead: true });
  }

  // Transaction Management  
  getTransactions(): Observable<MaterialTransaction[]> {
    return this.transactionsCollection.snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as MaterialTransaction;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getTransactionsByMaterial(materialId: string): Observable<MaterialTransaction[]> {
    return this.firestore.collection<MaterialTransaction>('material-transactions',
      ref => ref.where('materialId', '==', materialId).orderBy('timestamp', 'desc')
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as MaterialTransaction;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  addTransaction(transaction: MaterialTransaction): Promise<any> {
    return this.transactionsCollection.add(transaction);
  }

  // Analytics
  getExpiringMaterials(days: number = 30): Observable<MaterialLifecycle[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    
    return this.getMaterials().pipe(
      map(materials => materials.filter(material => {
        const expiryDate = new Date(material.expiryDate);
        return expiryDate <= futureDate && expiryDate > new Date();
      }))
    );
  }

  getExpiredMaterials(): Observable<MaterialLifecycle[]> {
    return this.getMaterials().pipe(
      map(materials => materials.filter(material => 
        new Date(material.expiryDate) < new Date()
      ))
    );
  }

  getMaterialsSummary(): Observable<any> {
    return this.getMaterials().pipe(
      map(materials => {
        const summary = {
          total: materials.length,
          active: materials.filter(m => m.status === MaterialStatus.ACTIVE).length,
          expiringSoon: materials.filter(m => m.status === MaterialStatus.EXPIRING_SOON).length,
          expired: materials.filter(m => m.status === MaterialStatus.EXPIRED).length,
          quarantine: materials.filter(m => m.status === MaterialStatus.QUARANTINE).length,
          totalValue: materials.reduce((sum, m) => sum + (m.quantity || 0), 0)
        };
        return summary;
      })
    );
  }

  // Helper Methods
  private calculateAlertLevel(expiryDate: Date): AlertLevel {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) return AlertLevel.RED;
    if (daysUntilExpiry <= 7) return AlertLevel.RED;
    if (daysUntilExpiry <= 30) return AlertLevel.YELLOW;
    return AlertLevel.GREEN;
  }

  private calculateStatus(expiryDate: Date, quantity: number): MaterialStatus {
    if (quantity <= 0) return MaterialStatus.CONSUMED;
    
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) return MaterialStatus.EXPIRED;
    if (daysUntilExpiry <= 30) return MaterialStatus.EXPIRING_SOON;
    return MaterialStatus.ACTIVE;
  }

  private checkAndCreateAlerts(materialId: string, material: MaterialLifecycle): void {
    const today = new Date();
    const expiry = new Date(material.expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // Create expiry alerts
    if (daysUntilExpiry <= 0) {
      this.alertsCollection.add({
        materialId,
        alertType: AlertType.EXPIRED,
        message: `Material ${material.materialCode} has expired`,
        severity: AlertLevel.RED,
        isRead: false,
        createdAt: new Date()
      });
    } else if (daysUntilExpiry <= 7) {
      this.alertsCollection.add({
        materialId,
        alertType: AlertType.EXPIRY_WARNING,
        message: `Material ${material.materialCode} expires in ${daysUntilExpiry} days`,
        severity: AlertLevel.RED,
        isRead: false,
        createdAt: new Date(),
        dueDate: expiry
      });
    } else if (daysUntilExpiry <= 30) {
      this.alertsCollection.add({
        materialId,
        alertType: AlertType.EXPIRY_WARNING,
        message: `Material ${material.materialCode} expires in ${daysUntilExpiry} days`,
        severity: AlertLevel.YELLOW,
        isRead: false,
        createdAt: new Date(),
        dueDate: expiry
      });
    }

    // Create low stock alerts
    if (material.quantity <= 10) {
      this.alertsCollection.add({
        materialId,
        alertType: AlertType.LOW_STOCK,
        message: `Low stock alert for ${material.materialCode}: ${material.quantity} ${material.unitOfMeasure} remaining`,
        severity: AlertLevel.YELLOW,
        isRead: false,
        createdAt: new Date()
      });
    }
  }

  // Work Order Management
  getWorkOrders(): Observable<WorkOrder[]> {
    return this.workOrdersCollection.snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as WorkOrder;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getWorkOrderById(id: string): Observable<WorkOrder> {
    return this.workOrdersCollection.doc(id).valueChanges().pipe(
      map(workOrder => ({ id, ...workOrder }))
    );
  }

  getWorkOrdersByFactory(factory: FactoryType): Observable<WorkOrder[]> {
    return this.firestore.collection<WorkOrder>('work-orders',
      ref => ref.where('factory', '==', factory).orderBy('createdDate', 'desc')
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as WorkOrder;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getWorkOrdersByStatus(status: WorkOrderStatus): Observable<WorkOrder[]> {
    return this.firestore.collection<WorkOrder>('work-orders',
      ref => ref.where('status', '==', status)
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as WorkOrder;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  getWorkOrdersByDateRange(startDate: Date, endDate: Date): Observable<WorkOrder[]> {
    return this.firestore.collection<WorkOrder>('work-orders',
      ref => ref.where('deliveryDate', '>=', startDate).where('deliveryDate', '<=', endDate)
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as WorkOrder;
        const id = a.payload.doc.id;
        return { id, ...data };
      }))
    );
  }

  addWorkOrder(workOrder: WorkOrder): Promise<any> {
    workOrder.createdDate = new Date();
    workOrder.lastUpdated = new Date();
    return this.workOrdersCollection.add(workOrder);
  }

  updateWorkOrder(id: string, workOrder: Partial<WorkOrder>): Promise<void> {
    workOrder.lastUpdated = new Date();
    return this.workOrdersCollection.doc(id).update(workOrder);
  }

  deleteWorkOrder(id: string): Promise<void> {
    return this.workOrdersCollection.doc(id).delete();
  }

  searchWorkOrders(searchTerm: string): Observable<WorkOrder[]> {
    return this.getWorkOrders().pipe(
      map(workOrders => workOrders.filter(wo =>
        wo.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        wo.productCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        wo.productionOrder.toLowerCase().includes(searchTerm.toLowerCase()) ||
        wo.customer.toLowerCase().includes(searchTerm.toLowerCase())
      ))
    );
  }

  getWorkOrderSummary(): Observable<any> {
    return this.getWorkOrders().pipe(
      map(workOrders => {
        const summary = {
          total: workOrders.length,
          pending: workOrders.filter(wo => wo.status === WorkOrderStatus.PENDING).length,
          inProgress: workOrders.filter(wo => wo.status === WorkOrderStatus.IN_PROGRESS).length,
          completed: workOrders.filter(wo => wo.status === WorkOrderStatus.COMPLETED).length,
          onHold: workOrders.filter(wo => wo.status === WorkOrderStatus.ON_HOLD).length,
          cancelled: workOrders.filter(wo => wo.status === WorkOrderStatus.CANCELLED).length,
          totalQuantity: workOrders.reduce((sum, wo) => sum + wo.quantity, 0),
          byFactory: {
            ASM1: workOrders.filter(wo => wo.factory === FactoryType.ASM1).length,
            ASM2: workOrders.filter(wo => wo.factory === FactoryType.ASM2).length,
            ASM3: workOrders.filter(wo => wo.factory === FactoryType.ASM3).length
          }
        };
        return summary;
      })
    );
  }
} 