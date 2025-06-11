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
    // Construct the URL with gid in the fragment part for better reliability
    const baseUrl = `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/edit`;
    const params = `?single=true&rm=minimal`;
    const fragment = `#gid=${this.SHEET_GID}`;
    
    const embedUrl = `${baseUrl}${params}${fragment}`;
    
    this.embeddedSheetUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }
}
