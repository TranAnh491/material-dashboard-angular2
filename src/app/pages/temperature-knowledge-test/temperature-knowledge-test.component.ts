import { Component, OnInit } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

// Interfaces
interface TestQuestion {
  question: string;
  options?: string[];
  correctAnswer: string;
  type: 'multiple-choice' | 'true-false' | 'fill-blank';
}

interface TestSection {
  title: string;
  questions: TestQuestion[];
}

interface TestData {
  title: string;
  documentCode: string;
  issueDate: string;
  totalQuestions: number;
  timeLimit: number;
  passingScore: number;
  sections: TestSection[];
}

interface EmployeeInfo {
  employeeId: string;
  employeeName: string;
}

interface TestAnswer {
  questionIndex: number;
  sectionIndex: number;
  selectedAnswer: string;
  isCorrect: boolean;
}

interface TestResult {
  employeeInfo: EmployeeInfo;
  answers: TestAnswer[];
  score: number;
  percentage: number;
  passed: boolean;
  completedAt: Date;
  testData: TestData;
}

@Component({
  selector: 'app-temperature-knowledge-test',
  templateUrl: './temperature-knowledge-test.component.html',
  styleUrls: ['./temperature-knowledge-test.component.scss']
})
export class TemperatureKnowledgeTestComponent implements OnInit {
  isLoading = false;
  showNotification = false;
  
  // UI States
  currentView: 'employee-form' | 'preview' | 'test' | 'result' = 'employee-form';
  
  // Employee Information
  employeeInfo: EmployeeInfo = {
    employeeId: '',
    employeeName: ''
  };
  
  // Test State
  currentSectionIndex = 0;
  currentQuestionIndex = 0;
  answers: TestAnswer[] = [];
  testResult: TestResult | null = null;
  startTime: Date | null = null;
  
  // Firebase
  private db: any;

