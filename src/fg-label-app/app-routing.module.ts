import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from '../app/pages/login/login.component';
import { AuthGuard } from '../app/guards/auth.guard';

const routes: Routes = [
  { path: '', redirectTo: 'tem-thanh-pham', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  {
    path: 'tem-thanh-pham',
    loadChildren: () => import('../app/pages/tem-thanh-pham/tem-thanh-pham.module').then(m => m.TemThanhPhamModule),
    canActivate: [AuthGuard]
  },
  // Login điều hướng về /menu sau khi đăng nhập — app này không có Menu nên về thẳng tab Tem.
  { path: 'menu', redirectTo: 'tem-thanh-pham', pathMatch: 'full' },
  { path: '**', redirectTo: 'tem-thanh-pham' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
