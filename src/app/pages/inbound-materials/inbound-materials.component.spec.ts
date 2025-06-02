import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InboundMaterialsComponent } from './inbound-materials.component';

describe('InboundMaterialsComponent', () => {
  let component: InboundMaterialsComponent;
  let fixture: ComponentFixture<InboundMaterialsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ InboundMaterialsComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InboundMaterialsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
