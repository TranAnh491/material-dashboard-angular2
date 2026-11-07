import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AppLang = 'vi' | 'en';

/** Ngôn ngữ dùng chung toàn app — nút VI/EN ở màn đăng nhập ghi vào đây (localStorage `preferredLanguage`). */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly subject = new BehaviorSubject<AppLang>(this.readSaved());
  readonly lang$ = this.subject.asObservable();

  get lang(): AppLang {
    return this.subject.value;
  }

  set(lang: AppLang): void {
    try {
      localStorage.setItem('preferredLanguage', lang);
    } catch {
      /* bỏ qua */
    }
    this.subject.next(lang);
  }

  private readSaved(): AppLang {
    try {
      return localStorage.getItem('preferredLanguage') === 'en' ? 'en' : 'vi';
    } catch {
      return 'vi';
    }
  }
}
