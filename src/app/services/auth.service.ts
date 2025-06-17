import { Injectable } from '@angular/core';

declare const gapi: any;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private clientId = '286089206981-k5p1g4c91jqdlck27582t57g9mstj58d.apps.googleusercontent.com';
  private scope = 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly';

  public token: string = '';
  public isSignedIn: boolean = false;

  constructor() {
    this.loadGapi();
  }

  private loadGapi() {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => this.initClient();
    document.body.appendChild(script);
  }

  private initClient() {
    gapi.load('client:auth2', () => {
      gapi.client.init({
        clientId: this.clientId,
        scope: this.scope,
        discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4']
      }).then(() => {
        const authInstance = gapi.auth2.getAuthInstance();
        this.isSignedIn = authInstance.isSignedIn.get();

        if (this.isSignedIn) {
          this.token = authInstance.currentUser.get().getAuthResponse().access_token;
        }
      });
    });
  }

  public signIn(): Promise<void> {
    return gapi.auth2.getAuthInstance().signIn().then((user: any) => {
      this.token = user.getAuthResponse().access_token;
      this.isSignedIn = true;
      console.log('✅ Đăng nhập thành công. Token:', this.token);
    }).catch((err: any) => {
      console.error('❌ Đăng nhập thất bại:', err);
    });
  }

  public signOut() {
    gapi.auth2.getAuthInstance().signOut();
    this.token = '';
    this.isSignedIn = false;
  }
}
