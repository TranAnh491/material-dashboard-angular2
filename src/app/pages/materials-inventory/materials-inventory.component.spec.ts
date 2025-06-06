import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MaterialsInventoryComponent } from './materials-inventory.component';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

describe('MaterialsInventoryComponent', () => {
  let component: MaterialsInventoryComponent;
  let fixture: ComponentFixture<MaterialsInventoryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MaterialsInventoryComponent ],
      imports: [ HttpClientTestingModule ],
      schemas: [ NO_ERRORS_SCHEMA ]
    })
    .compileComponents();
    fixture = TestBed.createComponent(MaterialsInventoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
