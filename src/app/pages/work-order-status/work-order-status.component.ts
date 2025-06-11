import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit {
  
  SHEET_ID = '17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84';
  SHEET_GID = '0'; // GID for "W.O Masss" sheet
  
  embeddedSheetUrl: SafeResourceUrl | null = null;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    // Using widget=true and headers=false is a more reliable way to hide the sheet navigation
    const baseUrl = `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/edit`;
    const params = `?gid=${this.SHEET_GID}&widget=true&headers=false`;
    
    const embedUrl = `${baseUrl}${params}`;
    
    this.embeddedSheetUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }
}
