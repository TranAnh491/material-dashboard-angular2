import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from '../app/pages/login/login.component';
import { TruckScheduleComponent } from '../app/pages/truck-schedule/truck-schedule.component';
import { AuthGuard } from '../app/guards/auth.guard';

const routes: Routes = [
  { path: '', redirectTo: 'xe-tai', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'xe-tai', component: TruckScheduleComponent, canActivate: [AuthGuard] },
  // "Về Menu" trong TruckScheduleComponent (component dùng chung với app chính) trỏ tới /menu —
  // app này không có Menu nên quay lại chính tab Xe Tải.
  { path: 'menu', redirectTo: 'xe-tai', pathMatch: 'full' },
  { path: '**', redirectTo: 'xe-tai' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
