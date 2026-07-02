import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnInit,
  ViewChild
} from '@angular/core';
import html2canvas from 'html2canvas';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { firstValueFrom } from 'rxjs';
import { QUIZ_DOC_META, WAREHOUSE_QUIZ_SECTIONS, QuizSection } from './warehouse-training-quiz.data';

export interface WarehouseQuizSavedRecord {
  id: string;
  fullName: string;
  employeeId: string;
  joinDate: string;
  sectionId: string;
  sectionTitle: string;
  resultText: string;
  imageDataUrl?: string;
  /** Bản ghi cũ (Storage) — tương thích ngược */
  storagePath?: string;
  downloadUrl?: string;
  completedAt?: firebase.firestore.Timestamp;
  createdAt?: firebase.firestore.Timestamp;
}

@Component({
  selector: 'app-warehouse-training-quiz',
  templateUrl: './warehouse-training-quiz.component.html',
  styleUrls: ['./warehouse-training-quiz.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseTrainingQuizComponent implements OnInit {
  @ViewChild('traineeCanvas') traineeCanvas?: ElementRef<HTMLCanvasElement>;

  /** Cùng pattern với temperature-test-results, materials-test-results */
  private readonly RESULTS_COLLECTION = 'warehouse-training-quiz-results';
  private readonly DEFAULT_CORRECT_OPTION_INDEX = 1;
  private readonly FIRESTORE_IMAGE_MAX_CHARS = 900_000;

  sections: QuizSection[] = WAREHOUSE_QUIZ_SECTIONS;
  displaySections: QuizSection[] = [];
  docMeta = QUIZ_DOC_META;
  logoSrc = '/assets/img/logo.png';
  isExporting = false;
  isLoadingSaved = false;
  deletingRecordId = '';
  isCapturingForSave = false;
  captureStampLabel = '';
  captureStampPass = false;
  activeSectionId = WAREHOUSE_QUIZ_SECTIONS[0].id;
  savedRecords: WarehouseQuizSavedRecord[] = [];

  employeeInfo = {
    fullName: '',
    employeeId: '',
    joinDate: ''
  };

  answers: Record<string, string> = {};
  resultScore = '';
  traineeSignature = '';

  private readonly minCorrectPerSection = 6;
  private correctAnswerByKey: Record<string, string> = {};

  private drawingTarget: 'trainee' | null = null;
  private isDrawing = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private firestore: AngularFirestore
  ) {
    this.buildShuffledSections();
    this.recomputeResultScore();
  }

  ngOnInit(): void {
    void this.loadSavedRecords();
  }

  get activeSection(): QuizSection {
    return this.sections.find(s => s.id === this.activeSectionId) ?? this.sections[0];
  }

  get activeDisplaySection(): QuizSection {
    return this.displaySections.find(s => s.id === this.activeSectionId) ?? this.displaySections[0];
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
    this.buildShuffledSections();
    this.recomputeResultScore();
    this.traineeSignature = '';
    this.clearCanvas('trainee');
    this.cdr.markForCheck();
  }

  private buildShuffledSections(): void {
    this.correctAnswerByKey = {};
    this.displaySections = this.sections.map(section => ({
      ...section,
      questions: section.questions.map(q => {
        const correctIdx = q.correctIndex ?? this.DEFAULT_CORRECT_OPTION_INDEX;
        const correctText = q.options[correctIdx];
        const shuffled = this.shuffleArray([...q.options]);
        this.correctAnswerByKey[this.answerKey(section.id, q.number)] = correctText;
        return { ...q, options: shuffled };
      })
    }));
  }

  private shuffleArray<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private sectionCorrectCount(section: QuizSection): number {
    let correct = 0;
    for (const q of section.questions) {
      const key = this.answerKey(section.id, q.number);
      const selected = this.answers[key];
      const expected = this.correctAnswerByKey[key];
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

  private getCanvas(target: 'trainee'): HTMLCanvasElement | null {
    return target === 'trainee' ? this.traineeCanvas?.nativeElement ?? null : null;
  }

  private getCtx(target: 'trainee'): CanvasRenderingContext2D | null {
    const canvas = this.getCanvas(target);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = '#000';
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

  startSign(event: MouseEvent | TouchEvent, target: 'trainee'): void {
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

  moveSign(event: MouseEvent | TouchEvent, target: 'trainee'): void {
    if (!this.isDrawing || this.drawingTarget !== target) return;
    event.preventDefault();
    const canvas = this.getCanvas(target);
    const ctx = this.getCtx(target);
    if (!canvas || !ctx) return;
    const p = this.canvasPoint(event, canvas);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  endSign(target: 'trainee'): void {
    if (this.drawingTarget !== target) return;
    this.isDrawing = false;
    this.drawingTarget = null;
    const canvas = this.getCanvas(target);
    if (!canvas) return;
    this.traineeSignature = canvas.toDataURL('image/png');
    this.cdr.markForCheck();
  }

  clearCanvas(target: 'trainee'): void {
    const canvas = this.getCanvas(target);
    const ctx = this.getCtx(target);
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.traineeSignature = '';
    this.cdr.markForCheck();
  }

  async downloadImage(): Promise<void> {
    const el = document.getElementById('warehouseQuizPrintArea');
    if (!el) return;
    this.isExporting = true;
    this.cdr.markForCheck();
    try {
      const sectionResult = this.buildSectionResultText(this.activeSection);
      const blob = await this.buildImageBlobForExport(el, sectionResult.pass);
      const safeName = (this.employeeInfo.fullName || 'nhan-vien').replace(/\s+/g, '_');
      const sectionSlug = this.activeSection.id.replace(/\s+/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KT_Dao_Tao_Kho_${sectionSlug}_${safeName}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Không tạo được file hình. Vui lòng thử lại.');
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  private async withCaptureLayout<T>(pass: boolean, action: () => Promise<T>): Promise<T> {
    this.captureStampLabel = pass ? 'ĐẠT' : 'KHÔNG ĐẠT';
    this.captureStampPass = pass;
    this.isCapturingForSave = true;
    this.cdr.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 80));
    try {
      return await action();
    } finally {
      this.isCapturingForSave = false;
      this.captureStampLabel = '';
      this.captureStampPass = false;
      this.cdr.markForCheck();
    }
  }

  private async buildImageBlobForExport(el: HTMLElement, pass: boolean): Promise<Blob> {
    return await this.withCaptureLayout(pass, () =>
      this.buildImageBlobFromPrintArea(el, 2, 'image/png')
    );
  }

  private async buildImageBlobFromPrintArea(
    el: HTMLElement,
    scale = 2,
    mime: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.92
  ): Promise<Blob> {
    const canvas = await html2canvas(el, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Không tạo được file hình'))),
        mime,
        quality
      );
    });
  }

  /** Nén JPEG để lưu Firestore (giới hạn ~1MB/doc) */
  private async buildImageDataUrlForSave(el: HTMLElement, pass: boolean): Promise<string> {
    return await this.withCaptureLayout(pass, async () => {
      const canvas = await html2canvas(el, {
        scale: 1.25,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });
      for (let quality = 0.85; quality >= 0.45; quality -= 0.05) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= this.FIRESTORE_IMAGE_MAX_CHARS) return dataUrl;
      }
      throw new Error('Ảnh quá lớn để lưu Firebase. Vui lòng thử lại.');
    });
  }

  private isSectionCompleted(section: QuizSection): boolean {
    return this.sectionAnsweredCount(section.id) >= (section.questions?.length || 0);
  }

  private buildSectionResultText(section: QuizSection): { text: string; pass: boolean } {
    const correct = this.sectionCorrectCount(section);
    const total = section.questions.length || 0;
    const pass = correct >= this.minCorrectPerSection;
    const text = `${section.title}: ${correct}/${total} (${pass ? 'Đạt' : 'Không đạt'})`;
    return { text, pass };
  }

  private mapSavedDoc(id: string, data: any): WarehouseQuizSavedRecord {
    return {
      id,
      fullName: String(data.fullName || data.employeeName || ''),
      employeeId: String(data.employeeId || ''),
      joinDate: String(data.joinDate || ''),
      sectionId: String(data.sectionId || ''),
      sectionTitle: String(data.sectionTitle || ''),
      resultText: String(data.resultText || ''),
      imageDataUrl: data.imageDataUrl ? String(data.imageDataUrl) : undefined,
      storagePath: data.storagePath ? String(data.storagePath) : undefined,
      downloadUrl: data.downloadUrl ? String(data.downloadUrl) : undefined,
      completedAt: data.completedAt || data.createdAt,
      createdAt: data.createdAt
    };
  }

  async loadSavedRecords(): Promise<void> {
    this.isLoadingSaved = true;
    this.cdr.markForCheck();
    try {
      const snap = await firstValueFrom(
        this.firestore
          .collection(this.RESULTS_COLLECTION, ref =>
            ref.orderBy('completedAt', 'desc').limit(50)
          )
          .get()
      );
      this.savedRecords = snap.docs.map(doc => this.mapSavedDoc(doc.id, doc.data()));
    } catch (e) {
      console.error(e);
    } finally {
      this.isLoadingSaved = false;
      this.cdr.markForCheck();
    }
  }

  downloadSavedRecord(record: WarehouseQuizSavedRecord): void {
    try {
      if (record.imageDataUrl) {
        const ext = record.imageDataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png';
        const safeName = (record.fullName || 'nhan-vien').replace(/\s+/g, '_');
        const a = document.createElement('a');
        a.href = record.imageDataUrl;
        a.download = `KT_Dao_Tao_Kho_${record.sectionId}_${safeName}.${ext}`;
        a.click();
        return;
      }
      if (record.downloadUrl) {
        window.open(record.downloadUrl, '_blank', 'noopener');
        return;
      }
      alert('Không tìm thấy file hình trong bản ghi này.');
    } catch (e) {
      console.error(e);
      alert('Không tải được file hình. Vui lòng thử lại.');
    }
  }

  async deleteSavedRecord(record: WarehouseQuizSavedRecord): Promise<void> {
    if (!record.id) return;
    const label = [record.fullName, record.sectionTitle].filter(Boolean).join(' — ') || record.id;
    if (!confirm(`Xóa bài kiểm tra đã lưu?\n\n${label}`)) return;

    this.deletingRecordId = record.id;
    this.cdr.markForCheck();
    try {
      await this.firestore.collection(this.RESULTS_COLLECTION).doc(record.id).delete();
      this.savedRecords = this.savedRecords.filter(r => r.id !== record.id);
    } catch (e) {
      console.error(e);
      alert('Không xóa được bản ghi. Vui lòng thử lại.');
    } finally {
      this.deletingRecordId = '';
      this.cdr.markForCheck();
    }
  }

  formatSavedAt(record: WarehouseQuizSavedRecord): string {
    const ts = record.completedAt || record.createdAt;
    if (!ts?.toDate) return '—';
    return ts.toDate().toLocaleString('vi-VN', { hour12: false });
  }

  async completeQuiz(): Promise<void> {
    const el = document.getElementById('warehouseQuizPrintArea');
    if (!el) return;

    const section = this.activeSection;
    if (!this.isSectionCompleted(section)) {
      alert(`Vui lòng làm đủ câu hỏi ở phần "${section.title}" trước khi hoàn thành.`);
      return;
    }
    if (!this.traineeSignature) {
      alert('Vui lòng ký tên (Người được đào tạo) trước khi hoàn thành.');
      return;
    }

    this.isExporting = true;
    this.cdr.markForCheck();
    try {
      const sectionResult = this.buildSectionResultText(section);
      this.resultScore = `${sectionResult.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'} — ${sectionResult.text}`;

      const imageDataUrl = await this.buildImageDataUrlForSave(el, sectionResult.pass);

      const employeeId = String(this.employeeInfo.employeeId || '').trim().slice(0, 40);
      const fullName = String(this.employeeInfo.fullName || '').trim().slice(0, 120);
      const joinDate = String(this.employeeInfo.joinDate || '').trim().slice(0, 40);
      const resultText = String(this.resultScore || '').trim().slice(0, 600);
      const sectionId = String(section.id || '').trim().slice(0, 40);

      const docRef = await this.firestore.collection(this.RESULTS_COLLECTION).add({
        employeeId,
        employeeName: fullName,
        fullName,
        joinDate,
        sectionId,
        sectionTitle: section.title,
        resultText,
        passed: sectionResult.pass,
        signature: this.traineeSignature,
        imageDataUrl,
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      this.savedRecords = [
        {
          id: docRef.id,
          fullName,
          employeeId,
          joinDate,
          sectionId,
          sectionTitle: section.title,
          resultText,
          imageDataUrl
        },
        ...this.savedRecords
      ].slice(0, 50);

      alert('✅ Đã hoàn thành. File hình đã lưu trên Firebase — có thể tải lại ở danh sách bên dưới.');
    } catch (e: any) {
      console.error(e);
      alert(`❌ Không lưu được file hình.\n\n${e?.message || e}`);
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  printQuiz(): void {
    window.print();
  }
}
