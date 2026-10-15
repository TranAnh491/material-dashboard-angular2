import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { EquipmentComponent } from './equipment.component';
import { WarehouseManualComponent } from './warehouse-manual.component';
import { WarehouseTrainingQuizComponent } from './warehouse-training-quiz.component';

const routes: Routes = [{ path: '', component: EquipmentComponent }];

@NgModule({
  declarations: [EquipmentComponent, WarehouseManualComponent, WarehouseTrainingQuizComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class EquipmentPageModule {}
