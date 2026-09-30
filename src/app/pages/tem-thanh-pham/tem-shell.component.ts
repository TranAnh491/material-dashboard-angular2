import { Component } from '@angular/core';
import { TemImportBus, TemPlantSession } from './tem-print-store';

@Component({
  selector: 'app-tem-shell',
  templateUrl: './tem-shell.component.html',
  styleUrls: ['./tem-shell.component.scss'],
  providers: [TemPlantSession, TemImportBus]
})
export class TemShellComponent {
  constructor(public plant: TemPlantSession, private imports: TemImportBus) {}

  get importDays(): number | null {
    return this.imports.daysSinceImport();
  }

  pickCatalog(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (file) this.imports.send(file);
  }
}
