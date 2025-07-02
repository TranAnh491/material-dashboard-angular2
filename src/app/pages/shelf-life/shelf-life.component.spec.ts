import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ShelfLifeComponent } from './shelf-life.component';

describe('ShelfLifeComponent', () => {
  let component: ShelfLifeComponent;
  let fixture: ComponentFixture<ShelfLifeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ShelfLifeComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ShelfLifeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
