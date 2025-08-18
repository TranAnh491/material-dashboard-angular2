import { Component, OnInit } from '@angular/core';
import { AccessControlService } from '../../services/access-control.service';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';

@Component({
  selector: 'app-access-test',
  template: `
    <div class="access-test-container">
      <h3>🔐 Access Control Test</h3>
      
      <div class="test-section">
        <h4>📋 Tab Permissions:</h4>
        <div *ngFor="let permission of tabPermissions | keyvalue" class="permission-item">
          <span class="tab-name">{{ permission.key }}</span>
          <span class="permission-value" [class.allowed]="permission.value" [class.denied]="!permission.value">
            {{ permission.value ? '✅ ALLOWED' : '❌ DENIED' }}
          </span>
        </div>
      </div>

      <div class="test-section">
        <h4>🏭 Factory Access:</h4>
        <div class="factory-info">
          <div>ASM1: <span [class.allowed]="factoryAccess.canAccessASM1" [class.denied]="!factoryAccess.canAccessASM1">
            {{ factoryAccess.canAccessASM1 ? '✅ ALLOWED' : '❌ DENIED' }}
          </span></div>
          <div>ASM2: <span [class.allowed]="factoryAccess.canAccessASM2" [class.denied]="!factoryAccess.canAccessASM2">
            {{ factoryAccess.canAccessASM2 ? '✅ ALLOWED' : '❌ DENIED' }}
          </span></div>
          <div>Default: {{ factoryAccess.defaultFactory || 'None' }}</div>
          <div>Available: {{ factoryAccess.availableFactories.join(', ') || 'None' }}</div>
        </div>
      </div>

      <div class="test-section">
        <h4>🔍 Access Test Results:</h4>
        <div *ngFor="let testTab of testTabs" class="access-test-item">
          <span class="tab-name">{{ testTab }}</span>
          <span class="access-result" [class.allowed]="accessResults[testTab]" [class.denied]="!accessResults[testTab]">
            {{ accessResults[testTab] ? '✅ ACCESS' : '❌ NO ACCESS' }}
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .access-test-container {
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
      margin: 20px;
    }
    
    .test-section {
      margin: 20px 0;
      padding: 15px;
      background: white;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
    }
    
    .permission-item, .access-test-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    
    .tab-name {
      font-weight: 500;
      color: #333;
    }
    
    .permission-value, .access-result {
      font-weight: bold;
      padding: 4px 8px;
      border-radius: 4px;
    }
    
    .allowed {
      background: #d4edda;
      color: #155724;
    }
    
    .denied {
      background: #f8d7da;
      color: #721c24;
    }
    
    .factory-info div {
      padding: 5px 0;
      border-bottom: 1px solid #f0f0f0;
    }
  `]
})
export class AccessTestComponent implements OnInit {
  tabPermissions: { [key: string]: boolean } = {};
  factoryAccess: any = {};
  accessResults: { [key: string]: boolean } = {};
  
  testTabs = [
    'inbound-asm1', 'inbound-asm2',
    'outbound-asm1', 'outbound-asm2',
    'materials-asm1', 'materials-asm2',
    'dashboard', 'settings'
  ];

  constructor(
    private accessControlService: AccessControlService,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService
  ) {}

  ngOnInit() {
    this.loadPermissions();
    this.loadFactoryAccess();
    this.testAccess();
  }

  private loadPermissions() {
    this.tabPermissionService.getCurrentUserTabPermissions().subscribe(permissions => {
      this.tabPermissions = permissions;
    });
  }

  private loadFactoryAccess() {
    this.factoryAccessService.getCurrentUserFactoryAccess().subscribe(access => {
      this.factoryAccess = access;
    });
  }

  private testAccess() {
    this.testTabs.forEach(tab => {
      this.accessControlService.canAccessTab(tab).subscribe(hasAccess => {
        this.accessResults[tab] = hasAccess;
      });
    });
  }
}
