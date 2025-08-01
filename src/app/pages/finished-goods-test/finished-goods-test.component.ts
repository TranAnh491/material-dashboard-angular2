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
  selector: 'app-finished-goods-test',
  templateUrl: './finished-goods-test.component.html',
  styleUrls: ['./finished-goods-test.component.scss']
})
export class FinishedGoodsTestComponent implements OnInit, AfterViewInit {
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
    title: "HƯỚNG DẪN XUẤT NHẬP KHO THÀNH PHẨM",
    issueDate: "17/07/2025",
    totalQuestions: 12,
    timeLimit: 30,
    passingScore: 90,
    sections: [
      {
        title: "PHẦN I: QUY TRÌNH NHẬP KHO THÀNH PHẨM",
        questions: [
          {
            question: "Khi nhận hàng thành phẩm, bước đầu tiên cần làm là:",
            options: [
              "Kiểm tra số lượng và chất lượng",
              "Ký nhận và lưu kho ngay",
              "Gọi điện báo cáo quản lý",
              "Để hàng ở sân và đi uống nước"
            ],
            correctAnswer: "A",
            type: "multiple-choice"
          },
          {
            question: "Trước khi nhập kho thành phẩm, cần kiểm tra những gì?",
            options: [
              "Chỉ kiểm tra số lượng",
              "Chỉ kiểm tra chất lượng",
              "Kiểm tra cả số lượng và chất lượng",
              "Không cần kiểm tra gì"
            ],
            correctAnswer: "C",
            type: "multiple-choice"
          },
          {
            question: "Khi phát hiện thành phẩm không đạt chất lượng, cần làm gì?",
            options: [
              "Nhập kho bình thường",
              "Từ chối nhập và báo cáo quản lý",
              "Để hàng ở sân và quên đi",
              "Tự ý sửa chữa"
            ],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Khi nhập kho thành phẩm, cần kiểm tra chứng từ gì?",
            options: [
              "Chỉ phiếu nhập kho",
              "Chỉ hóa đơn",
              "Đầy đủ chứng từ theo quy định",
              "Không cần chứng từ"
            ],
            correctAnswer: "C",
            type: "multiple-choice"
          },
          {
            question: "Sau khi nhập kho, thành phẩm cần được:",
            options: [
              "Để nguyên tại cổng kho",
              "Sắp xếp theo vị trí quy định",
              "Để tạm thời ở bất kỳ đâu",
              "Không cần sắp xếp"
            ],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Khi nhập kho thành phẩm, cần ghi chép thông tin gì?",
            options: [
              "Chỉ ghi số lượng",
              "Chỉ ghi ngày nhập",
              "Ghi đầy đủ thông tin theo quy định",
              "Không cần ghi chép"
            ],
            correctAnswer: "C",
            type: "multiple-choice"
          }
        ]
      },
      {
        title: "PHẦN II: QUY TRÌNH XUẤT KHO THÀNH PHẨM",
        questions: [
          {
            question: "Khi xuất kho thành phẩm, cần kiểm tra gì trước?",
            options: [
              "Chỉ kiểm tra số lượng",
              "Chỉ kiểm tra hạn sử dụng",
              "Kiểm tra số lượng và hạn sử dụng",
              "Không cần kiểm tra gì"
            ],
            correctAnswer: "C",
            type: "multiple-choice"
          },
          {
            question: "Nguyên tắc xuất kho thành phẩm là:",
            options: [
              "FIFO (Nhập trước, xuất trước)",
              "LIFO (Nhập sau, xuất trước)",
              "Tùy ý lấy",
              "Lấy theo thứ tự ngẫu nhiên"
            ],
            correctAnswer: "A",
            type: "multiple-choice"
          },
          {
            question: "Khi xuất kho thành phẩm, cần ghi chép gì?",
            options: [
              "Chỉ ghi số lượng",
              "Chỉ ghi ngày xuất",
              "Ghi đầy đủ thông tin xuất kho",
              "Không cần ghi gì"
            ],
            correctAnswer: "C",
            type: "multiple-choice"
          },
          {
            question: "Nếu phát hiện thành phẩm hết hạn khi xuất kho, cần làm gì?",
            options: [
              "Xuất bình thường",
              "Tách riêng và báo cáo quản lý",
              "Vứt đi ngay",
              "Để nguyên vị trí"
            ],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Quy trình xuất kho thành phẩm có cần phê duyệt không?",
            options: [
              "Không cần",
              "Có, cần phê duyệt theo quy định",
              "Chỉ cần khi xuất số lượng lớn",
              "Tùy theo tâm trạng"
            ],
            correctAnswer: "B",
            type: "multiple-choice"
          },
          {
            question: "Sau khi xuất kho thành phẩm, cần cập nhật gì?",
            options: [
              "Chỉ cập nhật sổ sách",
              "Chỉ cập nhật hệ thống",
              "Cập nhật cả sổ sách và hệ thống",
              "Không cần cập nhật gì"
            ],
            correctAnswer: "C",
            type: "multiple-choice"
          }
        ]
      }
    ]
  };

  constructor() { }

  ngOnInit(): void {
    this.calculateTotalQuestions();
    this.initializeFirebase();
  }

  ngAfterViewInit(): void {
    // Initialize signature pad if needed
  }

  private calculateTotalQuestions(): void {
    this.testData.totalQuestions = this.testData.sections.reduce((total, section) => {
      return total + section.questions.length;
    }, 0);
  }

  private async initializeFirebase(): Promise<void> {
    try {
      const app = initializeApp(environment.firebase);
      this.db = getFirestore(app);
    } catch (error) {
      console.error('Error initializing Firebase:', error);
    }
  }

  isEmployeeFormValid(): boolean {
    return this.employeeInfo.employeeId.trim() !== '' && 
           this.employeeInfo.employeeName.trim() !== '';
  }

  startPreview(): void {
    this.currentView = 'preview';
  }

  startTest(): void {
    this.currentView = 'test';
    this.startTime = new Date();
    this.answers = [];
  }

  getCurrentQuestion(): TestQuestion | null {
    if (this.currentSectionIndex >= this.testData.sections.length) return null;
    const section = this.testData.sections[this.currentSectionIndex];
    if (this.currentQuestionIndex >= section.questions.length) return null;
    return section.questions[this.currentQuestionIndex];
  }

  getCurrentSection(): TestSection | null {
    if (this.currentSectionIndex >= this.testData.sections.length) return null;
    return this.testData.sections[this.currentSectionIndex];
  }

  getQuestionNumber(): number {
    let questionNumber = 0;
    for (let i = 0; i < this.currentSectionIndex; i++) {
      questionNumber += this.testData.sections[i].questions.length;
    }
    return questionNumber + this.currentQuestionIndex + 1;
  }

  selectAnswer(answer: string): void {
    const existingAnswerIndex = this.answers.findIndex(a => 
      a.sectionIndex === this.currentSectionIndex && 
      a.questionIndex === this.currentQuestionIndex
    );

    if (existingAnswerIndex >= 0) {
      this.answers[existingAnswerIndex].selectedAnswer = answer;
      this.answers[existingAnswerIndex].isCorrect = this.checkAnswer(
        this.getCurrentQuestion()!, 
        answer
      );
    } else {
      this.answers.push({
        sectionIndex: this.currentSectionIndex,
        questionIndex: this.currentQuestionIndex,
        selectedAnswer: answer,
        isCorrect: this.checkAnswer(this.getCurrentQuestion()!, answer)
      });
    }
  }

  private checkAnswer(question: TestQuestion, answer: string): boolean {
    return answer === question.correctAnswer;
  }

  getSelectedAnswer(): string | null {
    const answer = this.answers.find(a => 
      a.sectionIndex === this.currentSectionIndex && 
      a.questionIndex === this.currentQuestionIndex
    );
    return answer ? answer.selectedAnswer : null;
  }

  nextQuestion(): void {
    if (this.currentQuestionIndex < this.getCurrentSection()!.questions.length - 1) {
      this.currentQuestionIndex++;
    } else if (this.currentSectionIndex < this.testData.sections.length - 1) {
      this.currentSectionIndex++;
      this.currentQuestionIndex = 0;
    } else {
      this.finishTest();
    }
  }

  previousQuestion(): void {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
    } else if (this.currentSectionIndex > 0) {
      this.currentSectionIndex--;
      this.currentQuestionIndex = this.getCurrentSection()!.questions.length - 1;
    }
  }

  canGoNext(): boolean {
    return this.getSelectedAnswer() !== null;
  }

  isLastQuestion(): boolean {
    return this.currentSectionIndex === this.testData.sections.length - 1 && 
           this.currentQuestionIndex === this.getCurrentSection()!.questions.length - 1;
  }

  async finishTest(): Promise<void> {
    if (this.currentSectionIndex < this.testData.sections.length - 1 || 
        this.currentQuestionIndex < this.testData.sections[this.currentSectionIndex].questions.length - 1) {
      return;
    }

    const endTime = new Date();
    const totalCorrect = this.answers.filter(answer => answer.isCorrect).length;
    const percentage = (totalCorrect / this.testData.totalQuestions) * 100;
    const passed = percentage >= this.testData.passingScore;

    this.testResult = {
      employeeInfo: this.employeeInfo,
      answers: [...this.answers],
      score: totalCorrect,
      percentage: percentage,
      passed: passed,
      completedAt: endTime,
      testData: this.testData
    };

    // Save to Firebase
    await this.saveTestResult(this.testResult);

    // Show signature pad
    this.showSignature = true;
    this.currentView = 'result';

    // Initialize signature pad after view is updated
    setTimeout(() => {
      this.initializeSignaturePad();
    }, 100);
  }

  private async saveTestResult(result: TestResult): Promise<void> {
    try {
      console.log('Saving test result:', result);

      // Calculate total questions for verification
      let totalQuestions = 0;
      result.testData.sections.forEach(section => {
        totalQuestions += section.questions.length;
        console.log(`Section "${section.title}": ${section.questions.length} questions`);
      });
      console.log('Calculated total questions:', totalQuestions);

      // Save to finished goods test results
      const testResultData: any = {
        employeeId: result.employeeInfo.employeeId,
        employeeName: result.employeeInfo.employeeName,
        score: result.score,
        percentage: result.percentage,
        passed: result.passed,
        totalQuestions: totalQuestions,
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
        testResultData.signature = result.signature;
      }

      console.log('💾 Data being saved to Firebase:');
      console.log('- Total questions in data:', testResultData.totalQuestions);
      console.log('- Number of sections:', testResultData.testData.sections.length);
      console.log('- Number of answers:', testResultData.answers.length);

      const docRef = await addDoc(collection(this.db, 'finished-goods-test-results'), testResultData);
      console.log('✅ Test result saved with ID: ', docRef.id);

      this.showNotification = true;
      setTimeout(() => {
        this.showNotification = false;
      }, 3000);
    } catch (error) {
      console.error('Error saving test result:', error);
      alert('Có lỗi xảy ra khi lưu kết quả: ' + error);
      this.showNotification = true;
      setTimeout(() => {
        this.showNotification = false;
      }, 3000);
    }
  }

  // Signature Pad Methods
  private initializeSignaturePad(): void {
    setTimeout(() => {
      if (this.signatureCanvas && this.signatureCanvas.nativeElement && !this.signaturePad) {
        try {
          this.signaturePad = new SignaturePad(this.signatureCanvas.nativeElement, {
            backgroundColor: 'white',
            penColor: 'black',
            minWidth: 1,
            maxWidth: 2.5,
            throttle: 16 // Add throttle to prevent lag
          });
          console.log('Signature pad initialized successfully');
        } catch (error) {
          console.error('Error initializing signature pad:', error);
        }
      }
    }, 100);
  }

  clearSignature(): void {
    if (this.signaturePad) {
      this.signaturePad.clear();
    }
  }

  isSignatureEmpty(): boolean {
    return this.signaturePad ? this.signaturePad.isEmpty() : true;
  }

  async saveSignature(): Promise<void> {
    if (this.signaturePad && !this.isSignatureEmpty()) {
      const signatureData = this.signaturePad.toDataURL();
      if (this.testResult) {
        this.testResult.signature = signatureData;
        // Update in Firebase
        // You can add signature update logic here if needed
      }
    }
  }

  async skipSignature(): Promise<void> {
    this.showSignature = false;
    // Continue without signature
  }

  downloadResultFile(): void {
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

      // Add detailed answers pages if needed
      if (this.testResult.testData.sections.length > 0) {
        const detailsContent = this.createDetailedAnswersContent();
        
        // Split content into multiple pages if needed
        const contentParts = this.splitContentIntoPages(detailsContent);
        
        for (let i = 0; i < contentParts.length; i++) {
          const tempContainer2 = document.createElement('div');
          tempContainer2.innerHTML = contentParts[i];
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

          console.log(`Creating detailed answers canvas page ${i + 1} with content length:`, contentParts[i].length);
          const canvas2 = await html2canvas(tempContainer2, {
            width: 794,
            height: 1123,
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff'
          });
          console.log(`Canvas page ${i + 1} created with dimensions:`, canvas2.width, 'x', canvas2.height);

          document.body.removeChild(tempContainer2);

          pdf.addPage();
          const imgData2 = canvas2.toDataURL('image/png');
          const imgHeight2 = (canvas2.height * imgWidth) / canvas2.width;
          pdf.addImage(imgData2, 'PNG', 0, 0, imgWidth, imgHeight2);
        }
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

    let signatureHtml = '';
    if (this.testResult.signature) {
      signatureHtml = `
        <div style="margin-top: 30px; text-align: center;">
          <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; color: #2c3e50;">CHỮ KÝ XÁC NHẬN:</h4>
          <img src="${this.testResult.signature}" style="max-width: 200px; height: auto; border: 1px solid #ccc;" />
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #666;">Người làm bài: ${this.getFormattedEmployeeName()}</p>
          <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Ngày: ${this.formatDate(this.testResult.completedAt)}</p>
        </div>
      `;
    }

    return `
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="margin: 0 0 10px 0; font-size: 20px; font-weight: bold; color: #2c3e50;">AIRSPEED MANUFACTURING VIỆT NAM</h1>
        <h2 style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #34495e;">BÁO CÁO THỰC HÀNH ĐÀO TẠO NỘI BỘ</h2>
        <h3 style="margin: 0 0 20px 0; font-size: 14px; font-weight: bold; color: #34495e;">HƯỚNG DẪN XUẤT NHẬP KHO THÀNH PHẨM</h3>
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; color: #2c3e50;">THÔNG TIN NHÂN VIÊN:</h4>
        <ul style="margin: 0; padding-left: 20px; list-style-type: none;">
          <li style="margin-bottom: 5px;">- Mã số: ${this.testResult.employeeInfo.employeeId}</li>
          <li style="margin-bottom: 5px;">- Họ tên: ${this.getFormattedEmployeeName()}</li>
          <li style="margin-bottom: 5px;">- Ngày kiểm tra: ${this.formatDate(this.testResult.completedAt)}</li>
          <li style="margin-bottom: 5px;">- Thời gian hoàn thành: ${this.formatTime(this.testResult.completedAt)}</li>
        </ul>
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; color: #2c3e50;">KẾT QUẢ KIỂM TRA:</h4>
        <ul style="margin: 0; padding-left: 20px; list-style-type: none;">
          <li style="margin-bottom: 5px;">- Số câu đúng: ${this.testResult.score}/${this.testResult.testData.totalQuestions}</li>
          <li style="margin-bottom: 5px;">- Tỷ lệ đạt: ${this.testResult.percentage.toFixed(1)}%</li>
          <li style="margin-bottom: 5px;">- Kết quả: ${this.testResult.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}</li>
          <li style="margin-bottom: 5px;">- Điểm đạt yêu cầu: ${this.testResult.testData.passingScore}%</li>
        </ul>
      </div>
      ${signatureHtml}
    `;
  }

  private createDetailedAnswersContent(): string {
    if (!this.testResult) return '';
    
    let content = '<div style="margin-top: 20px;"><h4 style="margin: 0 0 15px 0; font-size: 14px; font-weight: bold; color: #2c3e50;">CHI TIẾT CÂU TRẢ LỜI:</h4>';
    
    this.testResult.testData.sections.forEach((section, sectionIndex) => {
      content += `<div style="margin-bottom: 15px;"><h5 style="margin: 0 0 10px 0; font-size: 13px; font-weight: bold; color: #34495e;">${section.title}:</h5>`;
      
      section.questions.forEach((question, questionIndex) => {
        const answer = this.testResult!.answers.find(a => 
          a.sectionIndex === sectionIndex && a.questionIndex === questionIndex
        );
        const hasAnswer = answer !== undefined;
        const correctIcon = hasAnswer ? (answer?.isCorrect ? '✅' : '❌') : '❌';
        
        content += `<div style="margin-bottom: 10px; padding: 10px; border-left: 3px solid ${hasAnswer ? (answer?.isCorrect ? '#27ae60' : '#e74c3c') : '#95a5a6'}; background-color: ${hasAnswer ? (answer?.isCorrect ? '#d5f4e6' : '#fadbd8') : '#f8f9fa'};">`;
        content += `<p style="margin: 0 0 5px 0; font-weight: bold;">${this.getDetailedQuestionNumber(sectionIndex, questionIndex)}. ${question.question}</p>`;
        
        // Add options if multiple choice
        if (question.options && question.options.length > 0) {
          question.options.forEach((option, optionIndex) => {
            const optionLabel = this.getOptionLabel(optionIndex);
            const isSelected = hasAnswer && answer?.selectedAnswer === optionLabel;
            const isCorrect = question.correctAnswer === optionLabel;
            let optionStyle = '';
            
            if (hasAnswer) {
              if (isSelected && isCorrect) {
                optionStyle = 'color: #27ae60; font-weight: bold;';
              } else if (isSelected && !isCorrect) {
                optionStyle = 'color: #e74c3c; font-weight: bold;';
              } else if (!isSelected && isCorrect) {
                optionStyle = 'color: #27ae60; font-weight: bold;';
              }
            }
            
            content += `<p style="margin: 0 0 2px 0; font-size: 11px; padding-left: 10px; ${optionStyle}">${optionLabel}. ${option}</p>`;
          });
        }
        
        if (hasAnswer) {
          content += `<p style="margin: 0 0 3px 0; font-size: 12px;">Đáp án chọn: ${answer?.selectedAnswer} ${correctIcon}</p>`;
        } else {
          content += `<p style="margin: 0 0 3px 0; font-size: 12px; color: #e74c3c;">Không trả lời ❌</p>`;
        }
        content += `<p style="margin: 0; font-size: 12px;">Đáp án đúng: ${question.correctAnswer}</p>`;
        content += '</div>';
      });
      
      content += '</div>';
    });
    
    content += '</div>';
    return content;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('vi-VN');
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('vi-VN');
  }

  private splitContentIntoPages(content: string): string[] {
    // For Finished Goods Test with 12 questions, split into 2 pages: 6 questions each
    const sections = content.split('<div style="margin-bottom: 15px;">');
    const pages: string[] = [];
    
    if (sections.length <= 1) {
      // If only one section, split by questions
      const questions = content.split('<div style="margin-bottom: 10px; padding: 10px;');
      const midPoint = Math.ceil(questions.length / 2);
      
      const page1 = questions.slice(0, midPoint).join('<div style="margin-bottom: 10px; padding: 10px;');
      const page2 = questions.slice(midPoint).join('<div style="margin-bottom: 10px; padding: 10px;');
      
      if (page1) pages.push(page1);
      if (page2) pages.push(page2);
    } else {
      // If multiple sections, put each section on its own page
      for (let i = 0; i < sections.length; i++) {
        const section = i === 0 ? sections[i] : '<div style="margin-bottom: 15px;">' + sections[i];
        if (section.trim()) {
          pages.push(section);
        }
      }
    }
    
    console.log(`Split content into ${pages.length} pages`);
    return pages;
  }

  restartTest(): void {
    this.currentView = 'employee-form';
    this.employeeInfo = { employeeId: '', employeeName: '' };
    this.answers = [];
    this.testResult = null;
    this.startTime = null;
    this.currentSectionIndex = 0;
    this.currentQuestionIndex = 0;
  }

  getAnswerResult(sectionIndex: number, questionIndex: number): TestAnswer | undefined {
    return this.testResult?.answers.find(a => 
      a.sectionIndex === sectionIndex && a.questionIndex === questionIndex
    );
  }

  getDetailedQuestionNumber(sectionIndex: number, questionIndex: number): number {
    let questionNumber = 0;
    for (let i = 0; i < sectionIndex; i++) {
      questionNumber += this.testData.sections[i].questions.length;
    }
    return questionNumber + questionIndex + 1;
  }

  getOptionLabel(index: number): string {
    return String.fromCharCode(65 + index); // A, B, C, D...
  }

  downloadWHWI0005Document(part: 'Part A' | 'Part B' | 'Full') {
    const documentUrls = {
      'Part A': 'https://docs.google.com/document/d/your-part-a-document-id/edit',
      'Part B': 'https://docs.google.com/document/d/your-part-b-document-id/edit', 
      'Full': 'https://docs.google.com/document/d/your-full-document-id/edit'
    };
    
    const url = documentUrls[part];
    if (url) {
      window.open(url, '_blank');
      console.log(`Downloading WH-WI0005 ${part} document`);
    } else {
      alert('Liên kết tài liệu chưa được cấu hình. Vui lòng liên hệ quản trị viên.');
    }
  }

  downloadSampleForm(): void {
    this.isLoading = true;
    
    // Create mock test result for sample
    const mockTestResult: TestResult = {
      employeeInfo: {
        employeeId: 'NV001',
        employeeName: 'NGUYỄN VĂN A'
      },
      answers: [],
      score: 16,
      percentage: 80.0,
      passed: true,
      completedAt: new Date(),
      testData: this.testData
    };

    // Temporarily set testResult to mock data
    const originalTestResult = this.testResult;
    this.testResult = mockTestResult;

    // Generate sample PDF
    this.generatePDF().finally(() => {
      // Restore original test result
      this.testResult = originalTestResult;
      this.isLoading = false;
    });
  }

  getFormattedEmployeeName(): string {
    if (!this.employeeInfo.employeeName) return '';
    
    // Split the name into words and capitalize first letter of each word
    return this.employeeInfo.employeeName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}