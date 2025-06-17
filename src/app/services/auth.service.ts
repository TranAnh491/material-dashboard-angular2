import { Injectable } from '@angular/core';
declare const gapi: any;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private clientId = '286089206981-k5p1g4c91jqdlck27582t57g9mstj58d.apps.googleusercontent.com';
  private scope = 'https://www.googleapis.com/auth/spreadsheets';
  public token: string = '';

  constructor() {
    this.initClient();
  }

  initClient() {
    gapi.load('client:auth2', () => {
      gapi.client.init({
        clientId: this.clientId,
        scope: this.scope
      }).then(() => {
        const authInstance = gapi.auth2.getAuthInstance();
        if (authInstance.isSignedIn.get()) {
          this.token = authInstance.currentUser.get().getAuthResponse().access_token;
        }
      });
    });
  }

  signIn() {
    gapi.auth2.getAuthInstance().signIn().then((user: any) => {
      this.token = user.getAuthResponse().access_token;
      console.log('Google Token:', this.token);
    });
  }

  signOut() {
    gapi.auth2.getAuthInstance().signOut();
    this.token = '';
  }
}
