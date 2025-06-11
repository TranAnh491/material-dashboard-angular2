import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UiStateService {
  public isSidebarVisible$ = new BehaviorSubject<boolean>(true);

  constructor() { }

  public showSidebar(): void {
    this.isSidebarVisible$.next(true);
  }

  public hideSidebar(): void {
    this.isSidebarVisible$.next(false);
  }
} 