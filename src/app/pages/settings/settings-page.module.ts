import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { SettingsComponent } from './settings.component';

const routes: Routes = [{ path: '', component: SettingsComponent }];

@NgModule({
  declarations: [SettingsComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class SettingsPageModule {}
