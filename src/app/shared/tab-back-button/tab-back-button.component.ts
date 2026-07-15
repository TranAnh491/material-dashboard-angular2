import { Component, Input } from '@angular/core';
import { Location } from '@angular/common';

@Component({
  selector: 'app-tab-back-button',
  templateUrl: './tab-back-button.component.html',
  styleUrls: ['./tab-back-button.component.scss']
})
export class TabBackButtonComponent {
  /**
   * Vị trí hiển thị:
   * - 'bar' (mặc định): nằm trong dòng chảy layout, ở đầu trang — không bao giờ đè lên nội dung/toolbar riêng của tab.
   * - 'floating': neo cố định theo viewport (chỉ dùng khi chắc chắn tab không có toolbar ở góc phải trên).
   */
  @Input() variant: 'bar' | 'floating' = 'bar';

  constructor(private location: Location) {}

  goBack(): void {
    this.location.back();
  }
}
