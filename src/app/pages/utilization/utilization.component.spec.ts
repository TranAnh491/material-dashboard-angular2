import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UtilizationComponent } from './utilization.component';

describe('UtilizationComponent', () => {
  let component: UtilizationComponent;
  let fixture: ComponentFixture<UtilizationComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [UtilizationComponent]
    });
    fixture = TestBed.createComponent(UtilizationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
}); 