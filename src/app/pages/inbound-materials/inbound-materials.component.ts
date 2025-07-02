import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-inbound-materials',
  templateUrl: './inbound-materials.component.html',
  styleUrls: ['./inbound-materials.component.scss']
})
export class InboundMaterialsComponent implements OnInit {
  googleSheetUrl: SafeResourceUrl;

  constructor(private sanitizer: DomSanitizer) { }

  ngOnInit(): void {
    const unsafeUrl = 'https://script.google.com/macros/s/AKfycbzqPxrwHY1vMV3f6MNGZ1w0l-UqI8K_S-jf0Hh7gsQX_KGcHvSB_bvrx6RhKCG8LxsS/exec';
    this.googleSheetUrl = this.sanitizer.bypassSecurityTrustResourceUrl(unsafeUrl);
  }

}
