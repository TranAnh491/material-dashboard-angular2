import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkOrderStatusComponent } from './work-order-status.component';

describe('WorkOrderStatusComponent', () => {
  let component: WorkOrderStatusComponent;
  let fixture: ComponentFixture<WorkOrderStatusComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ WorkOrderStatusComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WorkOrderStatusComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
