import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export interface DatosCobertura {
  listaNominalAprobada:      number;
  listaNominalContabilizada: number;
  etiquetaAprobada?:         string;
  etiquetaContabilizada?:    string;
}

@Component({
  selector: 'app-graficas-actas',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './graficas-actas.component.html',
  styleUrl:    './graficas-actas.component.scss'
})
export class GraficasActasComponent {

  @Input() datos: DatosCobertura = {
    listaNominalAprobada:      349_230,
    listaNominalContabilizada: 330_648,
    etiquetaAprobada:          'Lista nominal aprobada',
    etiquetaContabilizada:     'Lista nominal de actas contabilizadas'
  };

  // ── Geometría ─────────────────────────────────────────────────────────
  //  Anillo: r=88, stroke=30  →  borde exterior a r+15=103, interior a r-15=73
  //  Círculo rosa: r=62
  private readonly R       = 82;      // centro del trazo del anillo
  private readonly SW      = 40;      // grosor → borde interior a R-20=62 = R_INNER
  private readonly R_INNER = 62;
  private readonly GAP     = 55;        // grados de apertura

  readonly CX = 170;
  readonly CY = 155;
  readonly rInner = this.R_INNER;

  get pct(): number {
    const { listaNominalAprobada: a, listaNominalContabilizada: c } = this.datos;
    return a > 0 ? (c / a) * 100 : 0;
  }
  get pctStr(): string { return this.pct.toFixed(4) + '%'; }

  /** Parámetros SVG para el donut — rotación en grados pone el gap en la posición indicada */
  ring(gapCenterDeg: number) {
    const circ   = 2 * Math.PI * this.R;
    const arcDeg = 360 - this.GAP;
    const arcLen = circ * arcDeg / 360;
    const fill   = arcLen * this.pct / 100;
    // El stroke empieza a las 3 h (0°). Girar para que el gap quede en gapCenterDeg.
    // gap centro a las 12 h = 270° SVG  →  rot = 270 - gapCenterDeg/2 ... mejor:
    // Con gap centrado en ángulo θ (en CW from 3-o'clock), la primera punta del arco
    // está en θ + gap/2. El stroke empieza en 0°, así que rotamos (θ + gap/2).
    const rot = gapCenterDeg + this.GAP / 2;
    return { r: this.R, sw: this.SW, arcLen, fill, rot, circ,
             bgDash: `${arcLen} ${circ}`, fgDash: `${fill} ${circ}` };
  }

  // Gráfica izquierda: gap centrado a las ~10:30 h → 300° CW from 3 h
  get ringL() { return this.ring(300); }
  // Gráfica derecha: gap centrado a las ~1:30 h  → 240° CW from 3 h
  get ringR() { return this.ring(240); }

  fmt(n: number): string { return n.toLocaleString('es-MX'); }
}
