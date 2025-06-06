import { Component, OnInit, OnDestroy } from '@angular/core';
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
export class MaterialsInventoryComponent implements OnInit, OnDestroy {
  inventoryList: Inventory[] = [];
  filteredList: Inventory[] = [];
  findCode: string = '';
  apiUrl = 'https://script.google.com/macros/s/AKfycbzyU7xVxyjixJfOgPCA1smMtVfcLXyKDLPrNz2T6fiLrreHX8CQsArJgQ6LSR5pTviZGA/exec';
  loading = false;
  interval: any;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadInventory();
    this.interval = setInterval(() => this.loadInventory(), 60 * 1000); // auto refresh mỗi 1 phút
  }

  ngOnDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  loadInventory() {
    this.loading = true;
    this.http.get<Inventory[]>(this.apiUrl).subscribe(data => {
      this.inventoryList = data;
      this.filterData();
      this.loading = false;
    }, err => {
      this.loading = false;
      alert('Không tải được dữ liệu!');
    });
  }

  filterData() {
    const search = this.findCode.trim().toLowerCase();
    if (!search) {
      this.filteredList = this.inventoryList;
    } else {
      this.filteredList = this.inventoryList.filter(x =>
        (x.code || '').toLowerCase().includes(search)
      );
    }
  }
}
