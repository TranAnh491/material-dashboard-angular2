import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-log',
  templateUrl: './log.component.html',
  styleUrls: ['./log.component.css']
})
export class LogComponent implements OnInit {
  logFormUrl: SafeResourceUrl;
  private rawLogFormUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfwh-h9SRBCi-zVJSdMO7drnHkc5VHqbIvkmUiiYobATCR8HA/viewform?embedded=true';

  constructor(private sanitizer: DomSanitizer) { }

  ngOnInit() {
    this.logFormUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawLogFormUrl);
  }
} 