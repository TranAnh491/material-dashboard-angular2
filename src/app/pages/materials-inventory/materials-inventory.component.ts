import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface Inventory {
  code: string;
  name: string;
  qty: number;
  location: string;
}

@Component({
  selector: 'app-materials-inventory',
  templateUrl: './materials-inventory.component.html',
  styleUrls: ['./materials-inventory.component.scss']
})
export class MaterialsInventoryComponent implements OnInit {
  inventoryList: Inventory[] = [];
  apiUrl = 'https://script.google.com/macros/s/AKfycbzyU7xVxyjixJfOgPCA1smMtVfcLXyKDLPrNz2T6fiLrreHX8CQsArJgQ6LSR5pTviZGA/exec';
  loading = false;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadInventory();
  }

  loadInventory() {
    this.loading = true;
    this.http.get<Inventory[]>(this.apiUrl).subscribe(data => {
      this.inventoryList = data;
      this.loading = false;
    }, err => {
      this.loading = false;
      alert('Không tải được dữ liệu!');
    });
  }
}
