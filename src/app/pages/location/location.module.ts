import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LocationComponent } from './location.component';

@NgModule({
  declarations: [
    LocationComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: LocationComponent }
    ])
  ]
})
export class LocationModule { }