  // Test data
  testData: TestData = {
    title: "BÀI KIỂM TRA QUY TRÌNH GHI NHẬN NHIỆT ĐỘ, ĐỘ ẨM VÀ LƯU TRỮ SẢN PHẨM",
    documentCode: "WH-WI0036(Ver00)",
    issueDate: "17/07/2025",
    totalQuestions: 18, // Sẽ được tính tự động
    timeLimit: 30,
    passingScore: 80,
    sections: [
      {
        title: "PHẦN I: LƯU TRỮ SẢN PHẨM",
        questions: [
          {
            question: "Các loại môi trường lưu trữ bao gồm: (Chọn tất cả đáp án đúng)",
            options: [
              "Kho thường",
              "Kho lạnh",
              "Tủ lạnh",
              "Tất cả"
            ],
            correctAnswer: "D",
            type: "multiple-choice"
          },
          {
            question: "Việc xác định môi trường lưu trữ chỉ áp dụng cho nguyên vật liệu ASM1",
            options: ["Đúng", "Sai"],
            correctAnswer: "B",
            type: "true-false"
          },
          {
            question: "Mục đích của việc phân loại môi trường lưu trữ là gì?",
            options: [
              "Tiết kiệm chi phí",
              "Đảm bảo chất lượng sản phẩm",
              "Thuận tiện cho việc vận chuyển",
              "Tất cả các đáp án trên"
            ],
            correctAnswer: "B",
            type: "multiple-choice"
          }
        ]
      },
      {
        title: "PHẦN II: GHI NHẬN NHIỆT ĐỘ, ĐỘ ẨM",
        questions: [
          {
            question: "Nhiệt độ được hiển thị bằng đơn vị nào?",
            options: ["°F", "°C", "K", "°R"],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Độ ẩm được hiển thị bằng đơn vị nào?",
            options: ["%", "%RH", "g/m³", "ppm"],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Thiết bị đo nhiệt độ, độ ẩm được lắp đặt ở những khu vực nào?",
            options: [
              "Kho thường",
              "Kho lạnh",
              "Tủ lạnh",
              "Tất cả các khu vực trên"
            ],
            correctAnswer: "D",
            type: "multiple-choice"
          },
          {
            question: "Trước khi đọc số liệu, cần kiểm tra gì trên thiết bị?",
            options: [
              "Đèn báo",
              "Màn hình không nhấp nháy lỗi",
              "Hoạt động bình thường",
              "Tất cả các đáp án trên"
            ],
            correctAnswer: "D",
            type: "multiple-choice"
          },
          {
            question: "Việc ghi nhận nhiệt độ, độ ẩm được thực hiện mấy lần trong ngày?",
            options: ["1 lần", "2 lần", "3 lần", "4 lần"],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Thời gian ghi nhận buổi sáng là:",
            options: ["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM"],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Thời gian ghi nhận buổi chiều là:",
            options: ["2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM"],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "File bảng đo nhiệt độ, độ ẩm được mở theo khu vực nào?",
            options: [
              "Normal (Kho thường)",
              "Secured (Kho lạnh)",
              "Fridge (Tủ lạnh)",
              "Tất cả các đáp án trên"
            ],
            correctAnswer: "D",
            type: "multiple-choice"
          }
        ]
      },
              {
          title: "PHẦN III: XỬ LÝ VƯỢT NGƯỠNG",
          questions: [
            {
              question: "Khi nhiệt độ, độ ẩm ở kho thường vượt ngưỡng, bước đầu tiên là:",
              options: [
                "Mở cửa cuốn",
                "Thông báo bảo vệ bật hệ thống quạt thông gió",
                "Thông báo quản lý",
                "Kiểm tra thiết bị"
              ],
              correctAnswer: "B",
              type: "multiple-choice"
            },
            {
              question: "Khi nhiệt độ, độ ẩm ở kho lạnh vượt ngưỡng, cần kiểm tra:",
              options: [
                "Máy lạnh đã được mở chưa",
                "Nhiệt độ trên remote",
                "Máy hút ẩm (nếu độ ẩm vượt ngưỡng)",
                "Tất cả các đáp án trên"
              ],
              correctAnswer: "D",
              type: "multiple-choice"
            },
            {
              question: "Khi có cảnh báo vượt ngưỡng, cần làm gì đầu tiên?",
              options: [
                "Thông báo quản lý",
                "Xử lý tình huống",
                "Ghi nhận lại",
                "Cả A và B"
              ],
              correctAnswer: "D",
              type: "multiple-choice"
            },
            {
              question: "Khi mất điện, cần thông báo cho ai?",
              options: [
                "Chỉ quản lý Kho",
                "Chỉ bộ phận Hành Chánh Nhân Sự",
                "Quản lý Kho và bộ phận Hành Chánh Nhân Sự",
                "Tất cả nhân viên trong công ty"
              ],
              correctAnswer: "C",
              type: "multiple-choice"
            }
          ]
        },
      {
        title: "PHẦN IV: THEO DÕI SAU XỬ LÝ",
        questions: [
          {
            question: "Sau khi xử lý sự cố, cần theo dõi trong bao lâu để xem chỉ số đã ổn định chưa?",
            options: ["15 phút", "30 phút", "45 phút", "60 phút"],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Việc theo dõi sau xử lý có cần thiết không?",
            options: ["Đúng", "Sai"],
            correctAnswer: "A",
            type: "true-false"
          },
          {
            question: "Nếu sau 30 phút chỉ số vẫn không ổn định, cần làm gì?",
            options: [
              "Tiếp tục chờ",
              "Thông báo quản lý và xem xét biện pháp khác",
              "Bỏ qua và ghi nhận bình thường",
              "Tắt thiết bị"
            ],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Khi nào có thể coi như đã xử lý xong sự cố vượt ngưỡng?",
            options: [
              "Ngay sau khi thực hiện biện pháp",
              "Sau khi theo dõi và thấy chỉ số ổn định",
              "Sau 1 giờ",
              "Cuối ngày làm việc"
            ],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Ghi chú về quá trình xử lý sự cố có cần thiết không?",
            options: ["Đúng", "Sai"],
            correctAnswer: "A",
            type: "true-false"
          }
        ]
      }
    ]
  };

  constructor() { }

  ngOnInit(): void {
    this.initializeFirebase();
    this.calculateTotalQuestions();
  }

  private calculateTotalQuestions(): void {
    let total = 0;
    this.testData.sections.forEach(section => {
      total += section.questions.length;
    });
    this.testData.totalQuestions = total;
  }

  private async initializeFirebase(): Promise<void> {
    try {
      const app = initializeApp(environment.firebase);
      this.db = getFirestore(app);
    } catch (error) {
      console.error('Error initializing Firebase:', error);
    }
  }

  // Employee Form Methods
  isEmployeeFormValid(): boolean {
    return this.employeeInfo.employeeId.trim() !== '' && 
           this.employeeInfo.employeeName.trim() !== '';
  }

