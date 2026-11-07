import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { DanhMucNvlTpComponent } from './danh-muc-nvl-tp.component';
import { LocationRulePanelComponent } from './location-rule-panel.component';

const routes: Routes = [{ path: '', component: DanhMucNvlTpComponent }];

@NgModule({
  declarations: [DanhMucNvlTpComponent, LocationRulePanelComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class DanhMucNvlTpPageModule {}
