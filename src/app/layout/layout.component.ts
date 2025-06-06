import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface Material {
  code: string;
  location: string;
}

@Component({
  selector: 'app-layout',
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css']
})
export class LayoutComponent implements OnInit {
  locations: {id: string}[] = [];
  materialData: Material[] = [];
  highlightLocation: string = '';
  searchCode: string = '';
  apiUrl = 'https://script.google.com/macros/s/xxxxxxx/exec'; // <--- ĐỔI LINK API NÀY

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.locations = this.generateLocations();
    this.loadMaterialData();
  }

  generateLocations(): {id: string}[] {
    // Ví dụ: A1 đến F6
    const arr = [];
    const rows = ['A','B','C','D','E','F'];
    for (let r of rows) {
      for (let c = 1; c <= 6; c++) {
        arr.push({ id: r + c });
      }
    }
    return arr;
  }

  loadMaterialData() {
    this.http.get<Material[]>(this.apiUrl)
      .subscribe(data => this.materialData = data);
  }

  search() {
    const found = this.materialData.find(
      m => m.code.trim().toUpperCase() === this.searchCode.trim().toUpperCase()
    );
    this.highlightLocation = found ? found.location : '';
  }
}
