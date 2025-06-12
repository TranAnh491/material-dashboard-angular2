import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.css']
})
export class NotificationsComponent implements OnInit {
  currentView: 'log' | 'document' = 'log'; // Chế độ xem mặc định là 'log'

  // URL cho sheet kết quả
  documentUrl: SafeResourceUrl;
  // Thêm &rm=minimal để có giao diện gọn gàng hơn khi nhúng
  private rawDocumentUrl = 'https://docs.google.com/spreadsheets/d/1hxDhlNumfD-6gyz1ajd5Bz0GdpQ9m4tUJGXD4hIvfHQ/edit?gid=0&rm=minimal';

  // URL cho Google Form nhập liệu
  logFormUrl: SafeResourceUrl;
  // !!! VUI LÒNG THAY BẰNG LINK NHÚNG GOOGLE FORM CỦA BẠN !!!
  private rawLogFormUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfwh-h9SRBCi-zVJSdMO7drnHkc5VHqbIvkmUiiYobATCR8HA/viewform?embedded=true';

  constructor(private sanitizer: DomSanitizer) { }

  ngOnInit() {
    // Sanitize URLs để đảm bảo an toàn khi nhúng vào iframe
    this.documentUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawDocumentUrl);

    if (this.rawLogFormUrl !== 'YOUR_GOOGLE_FORM_EMBED_URL_HERE') {
      this.logFormUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawLogFormUrl);
    }
  }

  selectView(view: 'log' | 'document') {
    this.currentView = view;
  }
}
