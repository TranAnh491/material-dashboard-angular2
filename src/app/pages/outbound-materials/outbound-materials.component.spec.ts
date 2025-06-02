import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OutboundMaterialsComponent } from './outbound-materials.component';

describe('OutboundMaterialsComponent', () => {
  let component: OutboundMaterialsComponent;
  let fixture: ComponentFixture<OutboundMaterialsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ OutboundMaterialsComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OutboundMaterialsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
