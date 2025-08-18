import { Component, OnInit } from '@angular/core';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';

@Component({
  selector: 'app-access-debug',
  template: `
    <div class="debug-container" style="padding: 20px; background: #f8f9fa; border-radius: 8px; margin: 20px;">
      <h3>🔍 Access Debug Info</h3>
      
      <div style="margin: 20px 0; padding: 15px; background: white; border-radius: 6px; border: 1px solid #e0e0e0;">
        <h4>📋 Tab Permissions:</h4>
        <div *ngFor="let permission of tabPermissions | keyvalue" style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
          <span style="font-weight: 500; color: #333;">{{ permission.key }}</span>
          <span style="font-weight: bold; padding: 4px 8px; border-radius: 4px;" 
                [style.background]="permission.value ? '#d4edda' : '#f8d7da'"
                [style.color]="permission.value ? '#155724' : '#721c24'">
            {{ permission.value ? '✅ ALLOWED' : '❌ DENIED' }}
          </span>
        </div>
      </div>

      <div style="margin: 20px 0; padding: 15px; background: white; border-radius: 6px; border: 1px solid #e0e0e0;">
        <h4>🏭 Factory Access:</h4>
        <div style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
          ASM1: <span [style.background]="factoryAccess.canAccessASM1 ? '#d4edda' : '#f8d7da'"
                      [style.color]="factoryAccess.canAccessASM1 ? '#155724' : '#721c24'"
                      style="font-weight: bold; padding: 4px 8px; border-radius: 4px;">
            {{ factoryAccess.canAccessASM1 ? '✅ ALLOWED' : '❌ DENIED' }}
          </span>
        </div>
        <div style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
          ASM2: <span [style.background]="factoryAccess.canAccessASM2 ? '#d4edda' : '#f8d7da'"
                      [style.color]="factoryAccess.canAccessASM2 ? '#155724' : '#721c24'"
                      style="font-weight: bold; padding: 4px 8px; border-radius: 4px;">
            {{ factoryAccess.canAccessASM2 ? '✅ ALLOWED' : '❌ DENIED' }}
          </span>
        </div>
        <div style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
          Default: {{ factoryAccess.defaultFactory || 'None' }}
        </div>
        <div style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
          Available: {{ factoryAccess.availableFactories?.join(', ') || 'None' }}
        </div>
      </div>

      <div style="margin: 20px 0; padding: 15px; background: white; border-radius: 6px; border: 1px solid #e0e0e0;">
        <h4>🔧 Debug Actions:</h4>
        <button (click)="refreshData()" style="margin: 5px; padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
          🔄 Refresh Data
        </button>
        <button (click)="clearCache()" style="margin: 5px; padding: 8px 16px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
          🗑️ Clear Cache
        </button>
      </div>
    </div>
  `
})
export class AccessDebugComponent implements OnInit {
  tabPermissions: { [key: string]: boolean } = {};
  factoryAccess: any = {};

  constructor(
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService
  ) {}

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.tabPermissionService.getCurrentUserTabPermissions().subscribe(permissions => {
      this.tabPermissions = permissions;
      console.log('🔍 Tab Permissions loaded:', permissions);
    });

    this.factoryAccessService.getCurrentUserFactoryAccess().subscribe(access => {
      this.factoryAccess = access;
      console.log('🏭 Factory Access loaded:', access);
    });
  }

  refreshData() {
    console.log('🔄 Refreshing data...');
    this.loadData();
  }

  clearCache() {
    console.log('🗑️ Clearing cache...');
    // Có thể thêm logic clear cache nếu cần
    this.loadData();
  }
}
