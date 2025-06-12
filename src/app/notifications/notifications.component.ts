import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.css']
})
export class NotificationsComponent implements OnInit {
  documentUrl: SafeResourceUrl;
  private rawDocumentUrl = 'https://docs.google.com/spreadsheets/d/1hxDhlNumfD-6gyz1ajd5Bz0GdpQ9m4tUJGXD4hIvfHQ/edit?gid=0&rm=minimal';

  constructor(private sanitizer: DomSanitizer) { }

  ngOnInit() {
    this.documentUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawDocumentUrl);
  }
}
