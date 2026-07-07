import { Component, OnInit } from '@angular/core';
import { ClientReloadService } from './services/client-reload.service';


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  updateAvailable = false;

  constructor(private clientReloadService: ClientReloadService) {}

  ngOnInit(): void {
    this.clientReloadService.startListening();
    this.clientReloadService.updateAvailable$.subscribe(available => {
      this.updateAvailable = available;
    });
  }

  reloadNow(): void {
    this.clientReloadService.reloadNow();
  }

}
