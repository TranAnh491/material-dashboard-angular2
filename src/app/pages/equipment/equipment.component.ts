import { Component, OnInit } from '@angular/core';

interface FlowchartStep {
  vi: string;
  en: string;
  icon: string;
  type: 'material' | 'product';
  imageUrl?: string;
}

@Component({
  selector: 'app-equipment',
  templateUrl: './equipment.component.html',
  styleUrls: ['./equipment.component.css']
})
export class EquipmentComponent implements OnInit {

  isEnglish = false;
  selectedStep: FlowchartStep | null = null;

  steps: FlowchartStep[] = [
    { vi: 'Nhận nguyên liệu', en: 'Receive Materials', icon: 'call_received', type: 'material', imageUrl: 'assets/img/instruction_step_1.png' },
    { vi: 'Kiểm tra nguyên liệu đầu vào', en: 'Inspect Incoming Materials', icon: 'fact_check', type: 'material', imageUrl: 'assets/img/instruction_step_2.png' },
    { vi: 'Lưu trữ nguyên liệu', en: 'Store Materials', icon: 'inventory_2', type: 'material', imageUrl: 'assets/img/instruction_step_3.png' },
    { vi: 'Soạn Nguyên liệu', en: 'Prepare Materials', icon: 'build', type: 'material', imageUrl: 'assets/img/instruction_step_4.png' },
    { vi: 'Kiểm và Giao nguyên liệu', en: 'Check and Deliver Materials', icon: 'local_shipping', type: 'material', imageUrl: 'assets/img/instruction_step_5.png' },
    { vi: 'Nhận Thành Phẩm', en: 'Receive Finished Goods', icon: 'check_circle_outline', type: 'product', imageUrl: 'assets/img/instruction_step_6.png' },
    { vi: 'Lưu trữ Thành Phẩm', en: 'Store Finished Goods', icon: 'inventory', type: 'product', imageUrl: 'assets/img/instruction_step_7.png' },
    { vi: 'Soạn và Giao Thành phẩm', en: 'Prepare and Deliver Finished Goods', icon: 'move_to_inbox', type: 'product', imageUrl: 'assets/img/instruction_step_8.png' }
  ];

  constructor() { }

  ngOnInit(): void {
    if (this.steps.length > 0) {
      this.selectedStep = this.steps[0];
    }
  }

  toggleLanguage() {
    this.isEnglish = !this.isEnglish;
  }

  selectStep(step: FlowchartStep) {
    this.selectedStep = step;
  }
} 