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
  readonly animPct           = signal(0);
  readonly animAprobada      = signal(0);
  readonly animContabilizada = signal(0);
  readonly animPctR          = signal(0); // ring derecho siempre va a 100%

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
    const DURATION = 2000; // ms — más largo para que el count-up sea visible

    setTimeout(() => {
      this._animated.set(true);
      this.countUp(0, this.pct,                             DURATION, v => this.animPct.set(v));
      this.countUp(0, this.datos.listaNominalAprobada,      DURATION, v => this.animAprobada.set(v));
      this.countUp(0, this.datos.listaNominalContabilizada, DURATION, v => this.animContabilizada.set(v));
      this.countUp(0, this.pct,                             DURATION, v => this.animPctR.set(v));
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
  get animPctStr():           string { return this.animPct().toFixed(4) + '%'; }
  get animPctInnerStr():      string { return (this.animPct() / this.pct * 100).toFixed(4) + '%'; }
  get animAprobadaStr():      string { return this.fmt(Math.round(this.animAprobada())); }
  get animContabilizadaStr(): string { return this.fmt(Math.round(this.animContabilizada())); }
  get animPctRStr():          string { return this.animPctR().toFixed(4) + '%'; }

  /** Parámetros SVG para el donut */
  ring(gapCenterDeg: number, pct = this.pct) {
    const circ       = 2 * Math.PI * this.R;
    const pctClamped = Math.min(Math.max(pct, 0), 100);
    const gap        = Math.max(360 * (1 - pctClamped / 100), 4); // hueco = % faltante
    const arcLen     = circ * (360 - gap) / 360;
    const fill       = arcLen;
    const rot        = gapCenterDeg + gap / 2;
    const fgDash = this._animated() ? `${fill} ${circ}` : `0 ${circ}`;

    // Puntos a lo largo del radio del hueco (la línea cruza el gap en diagonal)
    const gapRad = gapCenterDeg * Math.PI / 180;
    const cosG   = Math.cos(gapRad);
    const sinG   = Math.sin(gapRad);
    // Fuera del anillo (punto de entrada al gap, desde el texto)
    const outerX = Math.round(this.CX + (this.R + this.SW / 2 + 8) * cosG);
    const outerY = Math.round(this.CY + (this.R + this.SW / 2 + 8) * sinG);
    // Borde del círculo rosa (punto final dentro del gap)
    const innerX = Math.round(this.CX + this.R_INNER * cosG);
    const innerY = Math.round(this.CY + this.R_INNER * sinG);

    return { r: this.R, sw: this.SW, arcLen, fill, rot, circ, fgDash, outerX, outerY, innerX, innerY };
  }

  // izquierdo: % contabilizadas vs aprobadas (94.67%)
  get ringL() { return this.ring(300); }
  // derecho: la aprobada ES el 100% de referencia → anillo lleno
  get ringR() { return this.ring(240, this.pct); }

  fmt(n: number): string { return n.toLocaleString('es-MX'); }
}
