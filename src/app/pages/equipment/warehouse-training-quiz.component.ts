import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  ViewChild
} from '@angular/core';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { QUIZ_DOC_META, WAREHOUSE_QUIZ_SECTIONS, QuizSection } from './warehouse-training-quiz.data';

@Component({
  selector: 'app-warehouse-training-quiz',
  templateUrl: './warehouse-training-quiz.component.html',
  styleUrls: ['./warehouse-training-quiz.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseTrainingQuizComponent {
  @ViewChild('traineeCanvas') traineeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('trainerCanvas') trainerCanvas?: ElementRef<HTMLCanvasElement>;

  sections: QuizSection[] = WAREHOUSE_QUIZ_SECTIONS;
  docMeta = QUIZ_DOC_META;
  logoSrc = '/assets/img/logo.png';
  isExportingPdf = false;
  activeSectionId = WAREHOUSE_QUIZ_SECTIONS[0].id;

  employeeInfo = {
    fullName: '',
    employeeId: '',
    joinDate: ''
  };

  answers: Record<number, string> = {};
  resultScore = '';
  traineeSignature = '';
  trainerSignature = '';

  /** Đạt khi đúng >= 6 câu ở MỖI bài (mỗi phần 8 câu). */
  private readonly minCorrectPerSection = 6;
  /** Theo đáp án chuẩn hiện tại: tất cả câu đúng là lựa chọn B. (A,B,C,D => index 1) */
  private readonly defaultCorrectOptionIndex = 1;

  private drawingTarget: 'trainee' | 'trainer' | null = null;
  private isDrawing = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private fns: AngularFireFunctions
  ) {
    this.recomputeResultScore();
  }

  get activeSection(): QuizSection {
    return this.sections.find(s => s.id === this.activeSectionId) ?? this.sections[0];
  }

  selectSection(sectionId: string): void {
    this.activeSectionId = sectionId;
    this.cdr.markForCheck();
  }

  answerKey(sectionId: string, questionNum: number): string {
    return `${sectionId}-${questionNum}`;
  }

  sectionAnsweredCount(sectionId: string): number {
    const section = this.sections.find(s => s.id === sectionId);
    if (!section) return 0;
    return section.questions.filter(q => !!this.answers[this.answerKey(sectionId, q.number)]).length;
  }

  setAnswer(sectionId: string, questionNum: number, value: string): void {
    this.answers[this.answerKey(sectionId, questionNum)] = value;
    this.recomputeResultScore();
    this.cdr.markForCheck();
  }

  resetQuiz(): void {
    this.activeSectionId = WAREHOUSE_QUIZ_SECTIONS[0].id;
    this.employeeInfo = { fullName: '', employeeId: '', joinDate: '' };
    this.answers = {};
    this.recomputeResultScore();
    this.traineeSignature = '';
    this.trainerSignature = '';
    this.clearCanvas('trainee');
    this.clearCanvas('trainer');
    this.cdr.markForCheck();
  }

  private correctOptionIndexFor(sectionId: string, questionNum: number): number {
    // If later you need exceptions per câu, override here by sectionId/questionNum.
    return this.defaultCorrectOptionIndex;
  }

  private sectionCorrectCount(section: QuizSection): number {
    let correct = 0;
    for (const q of section.questions) {
      const selected = this.answers[this.answerKey(section.id, q.number)];
      if (!selected) continue;
      const idx = this.correctOptionIndexFor(section.id, q.number);
      const expected = q.options?.[idx];
      if (expected != null && selected === expected) correct++;
    }
    return correct;
  }

  private recomputeResultScore(): void {
    const results = this.sections.map(s => {
      const correct = this.sectionCorrectCount(s);
      const total = s.questions.length || 0;
      const pass = correct >= this.minCorrectPerSection;
      return { section: s, correct, total, pass };
    });

    const overallPass = results.length > 0 && results.every(r => r.pass);
    const detail = results
      .map(r => `${r.section.title}: ${r.correct}/${r.total} (${r.pass ? 'Đạt' : 'Không đạt'})`)
      .join(' | ');
    this.resultScore = `${overallPass ? 'ĐẠT' : 'KHÔNG ĐẠT'} — ${detail}`;
  }

  private getCanvas(target: 'trainee' | 'trainer'): HTMLCanvasElement | null {
    const el = target === 'trainee' ? this.traineeCanvas : this.trainerCanvas;
    return el?.nativeElement ?? null;
  }

  private getCtx(target: 'trainee' | 'trainer'): CanvasRenderingContext2D | null {
    const canvas = this.getCanvas(target);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }

  private canvasPoint(event: MouseEvent | TouchEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  startSign(event: MouseEvent | TouchEvent, target: 'trainee' | 'trainer'): void {
    event.preventDefault();
    const canvas = this.getCanvas(target);
    const ctx = this.getCtx(target);
    if (!canvas || !ctx) return;
    this.drawingTarget = target;
    this.isDrawing = true;
    const p = this.canvasPoint(event, canvas);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  moveSign(event: MouseEvent | TouchEvent, target: 'trainee' | 'trainer'): void {
    if (!this.isDrawing || this.drawingTarget !== target) return;
    event.preventDefault();
    const canvas = this.getCanvas(target);
    const ctx = this.getCtx(target);
    if (!canvas || !ctx) return;
    const p = this.canvasPoint(event, canvas);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  endSign(target: 'trainee' | 'trainer'): void {
    if (this.drawingTarget !== target) return;
    this.isDrawing = false;
    this.drawingTarget = null;
    const canvas = this.getCanvas(target);
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    if (target === 'trainee') {
      this.traineeSignature = data;
    } else {
      this.trainerSignature = data;
    }
    this.cdr.markForCheck();
  }

  clearCanvas(target: 'trainee' | 'trainer'): void {
    const canvas = this.getCanvas(target);
    const ctx = this.getCtx(target);
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (target === 'trainee') {
      this.traineeSignature = '';
    } else {
      this.trainerSignature = '';
    }
    this.cdr.markForCheck();
  }

  async downloadPdf(): Promise<void> {
    const el = document.getElementById('warehouseQuizPrintArea');
    if (!el) return;
    this.isExportingPdf = true;
    this.cdr.markForCheck();
    try {
      const pdf = await this.buildPdfFromPrintArea(el);
      const safeName = (this.employeeInfo.fullName || 'nhan-vien').replace(/\s+/g, '_');
      const sectionSlug = this.activeSection.id.replace(/\s+/g, '_');
      pdf.save(`KT_Dao_Tao_Kho_${sectionSlug}_${safeName}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Không tạo được PDF. Vui lòng thử lại.');
    } finally {
      this.isExportingPdf = false;
      this.cdr.markForCheck();
    }
  }

  private async buildPdfFromPrintArea(el: HTMLElement): Promise<jsPDF> {
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });
    const img = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    let heightLeft = imgH;
    let position = margin;

    pdf.addImage(img, 'PNG', margin, position, imgW, imgH);
    heightLeft -= pageH - margin * 2;

    while (heightLeft > 0) {
      position = heightLeft - imgH + margin;
      pdf.addPage();
      pdf.addImage(img, 'PNG', margin, position, imgW, imgH);
      heightLeft -= pageH - margin * 2;
    }
    return pdf;
  }

  private allSectionsCompleted(): boolean {
    return this.sections.every(s => this.sectionAnsweredCount(s.id) >= (s.questions?.length || 0));
  }

  private async blobToDataUrl(blob: Blob): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Không đọc được file PDF'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }

  async completeQuiz(): Promise<void> {
    const el = document.getElementById('warehouseQuizPrintArea');
    if (!el) return;

    if (!this.allSectionsCompleted()) {
      alert('Vui lòng làm đủ câu hỏi ở tất cả các phần trước khi hoàn thành.');
      return;
    }
    if (!this.traineeSignature || !this.trainerSignature) {
      alert('Vui lòng ký tên (cả Người được đào tạo và Người hướng dẫn) trước khi hoàn thành.');
      return;
    }

    this.isExportingPdf = true;
    this.cdr.markForCheck();
    try {
      // đảm bảo kết quả đang là mới nhất
      this.recomputeResultScore();

      const pdf = await this.buildPdfFromPrintArea(el);
      const pdfBlob = pdf.output('blob') as Blob;
      const pdfDataUrl = await this.blobToDataUrl(pdfBlob);

      const callable = this.fns.httpsCallable('sendWarehouseTrainingQuizPdfZaloFn');
      await callable({
        employeeId: String(this.employeeInfo.employeeId || '').trim().slice(0, 40),
        fullName: String(this.employeeInfo.fullName || '').trim().slice(0, 120),
        joinDate: String(this.employeeInfo.joinDate || '').trim().slice(0, 40),
        resultText: String(this.resultScore || '').trim().slice(0, 600),
        pdfDataUrl
      }).toPromise();

      alert('✅ Đã hoàn thành. PDF đã được gửi qua Zalo quản lý kho.');
    } catch (e: any) {
      console.error(e);
      alert(`❌ Không gửi được PDF qua Zalo.\n\n${e?.message || e}`);
    } finally {
      this.isExportingPdf = false;
      this.cdr.markForCheck();
    }
  }

  printQuiz(): void {
    window.print();
  }
}
