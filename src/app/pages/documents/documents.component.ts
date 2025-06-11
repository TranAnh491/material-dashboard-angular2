import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

interface DocumentFile {
  title: string;
  url: string;
  category: string;
}

@Component({
  selector: 'app-documents',
  templateUrl: './documents.component.html',
  styleUrls: ['./documents.component.scss']
})
export class DocumentsComponent implements OnInit {

  documentList: DocumentFile[] = [
    {
      title: 'BẢNG KIỂM TRA NHIỆT ĐỘ, ĐỘ ẨM KHO ĐẶC BIỆT',
      url: 'https://docs.google.com/spreadsheets/d/1otX4VegyT7fdHMZqRLulBGoc-zmdP1bJLSuYHZAstEc/edit?gid=1531087093',
      category: 'Checklist Kho'
    }
    // Thêm các file khác vào đây
  ];

  selectedDocumentUrl: SafeResourceUrl | null = null;

  constructor(private sanitizer: DomSanitizer) { }

  ngOnInit(): void {
  }

  selectDocument(doc: DocumentFile): void {
    const embedUrl = doc.url.includes('?') ? `${doc.url}&rm=minimal` : `${doc.url}?rm=minimal`;
    this.selectedDocumentUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }

  closeDocument(): void {
    this.selectedDocumentUrl = null;
  }
}
