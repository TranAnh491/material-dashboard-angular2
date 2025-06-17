import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class GoogleSheetService {
  private sheetId = '17ZGxD7Ov-u1Yqu76dXtZBCM8F4rKrpYhpcvmSIt0I84'; // Sheet ID bạn đang dùng

  constructor(private http: HttpClient, private auth: AuthService) {}

  getSheet(range: string) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}`;
    const headers = new HttpHeaders({
      Authorization: `Bearer ${this.auth.token}`,
    });

    return this.http.get(url, { headers });
  }

  updateCell(range: string, value: string) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${range}?valueInputOption=RAW`;
    const headers = new HttpHeaders({
      Authorization: `Bearer ${this.auth.token}`,
      'Content-Type': 'application/json',
    });

    const body = {
      range: range,
      values: [[value]],
    };

    return this.http.put(url, body, { headers });
  }
}
