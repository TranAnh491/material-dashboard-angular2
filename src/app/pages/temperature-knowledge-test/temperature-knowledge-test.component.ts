import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import SignaturePad from 'signature_pad';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
  signature?: string; // Base64 encoded signature image
}

@Component({
  selector: 'app-temperature-knowledge-test',
  templateUrl: './temperature-knowledge-test.component.html',
  styleUrls: ['./temperature-knowledge-test.component.scss']
})
export class TemperatureKnowledgeTestComponent implements OnInit, AfterViewInit {
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

  // Signature Pad
  @ViewChild('signatureCanvas', { static: false }) signatureCanvas!: ElementRef<HTMLCanvasElement>;
  signaturePad: SignaturePad | null = null;
  showSignature = false;
  signatureRequired = false;

  // Test data
  testData: TestData = {
    title: "BÀI KIỂM TRA HƯỚNG DẪN GHI NHẬN NHIỆT ĐỘ, ĐỘ ẨM VÀ LƯU TRỮ SẢN PHẨM",
    issueDate: "17/07/2025",
    totalQuestions: 20, // Will be calculated automatically
    timeLimit: 25,
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

  ngAfterViewInit(): void {
    // Initialize signature pad after view is ready
    if (this.signatureCanvas) {
      this.initializeSignaturePad();
    }
  }

  private initializeSignaturePad(): void {
    if (this.signatureCanvas && this.signatureCanvas.nativeElement) {
      const canvas = this.signatureCanvas.nativeElement;
      this.signaturePad = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255, 255, 255, 0)',
        penColor: 'rgb(0, 0, 0)',
        minWidth: 1,
        maxWidth: 3
      });
    }
  }

  // Signature management methods
  clearSignature(): void {
    if (this.signaturePad) {
      this.signaturePad.clear();
    }
  }

  isSignatureEmpty(): boolean {
    return this.signaturePad ? this.signaturePad.isEmpty() : true;
  }

  async saveSignature(): Promise<void> {
    if (this.signaturePad && !this.signaturePad.isEmpty()) {
      const signatureData = this.signaturePad.toDataURL();
      if (this.testResult) {
        this.testResult.signature = signatureData;
        console.log('✍️ Signature captured, now saving to Firebase...');
        
        this.isLoading = true;
        
        // Now save to Firebase with signature
        await this.saveTestResult(this.testResult);
        
        this.isLoading = false;
        console.log('💾 Test result with signature saved to Firebase successfully!');
      }
      this.showSignature = false;
      this.signatureRequired = false;
    }
  }

  async skipSignature(): Promise<void> {
    if (this.testResult) {
      console.log('⏭️ User chose to skip signature, saving without signature...');
      
      this.isLoading = true;
      
      // Save to Firebase without signature
      await this.saveTestResult(this.testResult);
      
      this.isLoading = false;
      console.log('💾 Test result saved to Firebase without signature!');
      
      this.showSignature = false;
      this.signatureRequired = false;
    }
  }

  showSignaturePad(): void {
    this.showSignature = true;
    this.signatureRequired = true;
    
    // Initialize signature pad if not already done
    setTimeout(() => {
      if (!this.signaturePad && this.signatureCanvas) {
        this.initializeSignaturePad();
      }
    }, 100);
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
           this.employeeInfo.employeeName.trim() !== '' &&
           this.isValidEmployeeId(this.employeeInfo.employeeId) &&
           this.isValidEmployeeName(this.employeeInfo.employeeName);
  }

  private isValidEmployeeId(employeeId: string): boolean {
    // Employee ID must start with "ASP" followed by exactly 4 digits
    const employeeIdPattern = /^ASP\d{4}$/;
    return employeeIdPattern.test(employeeId.trim());
  }

  private isValidEmployeeName(employeeName: string): boolean {
    // Employee name must contain at least 2 words (first name and last name)
    const nameParts = employeeName.trim().split(' ').filter(part => part.length > 0);
    return nameParts.length >= 2;
  }

  onEmployeeIdInput(event: any): void {
    // Convert to uppercase and remove spaces
    let value = event.target.value.toUpperCase().replace(/\s/g, '');
    
    // Ensure it starts with "ASP"
    if (!value.startsWith('ASP')) {
      value = 'ASP' + value.replace(/^ASP/, '');
    }
    
    // Limit to ASP + 4 digits
    if (value.length > 7) {
      value = value.substring(0, 7);
    }
    
    this.employeeInfo.employeeId = value;
  }

  onEmployeeNameInput(event: any): void {
    // Capitalize first letter of each word
    let value = event.target.value;
    value = value.toLowerCase().replace(/\b\w/g, (char: string) => char.toUpperCase());
    this.employeeInfo.employeeName = value;
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
    
    // Validate that all questions are answered
    const totalQuestions = this.testData.totalQuestions;
    const answeredQuestions = this.answers.length;
    
    console.log('🔍 Finishing test - Validation:');
    console.log(`- Total questions: ${totalQuestions}`);
    console.log(`- Answered questions: ${answeredQuestions}`);
    console.log(`- All answers:`, this.answers);

    if (answeredQuestions !== totalQuestions) {
      alert(`Bạn chưa trả lời đủ tất cả câu hỏi!\nĐã trả lời: ${answeredQuestions}/${totalQuestions} câu`);
      this.isLoading = false;
      return;
    }
    
    const correctAnswers = this.answers.filter(a => a.isCorrect).length;
    const percentage = Math.round((correctAnswers / totalQuestions) * 100);
    const passed = percentage >= this.testData.passingScore;

    console.log(`📊 Test Results:
    - Correct answers: ${correctAnswers}/${totalQuestions}
    - Percentage: ${percentage}%
    - Passed: ${passed}`);

    this.testResult = {
      employeeInfo: this.employeeInfo,
      answers: this.answers,
      score: correctAnswers,
      percentage: percentage,
      passed: passed,
      completedAt: new Date(),
      testData: this.testData
    };

    // DON'T save to Firebase yet - wait for signature first
    console.log('✅ Test completed, waiting for signature before saving to Firebase...');
    
    this.currentView = 'result';
    this.isLoading = false;
    
    // Prompt for signature before saving to Firebase
    this.signatureRequired = true;
    this.showSignaturePad();
  }

  private async saveTestResult(result: TestResult): Promise<void> {
    try {
      console.log('🔍 Saving test result - Debug Info:');
      console.log('Total sections:', result.testData.sections.length);
      console.log('Total answers:', result.answers.length);
      
      // Calculate total questions for verification
      let totalQuestions = 0;
      result.testData.sections.forEach(section => {
        totalQuestions += section.questions.length;
        console.log(`Section "${section.title}": ${section.questions.length} questions`);
      });
      console.log('Calculated total questions:', totalQuestions);

      const resultData: any = {
        employeeId: result.employeeInfo.employeeId,
        employeeName: result.employeeInfo.employeeName,
        score: result.score,
        percentage: result.percentage,
        passed: result.passed,
        totalQuestions: totalQuestions, // Use calculated value
        completedAt: Timestamp.fromDate(result.completedAt),
        testTitle: result.testData.title,
        // Add detailed answers for report generation
        answers: result.answers,
        testData: {
          sections: result.testData.sections.map(section => ({
            title: section.title,
            questions: section.questions.map(q => ({
              question: q.question,
              options: q.options,
              correctAnswer: q.correctAnswer,
              type: q.type
            }))
          }))
        }
      };

      // Add signature if available
      if (result.signature) {
        resultData.signature = result.signature;
      }

      console.log('💾 Data being saved to Firebase:');
      console.log('- Total questions in data:', resultData.totalQuestions);
      console.log('- Number of sections:', resultData.testData.sections.length);
      console.log('- Number of answers:', resultData.answers.length);

      const docRef = await addDoc(collection(this.db, 'temperature-test-results'), resultData);
      console.log('✅ Test result saved with ID: ', docRef.id);
    } catch (error) {
      console.error('❌ Error saving test result: ', error);
    }
  }

  downloadResultFile(): void {
    if (!this.testResult) return;

    // Check if signature is required but not provided
    if (this.signatureRequired && (!this.testResult.signature || this.testResult.signature === '')) {
      alert('Vui lòng ký tên trước khi tải xuống kết quả!');
      this.showSignaturePad();
      return;
    }

    this.generatePDF();
  }

  async generatePDF(): Promise<void> {
    if (!this.testResult) return;

    this.isLoading = true;

    try {
      // Create PDF content as HTML
      const pdfContent = this.createPDFContent();
      
      // Create a temporary container
      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = pdfContent;
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '-9999px';
      tempContainer.style.width = '794px'; // A4 width in pixels at 96 DPI
      tempContainer.style.backgroundColor = 'white';
      tempContainer.style.fontFamily = 'Arial, sans-serif';
      tempContainer.style.fontSize = '14px';
      tempContainer.style.lineHeight = '1.5';
      tempContainer.style.color = '#000';
      tempContainer.style.padding = '40px';
      
      document.body.appendChild(tempContainer);

      // Wait a bit for fonts to load
      await new Promise(resolve => setTimeout(resolve, 100));

      // Convert to canvas using html2canvas
      const canvas = await html2canvas(tempContainer, {
        width: 794,
        height: 1123, // A4 height in pixels at 96 DPI
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      });

      // Remove temporary container
      document.body.removeChild(tempContainer);

      // Create PDF
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 width in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      // Add main page
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);

      // Add detailed answers page if needed
      if (this.testResult.testData.sections.length > 0) {
        const detailsContent = this.createDetailedAnswersContent();
        
        const tempContainer2 = document.createElement('div');
        tempContainer2.innerHTML = detailsContent;
        tempContainer2.style.position = 'absolute';
        tempContainer2.style.left = '-9999px';
        tempContainer2.style.top = '-9999px';
        tempContainer2.style.width = '794px';
        tempContainer2.style.backgroundColor = 'white';
        tempContainer2.style.fontFamily = 'Arial, sans-serif';
        tempContainer2.style.fontSize = '12px';
        tempContainer2.style.lineHeight = '1.4';
        tempContainer2.style.color = '#000';
        tempContainer2.style.padding = '40px';
        
        document.body.appendChild(tempContainer2);

        await new Promise(resolve => setTimeout(resolve, 100));

        const canvas2 = await html2canvas(tempContainer2, {
          width: 794,
          height: 1123,
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff'
        });

        document.body.removeChild(tempContainer2);

        pdf.addPage();
        const imgData2 = canvas2.toDataURL('image/png');
        const imgHeight2 = (canvas2.height * imgWidth) / canvas2.width;
        pdf.addImage(imgData2, 'PNG', 0, 0, imgWidth, imgHeight2);
      }

      // Save the PDF
      const fileName = `Ket_Qua_${this.testResult.employeeInfo.employeeId}_${this.formatDate(this.testResult.completedAt)}.pdf`;
      pdf.save(fileName);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Có lỗi xảy ra khi tạo file PDF. Vui lòng thử lại!');
    } finally {
      this.isLoading = false;
    }
  }

  private createPDFContent(): string {
    if (!this.testResult) return '';

    return `
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="margin: 0 0 10px 0; font-size: 20px; font-weight: bold; color: #2c3e50;">KẾT QUẢ BÀI KIỂM TRA</h1>
        <h2 style="margin: 0 0 8px 0; font-size: 16px; font-weight: normal; color: #34495e;">${this.testResult.testData.title}</h2>

      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px;">
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa; width: 40%;">Mã nhân viên:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${this.testResult.employeeInfo.employeeId}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Tên nhân viên:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${this.testResult.employeeInfo.employeeName}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Ngày thực hiện:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${this.formatDate(this.testResult.completedAt)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Thời gian hoàn thành:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${this.formatTime(this.testResult.completedAt)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Điểm số:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${this.testResult.score}/${this.testResult.testData.totalQuestions}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Tỷ lệ đúng:</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${this.testResult.percentage}%</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; background-color: #f8f9fa;">Kết quả:</td>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold; color: ${this.testResult.passed ? '#27ae60' : '#e74c3c'};">
            ${this.testResult.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}
          </td>
        </tr>
      </table>

      ${this.testResult.signature ? `
        <div style="margin-bottom: 30px;">
          <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: bold; color: #2c3e50;">Chữ ký nhân viên:</h3>
          <div style="border: 2px solid #ddd; padding: 10px; border-radius: 8px; text-align: center; background-color: #f8f9fa;">
            <img src="${this.testResult.signature}" style="max-width: 200px; max-height: 100px;" />
          </div>
        </div>
      ` : ''}

      <div style="text-align: center; margin-top: 50px; font-size: 12px; color: #7f8c8d;">
        <p>Báo cáo được tạo tự động bởi hệ thống vào ${this.formatTime(new Date())} - ${this.formatDate(new Date())}</p>
      </div>
    `;
  }

  private createDetailedAnswersContent(): string {
    if (!this.testResult) return '';

    let content = `
      <div style="margin-bottom: 20px;">
        <h2 style="margin: 0 0 20px 0; font-size: 18px; font-weight: bold; color: #2c3e50; text-align: center;">CHI TIẾT CÂU TRẢ LỜI</h2>
      </div>
    `;

    let questionNumber = 1;
    this.testResult.testData.sections.forEach((section, sectionIndex) => {
      content += `
        <div style="margin-bottom: 15px;">
          <h3 style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; color: #34495e; background-color: #ecf0f1; padding: 8px; border-radius: 4px;">
            ${section.title}
          </h3>
        </div>
      `;

      section.questions.forEach((question, questionIndex) => {
        const answer = this.testResult!.answers.find(a => 
          a.sectionIndex === sectionIndex && a.questionIndex === questionIndex
        );
        
        const isCorrect = answer?.isCorrect || false;

        content += `
          <div style="margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; padding: 12px; background-color: ${isCorrect ? '#d4edda' : '#f8d7da'};">
            <div style="font-weight: bold; margin-bottom: 8px; color: #2c3e50;">
              Câu ${questionNumber}: ${question.question}
            </div>
            <div style="margin-bottom: 4px;">
              <strong>Đáp án chọn:</strong> ${answer?.selectedAnswer || 'Không trả lời'}
            </div>
            <div style="margin-bottom: 4px;">
              <strong>Đáp án đúng:</strong> ${question.correctAnswer}
            </div>
            <div style="font-weight: bold; color: ${isCorrect ? '#27ae60' : '#e74c3c'};">
              ${isCorrect ? '✓ ĐÚNG' : '✗ SAI'}
            </div>
          </div>
        `;
        questionNumber++;
      });
    });

    return content;
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