  startPreview(): void {
    if (this.isEmployeeFormValid()) {
      this.currentView = 'preview';
    }
  }

  startTest(): void {
    this.currentView = 'test';
    this.currentSectionIndex = 0;
    this.currentQuestionIndex = 0;
    this.answers = [];
    this.startTime = new Date();
    this.updateSelectedAnswer();
  }

  // Test Methods
  getCurrentQuestion(): TestQuestion | null {
    if (this.currentSectionIndex < this.testData.sections.length) {
      const section = this.testData.sections[this.currentSectionIndex];
      if (this.currentQuestionIndex < section.questions.length) {
        const question = section.questions[this.currentQuestionIndex];
        return question;
      }
    }
    return null;
  }

  getCurrentSection(): TestSection | null {
    if (this.currentSectionIndex < this.testData.sections.length) {
      return this.testData.sections[this.currentSectionIndex];
    }
    return null;
  }

  getQuestionNumber(): number {
    let questionNumber = 1;
    for (let i = 0; i < this.currentSectionIndex; i++) {
      questionNumber += this.testData.sections[i].questions.length;
    }
    return questionNumber + this.currentQuestionIndex;
  }

  selectAnswer(answer: string): void {
    const question = this.getCurrentQuestion();
    if (!question) return;

    const answerIndex = this.answers.findIndex(a => 
      a.sectionIndex === this.currentSectionIndex && 
      a.questionIndex === this.currentQuestionIndex
    );

    const isCorrect = this.checkAnswer(question, answer);
    const testAnswer: TestAnswer = {
      questionIndex: this.currentQuestionIndex,
      sectionIndex: this.currentSectionIndex,
      selectedAnswer: answer,
      isCorrect: isCorrect
    };

    if (answerIndex >= 0) {
      this.answers[answerIndex] = testAnswer;
    } else {
      this.answers.push(testAnswer);
    }
  }

  private checkAnswer(question: TestQuestion, answer: string): boolean {
    if (question.type === 'true-false') {
      return (answer === 'true' && question.correctAnswer === 'A') ||
             (answer === 'false' && question.correctAnswer === 'B');
    } else if (question.type === 'multiple-choice') {
      return answer === question.correctAnswer;
    } else if (question.type === 'fill-blank') {
      return answer.toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();
    }
    return false;
  }

  getSelectedAnswer(): string | null {
    const answer = this.answers.find(a => 
      a.sectionIndex === this.currentSectionIndex && 
      a.questionIndex === this.currentQuestionIndex
    );
    return answer ? answer.selectedAnswer : null;
  }

  nextQuestion(): void {
    if (this.currentQuestionIndex < this.testData.sections[this.currentSectionIndex].questions.length - 1) {
      this.currentQuestionIndex++;
    } else if (this.currentSectionIndex < this.testData.sections.length - 1) {
      this.currentSectionIndex++;
      this.currentQuestionIndex = 0;
    } else {
      this.finishTest();
      return;
    }
    this.updateSelectedAnswer();
  }

