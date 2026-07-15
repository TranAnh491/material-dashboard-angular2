import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LocationComponent } from './location.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  declarations: [
    LocationComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([
      { path: '', component: LocationComponent }
    ]),
    SharedModule
  ]
})
export class LocationModule { }
