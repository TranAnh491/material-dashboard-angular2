import { Component, OnInit } from '@angular/core';

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
      url: 'https://docs.google.com/spreadsheets/d/1otX4VegyT7fdHMZqRLulBGoc-zmdP1bJLSuYHZAstEc/edit?gid=1531087093#gid=1531087093',
      category: 'Checklist Kho'
    }
    // Thêm các file khác vào đây
  ];

  constructor() { }

  ngOnInit(): void {
  }

  openDocument(url: string): void {
    window.open(url, '_blank');
  }
}
