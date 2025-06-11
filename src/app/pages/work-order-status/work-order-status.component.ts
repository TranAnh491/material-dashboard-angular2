import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss']
})
export class WorkOrderStatusComponent implements OnInit {
  
  SHEET_URL_FOR_EDITING = 'https://docs.google.com/spreadsheets/d/17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84/edit?gid=0';
  embeddedSheetUrl: SafeResourceUrl | null = null;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    // Hiển thị trực tiếp Google Sheet khi component được tải
    const embedUrl = `${this.SHEET_URL_FOR_EDITING}&rm=minimal`;
    this.embeddedSheetUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }
}