  previousQuestion(): void {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
    } else if (this.currentSectionIndex > 0) {
      this.currentSectionIndex--;
      this.currentQuestionIndex = this.testData.sections[this.currentSectionIndex].questions.length - 1;
    }
    this.updateSelectedAnswer();
  }

  private updateSelectedAnswer(): void {
    // This method is called when navigating between questions
    // The UI will automatically update based on getSelectedAnswer()
  }

  canGoNext(): boolean {
    return this.getSelectedAnswer() !== null;
  }

  isLastQuestion(): boolean {
    return this.currentSectionIndex === this.testData.sections.length - 1 &&
           this.currentQuestionIndex === this.testData.sections[this.currentSectionIndex].questions.length - 1;
  }

  async finishTest(): Promise<void> {
    this.isLoading = true;
    
    const correctAnswers = this.answers.filter(a => a.isCorrect).length;
    const percentage = Math.round((correctAnswers / this.testData.totalQuestions) * 100);
    const passed = percentage >= this.testData.passingScore;

    this.testResult = {
      employeeInfo: this.employeeInfo,
      answers: this.answers,
      score: correctAnswers,
      percentage: percentage,
      passed: passed,
      completedAt: new Date(),
      testData: this.testData
    };

    // Save to Firebase
    await this.saveTestResult(this.testResult);
    
    this.currentView = 'result';
    this.isLoading = false;
    
    // Auto-download result file
    this.downloadResultFile();
  }

  private async saveTestResult(result: TestResult): Promise<void> {
    try {
      const docRef = await addDoc(collection(this.db, 'temperature-test-results'), {
        employeeId: result.employeeInfo.employeeId,
        employeeName: result.employeeInfo.employeeName,
        score: result.score,
        percentage: result.percentage,
        passed: result.passed,
        totalQuestions: result.testData.totalQuestions,
        completedAt: Timestamp.fromDate(result.completedAt),
        testTitle: result.testData.title,
        documentCode: result.testData.documentCode
      });
      console.log('Test result saved with ID: ', docRef.id);
    } catch (error) {
      console.error('Error saving test result: ', error);
    }
  }

  downloadResultFile(): void {
    if (!this.testResult) return;

    const content = this.generateWordContent(this.testResult);
    const blob = new Blob([content], { 
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
    });
    const url = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `Ket_Qua_${this.testResult.employeeInfo.employeeId}_${this.formatDate(this.testResult.completedAt)}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  private generateWordContent(result: TestResult): string {
    let content = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8">
<title>Kết quả bài kiểm tra</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>90</w:Zoom>
<w:DoNotPromptForConvert/>
<w:DoNotShowInsertionsAndDeletions/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
body { font-family: Arial, sans-serif; margin: 40px; }
.header { text-align: center; margin-bottom: 30px; }
.title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
.info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
.info-table td { padding: 8px; border: 1px solid #000; }
.result-section { margin-bottom: 20px; }
.section-title { font-weight: bold; font-size: 14px; margin: 15px 0 10px 0; }
.question-item { margin-bottom: 10px; padding: 8px; border: 1px solid #ddd; }
.correct { background-color: #d4edda; }
.incorrect { background-color: #f8d7da; }
</style>
</head>
<body>

<div class="header">
<div class="title">KẾT QUẢ BÀI KIỂM TRA</div>
<div>${result.testData.title}</div>
<div>Mã tài liệu: ${result.testData.documentCode}</div>
</div>

<table class="info-table">
<tr><td><strong>Mã nhân viên:</strong></td><td>${result.employeeInfo.employeeId}</td></tr>
<tr><td><strong>Tên nhân viên:</strong></td><td>${result.employeeInfo.employeeName}</td></tr>
<tr><td><strong>Ngày thực hiện:</strong></td><td>${this.formatDate(result.completedAt)}</td></tr>
<tr><td><strong>Thời gian hoàn thành:</strong></td><td>${this.formatTime(result.completedAt)}</td></tr>
<tr><td><strong>Điểm số:</strong></td><td>${result.score}/${result.testData.totalQuestions}</td></tr>
<tr><td><strong>Tỷ lệ đúng:</strong></td><td>${result.percentage}%</td></tr>
<tr><td><strong>Kết quả:</strong></td><td><strong style="color: ${result.passed ? 'green' : 'red'}">${result.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}</strong></td></tr>
<tr><td><strong>Điểm đạt yêu cầu:</strong></td><td>${result.testData.passingScore}%</td></tr>
</table>

<div class="result-section">
<h3>CHI TIẾT CÂU TRẢ LỜI:</h3>`;

    let questionNumber = 1;
    result.testData.sections.forEach((section, sectionIndex) => {
      content += `<div class="section-title">${section.title}</div>`;
      
      section.questions.forEach((question, questionIndex) => {
        const answer = result.answers.find(a => 
          a.sectionIndex === sectionIndex && a.questionIndex === questionIndex
        );
        
        const isCorrect = answer?.isCorrect || false;
        content += `<div class="question-item ${isCorrect ? 'correct' : 'incorrect'}">
          <div><strong>Câu ${questionNumber}:</strong> ${question.question}</div>
          <div><strong>Đáp án chọn:</strong> ${answer?.selectedAnswer || 'Không trả lời'}</div>
          <div><strong>Đáp án đúng:</strong> ${question.correctAnswer}</div>
          <div><strong>Kết quả:</strong> ${isCorrect ? '✓ ĐÚNG' : '✗ SAI'}</div>
        </div>`;
        questionNumber++;
      });
    });

    content += `</div>
</body>
</html>`;
    
    return content;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('vi-VN');
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('vi-VN');
  }

  restartTest(): void {
    this.currentView = 'employee-form';
    this.employeeInfo = { employeeId: '', employeeName: '' };
    this.answers = [];
    this.testResult = null;
    this.currentSectionIndex = 0;
    this.currentQuestionIndex = 0;
  }

  // Template helper methods
  getAnswerResult(sectionIndex: number, questionIndex: number): TestAnswer | undefined {
    return this.testResult?.answers.find(a => 
      a.sectionIndex === sectionIndex && a.questionIndex === questionIndex
    );
  }

  getDetailedQuestionNumber(sectionIndex: number, questionIndex: number): number {
    let questionNumber = 1;
    for (let i = 0; i < sectionIndex; i++) {
      questionNumber += this.testData.sections[i].questions.length;
    }
    return questionNumber + questionIndex;
  }

  downloadExcel(): void {
    this.showLoadingOverlay();
    
    // Simulate download process
    setTimeout(() => {
      this.hideLoadingOverlay();
      this.showSuccessNotification("File đã được tải xuống thành công!");
      
      // Create and download a mock Excel file
      this.createMockExcelFile();
    }, 2000);
  }

  downloadAnswerKey(): void {
    this.showLoadingOverlay();
    
    // Simulate download process
    setTimeout(() => {
      this.hideLoadingOverlay();
      this.showSuccessNotification("Đáp án đã được tải xuống thành công!");
      
      // Create and download a mock answer key file
      this.createMockAnswerKeyFile();
    }, 1500);
  }

  private showLoadingOverlay(): void {
    this.isLoading = true;
  }

  private hideLoadingOverlay(): void {
    this.isLoading = false;
  }

  private showSuccessNotification(message: string): void {
    this.showNotification = true;
    
    // Hide notification after 3 seconds
    setTimeout(() => {
      this.showNotification = false;
    }, 3000);
  }

  private createMockExcelFile(): void {
    // Create a mock Excel file content
    const content = this.generateExcelContent();
    const blob = new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Bai_Kiem_Tra_Nhiet_Do_Do_Am.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  private createMockAnswerKeyFile(): void {
    // Create a mock answer key file content
    const content = this.generateAnswerKeyContent();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Dap_An_Kiem_Tra_Nhiet_Do_Do_Am.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  private generateExcelContent(): string {
    // Mock Excel content - in a real implementation, you would use a library like xlsx
    let content = `${this.testData.title}\n`;
    content += `Mã tài liệu: ${this.testData.documentCode}\n`;
    content += `Ngày ban hành: ${this.testData.issueDate}\n\n`;
    
    this.testData.sections.forEach((section, sectionIndex) => {
      content += `${section.title}\n`;
      section.questions.forEach((question, questionIndex) => {
        content += `Câu ${sectionIndex * 5 + questionIndex + 1}: ${question.question}\n`;
        if (question.options && question.options.length > 0) {
          question.options.forEach((option, optionIndex) => {
            content += `${String.fromCharCode(65 + optionIndex)}. ${option}\n`;
          });
        }
        content += `\n`;
      });
      content += `\n`;
    });
    
    return content;
  }

  private generateAnswerKeyContent(): string {
    let content = `ĐÁP ÁN BÀI KIỂM TRA - ${this.testData.title}\n`;
    content += `=====================================\n\n`;
    
    let questionNumber = 1;
    this.testData.sections.forEach((section) => {
      content += `${section.title}\n`;
      content += `${'='.repeat(section.title.length)}\n`;
      
      section.questions.forEach((question) => {
        content += `Câu ${questionNumber}: ${question.correctAnswer}\n`;
        questionNumber++;
      });
      content += `\n`;
    });
    
    return content;
  }

  // Helper method for template
  getOptionLabel(index: number): string {
    return String.fromCharCode(65 + index);
  }

  // Helper method to get sample questions for preview
  getSampleQuestions(): any[] {
    const samples = [];
    
    // Add one question from each section
    this.testData.sections.forEach((section, sectionIndex) => {
      if (section.questions.length > 0) {
        const question = section.questions[0];
        let questionNumber = 1;
        for (let i = 0; i < sectionIndex; i++) {
          questionNumber += this.testData.sections[i].questions.length;
        }
        
        samples.push({
          sectionTitle: section.title,
          questionNumber: questionNumber,
          question: question,
          isCorrectAnswer: (optionIndex: number) => {
            if (question.type === 'true-false') {
              return question.correctAnswer === 'A' ? optionIndex === 0 : optionIndex === 1;
            } else if (question.type === 'multiple-choice') {
              return question.correctAnswer === String.fromCharCode(65 + optionIndex);
            }
            return false;
          }
        });
      }
    });
    
    return samples;
  }
} 