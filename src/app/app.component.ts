import { Component } from '@angular/core';
import { MapaDistritosComponent } from './mapa-distritos/mapa-distritos.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MapaDistritosComponent],
  template: `<app-mapa-distritos />`,
  styles: []
})
export class AppComponent {}
