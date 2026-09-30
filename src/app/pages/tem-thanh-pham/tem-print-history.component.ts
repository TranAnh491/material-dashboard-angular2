import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { loadTemPrintHistory, stageTemRestore, TemPrintRecord } from './tem-print-store';

@Component({
  selector: 'app-tem-print-history',
  templateUrl: './tem-print-history.component.html',
  styleUrls: ['./tem-print-history.component.scss']
})
export class TemPrintHistoryComponent implements OnInit {
  records: TemPrintRecord[] = [];

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.records = loadTemPrintHistory();
  }

  openAgain(record: TemPrintRecord): void {
    stageTemRestore(record);
    this.router.navigate(['/tem-thanh-pham']);
  }

  when(at: string): string {
    const d = new Date(at);
    if (isNaN(d.getTime())) return at;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
