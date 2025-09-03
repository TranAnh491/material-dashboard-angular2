import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';

export interface FGPreparingItem {
  id?: string;
  factory?: string;
  importDate: Date;
  batchNumber: string;
  materialCode: string;
  rev: string;
  lot: string;
  lsx: string;
  quantity: number;
  location: string;
  notes: string;
  standard: number;
  carton: number;
  odd: number;
  customer: string;
  isPrepared: boolean;
  preparedDate?: Date;
  preparedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-fg-preparing',
  templateUrl: './fg-preparing.component.html',
  styleUrls: ['./fg-preparing.component.scss']
})
export class FGPreparingComponent implements OnInit, OnDestroy {
  materials: FGPreparingItem[] = [];
  filteredMaterials: FGPreparingItem[] = [];
  
  // Search and filter
  searchTerm = '';
  
  // Factory filter - FG Preparing is only for ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  private destroy$ = new Subject<void>();
  
  // Loading state
  isLoading: boolean = false;

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService
  ) {}

  ngOnInit(): void {
    this.loadMaterialsFromFirebase();
    this.loadPermissions();
    this.loadFactoryAccess();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load materials from Firebase
  loadMaterialsFromFirebase(): void {
    this.isLoading = true;
    
    this.firestore.collection('fg-preparing')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          
          return {
            id: id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            batchNumber: data.batchNumber || data.batch || '',
            materialCode: data.materialCode || data.maTP || '',
            rev: data.rev || '',
            lot: data.lot || data.Lot || '',
            lsx: data.lsx || data.LSX || '',
            quantity: data.quantity || 0,
            location: data.location || data.viTri || 'Temporary',
            notes: data.notes || data.ghiChu || '',
            standard: data.standard || 0,
            carton: data.carton || 0,
            odd: data.odd || 0,
            customer: data.customer || data.khach || '',
            isPrepared: data.isPrepared || false,
            preparedDate: data.preparedDate ? new Date(data.preparedDate.seconds * 1000) : undefined,
            preparedBy: data.preparedBy || '',
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.materials = firebaseMaterials;
        this.sortMaterials();
        this.applyFilters();
        this.isLoading = false;
      });
  }

  // Sort materials by material code and batch
  sortMaterials(): void {
    this.materials.sort((a, b) => {
      // First sort by material code (A-Z)
      const materialCompare = a.materialCode.localeCompare(b.materialCode);
      if (materialCompare !== 0) {
        return materialCompare;
      }
      
      // Then sort by batch number
      return a.batchNumber.localeCompare(b.batchNumber);
    });
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      // Show all materials if no search term
      if (!this.searchTerm || this.searchTerm.trim() === '') {
        return true;
      }
      
      // Filter by search term
      const searchableText = [
        material.materialCode,
        material.batchNumber,
        material.location,
        material.lsx,
        material.lot,
        material.rev,
        material.notes,
        material.customer
      ].filter(Boolean).join(' ').toUpperCase();
      
      if (!searchableText.includes(this.searchTerm)) {
        return false;
      }

      // Filter by factory
      if (this.selectedFactory) {
        const materialFactory = material.factory || 'ASM1';
        if (materialFactory !== this.selectedFactory) {
          return false;
        }
      }

      return true;
    });
  }

  // Search functionality
  onSearchChange(event: any): void {
    let searchTerm = event.target.value;
    
    // Auto-convert to uppercase
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      event.target.value = searchTerm;
    }
    
    this.searchTerm = searchTerm;
    this.applyFilters();
  }

  // Format number with commas for thousands
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    
    return value.toLocaleString('vi-VN');
  }

  // Load user permissions
  loadPermissions(): void {
    this.hasDeletePermission = true;
    this.hasCompletePermission = true;
  }

  // Load factory access
  loadFactoryAccess(): void {
    this.factoryAccessService.getAvailableFactories().subscribe(access => {
      if (access && access.length > 0) {
        this.availableFactories = access;
        this.selectedFactory = access[0];
      }
    });
  }

  // Check if material can be edited
  canEditMaterial(material: FGPreparingItem): boolean {
    return !material.isPrepared;
  }

  // Mark material as prepared
  markAsPrepared(material: FGPreparingItem): void {
    if (material.isPrepared) {
      return;
    }

    material.isPrepared = true;
    material.preparedDate = new Date();
    material.preparedBy = 'Current User'; // TODO: Get actual user
    material.updatedAt = new Date();

    this.updateMaterialInFirebase(material);
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FGPreparingItem): void {
    if (!material.id) {
      console.error('Cannot update material without ID');
      return;
    }

    const updateData = {
      ...material,
      importDate: material.importDate,
      preparedDate: material.preparedDate,
      updatedAt: new Date()
    };
    
    delete updateData.id;
    
    this.firestore.collection('fg-preparing').doc(material.id).update(updateData)
      .then(() => {
        console.log('FG Preparing material updated successfully');
      })
      .catch(error => {
        console.error('Error updating FG Preparing material:', error);
      });
  }

  // Delete material
  deleteItem(material: FGPreparingItem): void {
    if (!material.id) {
      console.error('Cannot delete material without ID');
      return;
    }

    this.firestore.collection('fg-preparing').doc(material.id).delete()
      .then(() => {
        const index = this.materials.findIndex(m => m.id === material.id);
        if (index > -1) {
          this.materials.splice(index, 1);
          this.applyFilters();
        }
        console.log('FG Preparing material deleted successfully');
      })
      .catch(error => {
        console.error('Error deleting FG Preparing material:', error);
      });
  }

  // Update notes
  updateNotes(material: FGPreparingItem): void {
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
  }

  // Update location
  updateLocation(material: FGPreparingItem, newLocation: string): void {
    material.location = newLocation;
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
  }

  // Edit location (placeholder for future implementation)
  editLocation(material: FGPreparingItem): void {
    const newLocation = prompt('Nhập vị trí mới:', material.location || '');
    if (newLocation !== null && newLocation.trim() !== '') {
      this.updateLocation(material, newLocation.trim());
    }
  }
}
