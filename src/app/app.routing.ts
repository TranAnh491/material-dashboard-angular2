import { NgModule } from '@angular/core';
import { CommonModule, } from '@angular/common';
import { BrowserModule  } from '@angular/platform-browser';
import { Routes, RouterModule } from '@angular/router';

import { AdminLayoutComponent } from './layouts/admin-layout/admin-layout.component';
import { LoginComponent } from './pages/login/login.component';

const routes: Routes =[
  {
    path: 'login',
    component: LoginComponent
  },
  {
    // Link xem layout J Warehouse — công khai, không cần đăng nhập, chỉ xem (không sửa được gì)
    path: 'j-warehouse-view',
    data: { viewOnly: true },
    loadChildren: () => import('./pages/j-warehouse/j-warehouse.module').then(m => m.JWarehouseModule)
  },
  {
    path: '',
    redirectTo: 'menu',
    pathMatch: 'full',
  }, {
    path: '',
    component: AdminLayoutComponent,
    children: [{
      path: '',
      loadChildren: () => import('./layouts/admin-layout/admin-layout.module').then(m => m.AdminLayoutModule)
    }]
  }
];

@NgModule({
  imports: [
    CommonModule,
    BrowserModule,
    RouterModule.forRoot(routes,{
       useHash: true
    })
  ],
  exports: [
  ],
})
export class AppRoutingModule { }
