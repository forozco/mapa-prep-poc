import { Component, Input, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';

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
export class GraficasActasComponent implements OnInit {

  private readonly _animated = signal(false);

  @Input() datos: DatosCobertura = {
    listaNominalAprobada:      349_230,
    listaNominalContabilizada: 330_648,
    etiquetaAprobada:          'Lista nominal aprobada',
    etiquetaContabilizada:     'Lista nominal de actas contabilizadas'
  };

  // ── Geometría ─────────────────────────────────────────────────────────
  private readonly R       = 82;
  private readonly SW      = 40;
  private readonly R_INNER = 62;

  readonly CX = 170;
  readonly CY = 170;
  readonly rInner = this.R_INNER;

  ngOnInit() {
    // Dispara el llenado del ring después del fade-in de la sección (0.6s)
    setTimeout(() => this._animated.set(true), 600);
  }

  get pct(): number {
    const { listaNominalAprobada: a, listaNominalContabilizada: c } = this.datos;
    return a > 0 ? (c / a) * 100 : 0;
  }

  get pctStr():           string { return this.pct.toFixed(4) + '%'; }
  get pctInnerStr():      string { return '100.0000%'; }
  get aprobadaStr():      string { return this.fmt(this.datos.listaNominalAprobada); }
  get contabilizadaStr(): string { return this.fmt(this.datos.listaNominalContabilizada); }

  /** Parámetros SVG para el donut */
  ring(gapCenterDeg: number, pct = this.pct) {
    const circ       = 2 * Math.PI * this.R;
    const pctClamped = Math.min(Math.max(pct, 0), 100);
    const gap        = Math.max(360 * (1 - pctClamped / 100), 4);
    const arcLen     = circ * (360 - gap) / 360;
    const fill       = arcLen;
    const rot        = gapCenterDeg + gap / 2;
    const fgDash     = this._animated() ? `${fill} ${circ}` : `0 ${circ}`;

    const gapRad = gapCenterDeg * Math.PI / 180;
    const cosG   = Math.cos(gapRad);
    const sinG   = Math.sin(gapRad);
    const outerX = Math.round(this.CX + (this.R + this.SW / 2 + 8) * cosG);
    const outerY = Math.round(this.CY + (this.R + this.SW / 2 + 8) * sinG);
    const innerX = Math.round(this.CX + this.R_INNER * cosG);
    const innerY = Math.round(this.CY + this.R_INNER * sinG);

    return { r: this.R, sw: this.SW, arcLen, fill, rot, circ, fgDash, outerX, outerY, innerX, innerY };
  }

  get ringL() { return this.ring(300); }
  get ringR() { return this.ring(240, this.pct); }

  fmt(n: number): string { return n.toLocaleString('es-MX'); }
}
