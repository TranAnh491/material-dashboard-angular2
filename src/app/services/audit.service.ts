import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface AuditItem {
  text: string;
  textVi: string;
  status?: 'good' | 'marginal' | 'poor';
}

export interface AuditPhase {
  title: string;
  titleVi: string;
  color: string;
  items: AuditItem[];
}

export interface AuditData {
  [key: string]: { [key: number]: 'good' | 'marginal' | 'poor' };
}

export interface PhaseScore {
  score: number;
  maxScore: number;
  percentage: number;
  good: number;
  marginal: number;
  poor: number;
  unchecked: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuditService {
  private auditDataSubject = new BehaviorSubject<AuditData>({
    sort: {},
    setInOrder: {},
    shine: {},
    standardize: {},
    sustain: {}
  });

  auditData$ = this.auditDataSubject.asObservable();

  // Language settings
  isVietnamese = false;

  auditCriteria: { [key: string]: AuditPhase } = {
    sort: {
      title: 'Sort Phase',
      titleVi: 'Giai đoạn Sắp xếp',
      color: 'rgb(251, 146, 60)',
      items: [
        { text: 'Awareness of operators/employees about 5S Sort Phase', textVi: 'Nhận thức của nhân viên về giai đoạn Sắp xếp 5S' },
        { text: 'Presence of Defined work instruction on 5S Sort Phase implementation', textVi: 'Có hướng dẫn làm việc xác định cho việc thực hiện giai đoạn Sắp xếp 5S' },
        { text: 'Operators following the work instruction in implementation of 5S Sort Phase', textVi: 'Nhân viên tuân theo hướng dẫn trong việc thực hiện giai đoạn Sắp xếp 5S' },
        { text: 'Look for unwanted items', textVi: 'Tìm kiếm các vật dụng không cần thiết' },
        { text: 'Check of Sort list', textVi: 'Kiểm tra danh sách Sắp xếp' },
        { text: 'Proper filling of Sorting', textVi: 'Điền thông tin Sắp xếp đúng cách' },
        { text: 'Maintenance of Sorting logbook', textVi: 'Duy trì sổ ghi chép Sắp xếp' },
        { text: 'Operators following the sorting activity', textVi: 'Nhân viên tuân theo hoạt động sắp xếp' },
        { text: 'Improvement of Department health in sorting activity', textVi: 'Cải thiện sức khỏe phòng ban trong hoạt động sắp xếp' },
        { text: 'Checking of usage of un-unwanted items in better ways', textVi: 'Kiểm tra việc sử dụng các vật dụng không cần thiết theo cách tốt hơn' },
        { text: 'Maintenance of red tag items', textVi: 'Duy trì các vật dụng có thẻ đỏ' },
        { text: 'Adequate Training record on 5S Sort phase', textVi: 'Hồ sơ đào tạo đầy đủ về giai đoạn Sắp xếp 5S' },
        { text: 'Subject of improvement in 5S Sort Phase', textVi: 'Chủ đề cải tiến trong giai đoạn Sắp xếp 5S' },
        { text: 'Operators support in 5S Sort phase from management', textVi: 'Sự hỗ trợ của ban quản lý cho nhân viên trong giai đoạn Sắp xếp 5S' }
      ]
    },
    setInOrder: {
      title: 'Set in Order Phase',
      titleVi: 'Giai đoạn Sắp đặt',
      color: 'rgb(234, 179, 8)',
      items: [
        { text: 'Awareness of operators/employees about 5S Set Phase', textVi: 'Nhận thức của nhân viên về giai đoạn Sắp đặt 5S' },
        { text: 'Presence of Defined work instruction on 5S Set Phase implementation', textVi: 'Có hướng dẫn làm việc xác định cho việc thực hiện giai đoạn Sắp đặt 5S' },
        { text: 'Operators following the work instruction in implementation of 5S Set Phase', textVi: 'Nhân viên tuân theo hướng dẫn trong việc thực hiện giai đoạn Sắp đặt 5S' },
        { text: 'There is a proper place for each and every item', textVi: 'Có một vị trí thích hợp cho từng vật dụng' },
        { text: 'Proper labeling', textVi: 'Gán nhãn đúng cách' },
        { text: 'Activities of work place', textVi: 'Các hoạt động của nơi làm việc' },
        { text: 'Maintenance of work place', textVi: 'Bảo trì nơi làm việc' }
      ]
    },
    shine: {
      title: 'Shine Phase',
      titleVi: 'Giai đoạn Làm sạch',
      color: 'rgb(59, 130, 246)',
      items: [
        { text: 'Awareness of operators/employees about 5S Shine Phase', textVi: 'Nhận thức của nhân viên về giai đoạn Làm sạch 5S' },
        { text: 'Presence of Defined work instruction on 5S Shine Phase implementation', textVi: 'Có hướng dẫn làm việc xác định cho việc thực hiện giai đoạn Làm sạch 5S' },
        { text: 'Operators following the work instruction in implementation of 5S Shine Phase', textVi: 'Nhân viên tuân theo hướng dẫn trong việc thực hiện giai đoạn Làm sạch 5S' },
        { text: 'Is there a Cleaning Schedule?', textVi: 'Có lịch trình vệ sinh không?' },
        { text: 'Cleaning done as per schedule', textVi: 'Vệ sinh thực hiện theo lịch trình' },
        { text: 'Are there any abnormalities identified during the inspection?', textVi: 'Có bất thường nào được xác định trong quá trình kiểm tra không?' },
        { text: 'Is there a record of action plan to eliminate the faults', textVi: 'Có ghi chép về kế hoạch hành động để loại bỏ lỗi không' },
        { text: 'Are all equipment properly stored', textVi: 'Tất cả thiết bị được lưu trữ đúng cách' },
        { text: 'Are cleaning materials available?', textVi: 'Có đủ vật liệu vệ sinh không?' }
      ]
    },
    standardize: {
      title: 'Standardize Phase',
      titleVi: 'Giai đoạn Tiêu chuẩn hóa',
      color: 'rgb(34, 197, 94)',
      items: [
        { text: 'Awareness of operators/employees about 5S Standardize Phase', textVi: 'Nhận thức của nhân viên về giai đoạn Tiêu chuẩn hóa 5S' },
        { text: 'Presence of Defined work instruction on 5S Standardize Phase implementation', textVi: 'Có hướng dẫn làm việc xác định cho việc thực hiện giai đoạn Tiêu chuẩn hóa 5S' },
        { text: 'Operators following the work instruction in implementation of 5S Standardize Phase', textVi: 'Nhân viên tuân theo hướng dẫn trong việc thực hiện giai đoạn Tiêu chuẩn hóa 5S' },
        { text: 'Is there a record of identifying above three standards', textVi: 'Có ghi chép về việc xác định ba tiêu chuẩn trên không' },
        { text: 'Is there a record of horizontal deployment of best standard across factory', textVi: 'Có ghi chép về việc triển khai ngang tiêu chuẩn tốt nhất trên toàn nhà máy không' },
        { text: 'Is there a record of periodical auditing', textVi: 'Có ghi chép về kiểm toán định kỳ không' }
      ]
    },
    sustain: {
      title: 'Sustain Phase',
      titleVi: 'Giai đoạn duy trì',
      color: 'rgb(168, 85, 247)',
      items: [
        { text: 'Awareness of operators/employees about 5S Sustain Phase', textVi: 'Nhận thức của nhân viên về giai đoạn Duy trì 5S' },
        { text: 'Presence of Defined work instruction on 5S Sustain Phase implementation', textVi: 'Có hướng dẫn làm việc xác định cho việc thực hiện giai đoạn Duy trì 5S' },
        { text: 'Operators following the work instruction in implementation of 5S Sustain Phase', textVi: 'Nhân viên tuân theo hướng dẫn trong việc thực hiện giai đoạn Duy trì 5S' },
        { text: 'Regular training of employees on 5S', textVi: 'Đào tạo thường xuyên cho nhân viên về 5S' },
        { text: 'Regular training of Management on 5S', textVi: 'Đào tạo thường xuyên cho Ban quản lý về 5S' },
        { text: 'Involvement of Management in 5S', textVi: 'Sự tham gia của Ban quản lý trong 5S' },
        { text: 'Are employees oriented on participation in 5S', textVi: 'Nhân viên có được định hướng tham gia 5S không' },
        { text: 'Are employees encouraged to participate in 5S', textVi: 'Nhân viên có được khuyến khích tham gia 5S không' },
        { text: 'Presence of Knowledgeable person in 5S', textVi: 'Có người am hiểu về 5S' },
        { text: 'Presence of Improvement team', textVi: 'Có đội cải tiến' },
        { text: 'Presence of 5S committee', textVi: 'Có ủy ban 5S' },
        { text: 'Availability of pocket hand book to Employees', textVi: 'Có sẵn sổ tay bỏ túi cho nhân viên' },
        { text: 'Maintenance of 5S board and communication', textVi: 'Duy trì bảng 5S và giao tiếp' }
      ]
    }
  };

  updateAuditData(phase: string, itemIndex: number, value: 'good' | 'marginal' | 'poor') {
    const currentData = this.auditDataSubject.value;
    const updatedData = {
      ...currentData,
      [phase]: {
        ...currentData[phase],
        [itemIndex]: value
      }
    };
    this.auditDataSubject.next(updatedData);
  }

  calculatePhaseScore(phase: string, auditData: AuditData): PhaseScore {
    const phaseData = auditData[phase];
    const totalItems = this.auditCriteria[phase].items.length;
    const checkedItems = Object.values(phaseData).filter(val => val === 'good').length;
    const marginalItems = Object.values(phaseData).filter(val => val === 'marginal').length;
    const poorItems = Object.values(phaseData).filter(val => val === 'poor').length;
    
    const score = (checkedItems * 3) + (marginalItems * 2) + (poorItems * 1);
    const maxScore = totalItems * 3;
    
    return {
      score,
      maxScore,
      percentage: totalItems > 0 ? Math.round((score / maxScore) * 100) : 0,
      good: checkedItems,
      marginal: marginalItems,
      poor: poorItems,
      unchecked: totalItems - checkedItems - marginalItems - poorItems
    };
  }

  getTotalScore(auditData: AuditData): PhaseScore {
    const phases = ['sort', 'setInOrder', 'shine', 'standardize', 'sustain'];
    let totalScore = 0;
    let totalMaxScore = 0;
    let totalGood = 0;
    let totalMarginal = 0;
    let totalPoor = 0;
    let totalUnchecked = 0;
    
    phases.forEach(phase => {
      const phaseScore = this.calculatePhaseScore(phase, auditData);
      totalScore += phaseScore.score;
      totalMaxScore += phaseScore.maxScore;
      totalGood += phaseScore.good;
      totalMarginal += phaseScore.marginal;
      totalPoor += phaseScore.poor;
      totalUnchecked += phaseScore.unchecked;
    });
    
    return {
      score: totalScore,
      maxScore: totalMaxScore,
      percentage: totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0,
      good: totalGood,
      marginal: totalMarginal,
      poor: totalPoor,
      unchecked: totalUnchecked
    };
  }

  exportResults(auditData: AuditData): void {
    const totalScore = this.getTotalScore(auditData);
    const phases = ['sort', 'setInOrder', 'shine', 'standardize', 'sustain'];
    
    let report = `5S AUDIT REPORT\n`;
    report += `================\n\n`;
    report += `Overall Score: ${totalScore.score}/${totalScore.maxScore} (${totalScore.percentage}%)\n\n`;
    
    phases.forEach(phase => {
      const phaseScore = this.calculatePhaseScore(phase, auditData);
      report += `${this.auditCriteria[phase].title.toUpperCase()}\n`;
      report += `Score: ${phaseScore.score}/${phaseScore.maxScore} (${phaseScore.percentage}%)\n`;
      report += `Good: ${phaseScore.good}, Marginal: ${phaseScore.marginal}, Poor: ${phaseScore.poor}, Unchecked: ${phaseScore.unchecked}\n\n`;
    });
    
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `5S_Audit_Report_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  getScoreColor(percentage: number): string {
    if (percentage >= 80) return '#22c55e';
    if (percentage >= 60) return '#eab308';
    return '#ef4444';
  }

  getScoreBackground(percentage: number): string {
    if (percentage >= 80) return '#dcfce7';
    if (percentage >= 60) return '#fef3c7';
    return '#fee2e2';
  }

  // Language methods
  toggleLanguage(): void {
    this.isVietnamese = !this.isVietnamese;
  }

  setLanguage(isVietnamese: boolean): void {
    this.isVietnamese = isVietnamese;
  }

  getPhaseTitle(phase: string): string {
    const phaseData = this.auditCriteria[phase];
    return this.isVietnamese ? phaseData.titleVi : phaseData.title;
  }

  getItemText(phase: string, itemIndex: number): string {
    const item = this.auditCriteria[phase].items[itemIndex];
    return this.isVietnamese ? item.textVi : item.text;
  }

  getStatusText(status: string): string {
    if (!this.isVietnamese) {
      switch (status) {
        case 'good': return 'Good';
        case 'marginal': return 'Marginal';
        case 'poor': return 'Poor';
        default: return '';
      }
    } else {
      switch (status) {
        case 'good': return 'Tốt';
        case 'marginal': return 'Trung bình';
        case 'poor': return 'Kém';
        default: return '';
      }
    }
  }

  getUIText(key: string): string {
    const translations: { [key: string]: { en: string, vi: string } } = {
      'auditTitle': { en: '5S Audit Checklist', vi: 'Danh sách kiểm tra 5S' },
      'auditSubtitle': { en: 'Comprehensive workplace organization assessment tool', vi: 'Công cụ đánh giá tổ chức nơi làm việc toàn diện' },
      'overallScore': { en: 'Overall Score', vi: 'Điểm tổng thể' },
      'results': { en: 'Results', vi: 'Kết quả' },
      'overallPerformance': { en: 'Overall Performance', vi: 'Hiệu suất tổng thể' },
      'phaseBreakdown': { en: 'Phase Breakdown', vi: 'Phân tích theo giai đoạn' },
      'exportReport': { en: 'Export Report', vi: 'Xuất báo cáo' },
      'score': { en: 'Score', vi: 'Điểm' },
      'good': { en: 'Good', vi: 'Tốt' },
      'marginal': { en: 'Marginal', vi: 'Trung bình' },
      'poor': { en: 'Poor', vi: 'Kém' },
      'unchecked': { en: 'Unchecked', vi: 'Chưa kiểm tra' },
      'methodology': { en: '5S Methodology: Sort • Set in Order • Shine • Standardize • Sustain', vi: 'Phương pháp 5S: Sắp xếp • Sắp đặt • Làm sạch • Tiêu chuẩn hóa • Duy trì' }
    };

    const translation = translations[key];
    if (!translation) return key;
    return this.isVietnamese ? translation.vi : translation.en;
  }
} 