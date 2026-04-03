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

  // Señales para los valores animados (count-up)
  readonly animPct          = signal(0);
  readonly animAprobada     = signal(0);
  readonly animContabilizada = signal(0);

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
  private readonly GAP     = 55;

  readonly CX = 170;
  readonly CY = 155;
  readonly rInner = this.R_INNER;

  ngOnInit() {
    const DURATION = 2000; // ms — más largo para que el count-up sea visible

    setTimeout(() => {
      this._animated.set(true);
      this.countUp(0, this.pct,                          DURATION, v => this.animPct.set(v));
      this.countUp(0, this.datos.listaNominalAprobada,   DURATION, v => this.animAprobada.set(v));
      this.countUp(0, this.datos.listaNominalContabilizada, DURATION, v => this.animContabilizada.set(v));
    }, 50);
  }

  /** Anima un valor numérico de `from` a `to` en `duration` ms con ease-out cúbico */
  private countUp(from: number, to: number, duration: number, cb: (v: number) => void) {
    const start = performance.now();
    const step  = (now: number) => {
      const p    = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);          // ease-out cubic
      cb(from + (to - from) * ease);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  get pct(): number {
    const { listaNominalAprobada: a, listaNominalContabilizada: c } = this.datos;
    return a > 0 ? (c / a) * 100 : 0;
  }

  // Formatos para la plantilla usando los valores animados
  get animPctStr():            string { return this.animPct().toFixed(4) + '%'; }
  get animPctInnerStr():       string { return (this.animPct() / this.pct * 100).toFixed(4) + '%'; }
  get animAprobadaStr():       string { return this.fmt(Math.round(this.animAprobada())); }
  get animContabilizadaStr():  string { return this.fmt(Math.round(this.animContabilizada())); }

  /** Parámetros SVG para el donut */
  ring(gapCenterDeg: number) {
    const circ   = 2 * Math.PI * this.R;
    const arcDeg = 360 - this.GAP;
    const arcLen = circ * arcDeg / 360;
    const fill   = arcLen * this.pct / 100;
    const rot    = gapCenterDeg + this.GAP / 2;
    const fgDash = this._animated() ? `${fill} ${circ}` : `0 ${circ}`;
    return { r: this.R, sw: this.SW, arcLen, fill, rot, circ,
             bgDash: `${arcLen} ${circ}`, fgDash };
  }

  get ringL() { return this.ring(300); }
  get ringR() { return this.ring(240); }

  fmt(n: number): string { return n.toLocaleString('es-MX'); }
}
