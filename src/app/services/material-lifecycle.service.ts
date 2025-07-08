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
  WorkOrderStatus
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
      ref => ref.where('isRead', '==', false)
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
      ref => ref.where('materialId', '==', materialId)
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
        
        // Convert Firestore timestamps to proper Date objects
        const workOrder = { id, ...data };
        
        // Convert delivery date
        if (workOrder.deliveryDate) {
          if (workOrder.deliveryDate instanceof Date) {
            // Already a Date object
          } else if ((workOrder.deliveryDate as any)?.toDate) {
            // Firestore Timestamp
            workOrder.deliveryDate = (workOrder.deliveryDate as any).toDate();
          } else if ((workOrder.deliveryDate as any)?.seconds) {
            // Firestore Timestamp format
            workOrder.deliveryDate = new Date((workOrder.deliveryDate as any).seconds * 1000);
          } else if (typeof workOrder.deliveryDate === 'string') {
            // String date
            workOrder.deliveryDate = new Date(workOrder.deliveryDate);
          } else {
            // Fallback for unknown format
            workOrder.deliveryDate = new Date(workOrder.deliveryDate as any);
          }
          
          // Validate and fallback
          if (!workOrder.deliveryDate || isNaN(workOrder.deliveryDate.getTime())) {
            console.warn('Invalid delivery date for work order:', id, 'Raw value:', data.deliveryDate);
            workOrder.deliveryDate = new Date();
          }
        }
        
        // Convert plan received date
        if (workOrder.planReceivedDate) {
          if (workOrder.planReceivedDate instanceof Date) {
            // Already a Date object
          } else if ((workOrder.planReceivedDate as any)?.toDate) {
            // Firestore Timestamp
            workOrder.planReceivedDate = (workOrder.planReceivedDate as any).toDate();
          } else if ((workOrder.planReceivedDate as any)?.seconds) {
            // Firestore Timestamp format
            workOrder.planReceivedDate = new Date((workOrder.planReceivedDate as any).seconds * 1000);
          } else if (typeof workOrder.planReceivedDate === 'string') {
            // String date
            workOrder.planReceivedDate = new Date(workOrder.planReceivedDate);
          } else {
            // Fallback for unknown format
            workOrder.planReceivedDate = new Date(workOrder.planReceivedDate as any);
          }
          
          // Validate and fallback
          if (!workOrder.planReceivedDate || isNaN(workOrder.planReceivedDate.getTime())) {
            console.warn('Invalid plan received date for work order:', id, 'Raw value:', data.planReceivedDate);
            workOrder.planReceivedDate = new Date();
          }
        }
        
        // Convert created date
        if (workOrder.createdDate) {
          if (workOrder.createdDate instanceof Date) {
            // Already a Date object
          } else if ((workOrder.createdDate as any)?.toDate) {
            // Firestore Timestamp
            workOrder.createdDate = (workOrder.createdDate as any).toDate();
          } else if ((workOrder.createdDate as any)?.seconds) {
            // Firestore Timestamp format
            workOrder.createdDate = new Date((workOrder.createdDate as any).seconds * 1000);
          } else if (typeof workOrder.createdDate === 'string') {
            // String date
            workOrder.createdDate = new Date(workOrder.createdDate);
          } else {
            // Fallback for unknown format
            workOrder.createdDate = new Date(workOrder.createdDate as any);
          }
          
          // Validate and fallback
          if (!workOrder.createdDate || isNaN(workOrder.createdDate.getTime())) {
            workOrder.createdDate = new Date();
          }
        }
        
        // Convert last updated date
        if (workOrder.lastUpdated) {
          if (workOrder.lastUpdated instanceof Date) {
            // Already a Date object
          } else if ((workOrder.lastUpdated as any)?.toDate) {
            // Firestore Timestamp
            workOrder.lastUpdated = (workOrder.lastUpdated as any).toDate();
          } else if ((workOrder.lastUpdated as any)?.seconds) {
            // Firestore Timestamp format
            workOrder.lastUpdated = new Date((workOrder.lastUpdated as any).seconds * 1000);
          } else if (typeof workOrder.lastUpdated === 'string') {
            // String date
            workOrder.lastUpdated = new Date(workOrder.lastUpdated);
          } else {
            // Fallback for unknown format
            workOrder.lastUpdated = new Date(workOrder.lastUpdated as any);
          }
          
          // Validate and fallback
          if (!workOrder.lastUpdated || isNaN(workOrder.lastUpdated.getTime())) {
            workOrder.lastUpdated = new Date();
          }
        }
        
        console.log('Work order after date conversion:', {
          id: workOrder.id,
          orderNumber: workOrder.orderNumber,
          deliveryDate: workOrder.deliveryDate,
          planReceivedDate: workOrder.planReceivedDate,
          deliveryDateType: typeof workOrder.deliveryDate,
          planReceivedDateType: typeof workOrder.planReceivedDate
        });
        
        return workOrder;
      }))
    );
  }

  getWorkOrderById(id: string): Observable<WorkOrder> {
    return this.workOrdersCollection.doc(id).valueChanges().pipe(
      map(workOrder => ({ id, ...workOrder }))
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
    console.log('🔄 MaterialLifecycleService.addWorkOrder called with:', {
      orderNumber: workOrder.orderNumber,
      productCode: workOrder.productCode,
      customer: workOrder.customer,
      status: workOrder.status
    });
    
    try {
      // Add timestamps
    workOrder.createdDate = new Date();
    workOrder.lastUpdated = new Date();
      
      // Validate required fields before sending to Firebase
      if (!workOrder.orderNumber) {
        throw new Error('Order number is required');
      }
      if (!workOrder.productCode) {
        throw new Error('Product code is required');
      }
      if (!workOrder.customer) {
        throw new Error('Customer is required');
      }
      
      console.log('📤 Sending work order to Firebase Firestore...');
      console.log('🔍 Full work order data:', JSON.stringify(workOrder, null, 2));
      
      // Add timeout wrapper to the Firebase operation
      const savePromise = this.workOrdersCollection.add(workOrder);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Firebase save timeout after 10 seconds')), 10000);
      });
      
      // Race between save and timeout
      return Promise.race([savePromise, timeoutPromise])
        .then((result) => {
          console.log('✅ Firebase save successful!', result);
          console.log('🆔 Document ID:', (result as any)?.id);
          return result;
        })
        .catch((error) => {
          console.error('❌ Firebase save failed!', error);
          console.error('🔍 Error details:', {
            code: error?.code,
            message: error?.message,
            stack: error?.stack,
            name: error?.name
          });
          
          // Re-throw with more context
          throw new Error(`Firebase save failed: ${error?.message || error}`);
        });
        
    } catch (error) {
      console.error('❌ Pre-Firebase validation failed:', error);
      throw error;
    }
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
          waiting: workOrders.filter(wo => wo.status === WorkOrderStatus.WAITING).length,
          kitting: workOrders.filter(wo => wo.status === WorkOrderStatus.KITTING).length,
          ready: workOrders.filter(wo => wo.status === WorkOrderStatus.READY).length,
          done: workOrders.filter(wo => wo.status === WorkOrderStatus.DONE).length,
          delay: workOrders.filter(wo => wo.status === WorkOrderStatus.DELAY).length,
          totalQuantity: workOrders.reduce((sum, wo) => sum + wo.quantity, 0)
        };
        return summary;
      })
    );
  }
} 