import { Component, OnInit, OnDestroy } from '@angular/core';
import { GoogleSheetService } from '../../services/google-sheet.service';
import { Subscription } from 'rxjs';
import { HttpClient } from '@angular/common/http';

interface RackLoading {
  position: string;
  maxCapacity: number;
  currentLoad: number;
  usage: number; // Percentage
  status: 'available' | 'normal' | 'warning' | 'critical';
  itemCount: number;
}

@Component({
  selector: 'app-utilization',
  templateUrl: './utilization.component.html',
  styleUrls: ['./utilization.component.scss']
})
export class UtilizationComponent implements OnInit, OnDestroy {
  
  // Rack Loading Data
  rackLoadingData: RackLoading[] = [];
  private rackDataSubscription: Subscription | undefined;
  isRefreshing: boolean = false;
  lastRackDataUpdate: Date | null = null;

  constructor(
    private googleSheetService: GoogleSheetService,
    private http: HttpClient
  ) { }

  ngOnInit(): void {
    this.initializeRackLoading();
  }

  ngOnDestroy(): void {
    if (this.rackDataSubscription) {
      this.rackDataSubscription.unsubscribe();
    }
  }

  private initializeRackLoading() {
    // Start with empty data - will be populated only with real data from Google Sheets
    this.rackLoadingData = [];

    // Load real data from Google Sheets
    this.loadRackDataFromGoogleSheets();
  }

  private loadRackDataFromGoogleSheets() {
    this.rackDataSubscription = this.googleSheetService.fetchRackLoadingWeights().subscribe({
      next: (rackWeights) => {
        console.log('📊 Loaded rack weights:', rackWeights.length, 'positions');
        this.updateRackLoadingFromWeights(rackWeights);
        this.lastRackDataUpdate = new Date();
      },
      error: (error) => {
        console.error('❌ Error loading rack data:', error);
      }
    });
  }

  refreshRackData() {
    this.isRefreshing = true;
    
    setTimeout(() => {
      this.loadRackDataFromGoogleSheets();
      this.isRefreshing = false;
    }, 1500);
  }

  private updateRackLoadingFromWeights(rackWeights: {position: string, weight: number}[]) {
    // Create rack loading data only for positions that have real data from Google Sheets
    this.rackLoadingData = rackWeights
      .filter(item => item.weight > 0) // Only include positions with actual weight
      .map(item => {
        // Set max capacity based on position - positions ending with '1' have 5000kg capacity
        const maxCapacity = item.position.endsWith('1') ? 5000 : 1300; // kg
        const usage = Math.round((item.weight / maxCapacity) * 100 * 10) / 10;
        
        return {
          position: item.position,
          maxCapacity: maxCapacity,
          currentLoad: Math.round(item.weight * 100) / 100,
          usage: usage,
          status: this.calculateRackStatus(usage),
          itemCount: Math.round(item.weight / 50) // Estimate item count (50kg average per item)
        };
      })
      .sort((a, b) => a.position.localeCompare(b.position)); // Sort by position name

    console.log('🔄 Created rack loading data for', this.rackLoadingData.length, 'positions with real weights');
  }

  private calculateRackStatus(usage: number): 'available' | 'normal' | 'warning' | 'critical' {
    if (usage >= 95) return 'critical';
    if (usage >= 80) return 'warning';
    if (usage >= 20) return 'normal';
    return 'available';
  }

  getRackStatusClass(usage: number): string {
    if (usage >= 95) return 'critical';
    if (usage >= 80) return 'warning';
    if (usage >= 20) return 'normal';
    return 'available';
  }

  getUsageBarClass(usage: number): string {
    if (usage >= 95) return 'critical';
    if (usage >= 80) return 'warning';
    if (usage >= 20) return 'normal';
    return 'available';
  }

  getRackStatusLabel(usage: number): string {
    if (usage >= 95) return 'Critical';
    if (usage >= 80) return 'Warning';
    if (usage >= 20) return 'Normal';
    return 'Available';
  }

  getTotalRacks(): number {
    return this.rackLoadingData.length;
  }

  getHighUsageRacks(): number {
    return this.rackLoadingData.filter(rack => rack.usage >= 95).length;
  }

  getAvailableRacks(): number {
    return this.rackLoadingData.filter(rack => rack.usage < 20).length;
  }

  getTotalWeight(): number {
    return this.rackLoadingData.reduce((sum, rack) => sum + rack.currentLoad, 0);
  }

  getOccupiedRacks(): number {
    return this.rackLoadingData.filter(rack => rack.usage >= 20).length;
  }

  getUseRate(): number {
    const totalCapacity = this.rackLoadingData.reduce((sum, rack) => sum + rack.maxCapacity, 0);
    const totalUsed = this.getTotalWeight();
    return totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 100) : 0;
  }
} 