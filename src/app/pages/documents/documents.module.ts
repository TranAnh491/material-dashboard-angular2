import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminPageCommonModule } from '../../layouts/admin-layout/admin-page-common.module';
import { DocumentsComponent } from './documents.component';

const routes: Routes = [{ path: '', component: DocumentsComponent }];

@NgModule({
  declarations: [DocumentsComponent],
  imports: [AdminPageCommonModule, RouterModule.forChild(routes)]
})
export class DocumentsModule {}
