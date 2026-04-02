import {
  Component, OnInit, OnDestroy,
  ElementRef, ViewChild, inject,
  signal, computed, ChangeDetectionStrategy
} from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Partido {
  id: string;
  labels: string[];    // badges a mostrar (uno o más para coaliciones)
  colores: string[];   // color por badge
  color: string;       // color primario para el mapa
  pctVotos: number;    // porcentaje de votos nacional
}

export interface Distrito {
  clave: string;
  estado: string;
  estadoAbr: string;
  numeroDistrito: number;
  cabecera: string;
  nombre: string;
  partido: string | null;
  porcentaje: number | null;
  actasComputadas: number;
  actasTotales: number;
  poligonoId: string;
}

export interface PrepData {
  meta: { corte: string; actasComputadasNacional: number; distritosTotales: number; distritosConDatos: number };
  partidos: Partido[];
  distritos: Record<string, Distrito>;
}

interface FilaPartido extends Partido {
  numDistritos: number;
}

@Component({
  selector: 'app-mapa-distritos',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mapa-distritos.component.html',
  styleUrl: './mapa-distritos.component.scss'
})
export class MapaDistritosComponent implements OnInit, OnDestroy {

  private http = inject(HttpClient);

  @ViewChild('mapaObj', { static: true })
  mapaObjRef!: ElementRef<HTMLObjectElement>;

  // ── Estado reactivo ──────────────────────────────────────────────────────
  datos      = signal<PrepData | null>(null);
  filasTabla = computed<FilaPartido[]>(() => this.calcularFilas());
  ganadorId  = computed<string>(() => {
    const rows = this.filasTabla();
    const max  = Math.max(...rows.map(r => r.numDistritos));
    return max > 0 ? (rows.find(r => r.numDistritos === max)?.id ?? '') : '';
  });
  ciDistritos = computed<number>(() => {
    const d = this.datos();
    if (!d) return 0;
    return Object.values(d.distritos).filter(x => x.partido === 'CI').length;
  });

  // Tooltip
  tooltipVisible = signal(true);
  tooltipData    = signal<{
    titulo: string;
    partido: Partido | null;
    isCI: boolean;
    numDistritos: number;
    pct: string;
  } | null>(null);

  // Simulación
  simActiva = signal(false);
  simLabel  = signal('Listo');
  private simTimer?: ReturnType<typeof setInterval>;
  private corte = 0;

  private svgDoc: Document | null = null;
  private poligonoMap: Record<string, Distrito> = {};

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.http.get<PrepData>('assets/datos-mock.json').subscribe(d => {
      this.datos.set(d);
      this.construirPoligonoMap(d);
      this.esperarSvg();
      this.initTooltipGanador(d);
    });
  }

  private initTooltipGanador(d: PrepData): void {
    const filas = d.partidos.map(p => ({
      ...p,
      numDistritos: Object.values(d.distritos).filter(x => x.partido === p.id).length
    }));
    const ganador = filas.reduce((a, b) => b.numDistritos > a.numDistritos ? b : a, filas[0]);
    if (!ganador) return;
    this.tooltipData.set({
      titulo: ganador.labels.join(' + '),
      partido: ganador,
      isCI: false,
      numDistritos: ganador.numDistritos,
      pct: `${ganador.pctVotos.toFixed(4)}%`
    });
  }

  ngOnDestroy(): void {
    this.detenerSim();
  }

  // ── Tabla ────────────────────────────────────────────────────────────────
  private calcularFilas(): FilaPartido[] {
    const d = this.datos();
    if (!d) return [];

    const conteo: Record<string, number> = {};
    for (const dist of Object.values(d.distritos)) {
      if (dist.partido && dist.partido !== 'CI')
        conteo[dist.partido] = (conteo[dist.partido] ?? 0) + 1;
    }

    // Mantener el orden del JSON (no ordenar por distritos)
    return d.partidos.map(p => ({ ...p, numDistritos: conteo[p.id] ?? 0 }));
  }

  // ── SVG ──────────────────────────────────────────────────────────────────
  private construirPoligonoMap(d: PrepData): void {
    this.poligonoMap = {};
    for (const dist of Object.values(d.distritos)) {
      if (dist.poligonoId) this.poligonoMap[dist.poligonoId] = dist;
    }
  }

  private esperarSvg(): void {
    const obj = this.mapaObjRef.nativeElement;
    const tryInit = () => {
      try {
        const doc = obj.contentDocument ?? (obj as any).getSVGDocument?.();
        if (doc?.querySelector('path[id^="p-"]')) {
          this.svgDoc = doc;
          this.colorear();
          this.bindSvgEventos();
        } else {
          setTimeout(tryInit, 80);
        }
      } catch { setTimeout(tryInit, 80); }
    };
    if (obj.contentDocument?.readyState === 'complete') tryInit();
    else obj.addEventListener('load', tryInit);
  }

  // ── Colorear ─────────────────────────────────────────────────────────────
  private colorear(): void {
    if (!this.svgDoc || !this.datos()) return;
    this.svgDoc.querySelectorAll<SVGPathElement>('path[id^="p-"]').forEach(path => {
      const dist = this.poligonoMap[path.id];
      if (!dist?.partido) {
        path.style.fill        = '#dce8f0';
        path.style.stroke      = '#fff';
        path.style.strokeWidth = '0.4';
      } else {
        path.style.fill        = this.pastel(this.colorPartido(dist.partido));
        path.style.stroke      = '#fff';
        path.style.strokeWidth = '0.4';
      }
      (path as any)._clave = dist?.clave ?? '';
    });
  }

  private colorPartido(id: string): string {
    if (id === 'CI') return '#aaaaaa';
    return this.datos()?.partidos.find(p => p.id === id)?.color ?? '#cccccc';
  }

  private pastel(hex: string, factor = 0.45): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const m = (c: number) => Math.round(c + (255 - c) * factor);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }

  // ── Eventos SVG ──────────────────────────────────────────────────────────
  private bindSvgEventos(): void {
    if (!this.svgDoc) return;
    this.svgDoc.querySelectorAll<SVGPathElement>('path[id^="p-"]').forEach(path => {
      path.style.cursor = 'pointer';
      path.addEventListener('mousemove', (e: MouseEvent) => this.onPolyHover(e as MouseEvent, path));
      path.addEventListener('mouseleave', ()              => this.onPolyLeave(path));
    });
  }

  private onPolyHover(_e: MouseEvent, path: SVGPathElement): void {
    const clave = (path as any)._clave as string;
    const d     = this.datos();
    if (!clave || !d) return;
    const dist = d.distritos[clave];
    if (!dist) return;

    path.style.fill = this.colorPartido(dist.partido ?? '');

    const partido  = d.partidos.find(p => p.id === dist.partido) ?? null;
    const isCI     = dist.partido === 'CI';
    const count    = dist.partido
      ? Object.values(d.distritos).filter(x => x.partido === dist.partido).length
      : 0;
    const pct      = partido ? partido.pctVotos.toFixed(4) : ((count / 300) * 100).toFixed(4);

    this.tooltipData.set({
      titulo:      `Distrito ${String(dist.numeroDistrito).padStart(2, '0')}. ${dist.estado}`,
      partido,
      isCI,
      numDistritos: count,
      pct:         `${pct}%`
    });
    this.tooltipVisible.set(true);
  }

  private onPolyLeave(path: SVGPathElement): void {
    const clave = (path as any)._clave as string;
    const dist  = clave ? this.datos()?.distritos[clave] : null;
    path.style.fill = dist?.partido
      ? this.pastel(this.colorPartido(dist.partido))
      : '#dce8f0';
    const d = this.datos();
    if (d) this.initTooltipGanador(d);
  }


  // ── Simulación ────────────────────────────────────────────────────────────
  toggleSim(): void {
    if (this.simActiva()) {
      this.detenerSim();
    } else {
      this.simActiva.set(true);
      this.ejecutarCorte();
      this.simTimer = setInterval(() => this.ejecutarCorte(), 5000);
    }
  }

  private detenerSim(): void {
    if (this.simTimer) clearInterval(this.simTimer);
    this.simActiva.set(false);
    this.simLabel.set('Listo');
  }

  private ejecutarCorte(): void {
    const d = this.datos();
    if (!d) return;
    this.corte++;

    const lista      = Object.values(d.distritos);
    const pendientes = lista.filter(x => x.actasComputadas < 60);
    const opciones   = ['MORENA_PT','MORENA_PT','MORENA_PT','COALICION_VA','COALICION_VA','MC_SOLO','MORENA_SOLO'];

    pendientes.slice(0, Math.max(3, Math.floor(pendientes.length * 0.08))).forEach(x => {
      x.actasComputadas = Math.min(100, x.actasComputadas + Math.floor(Math.random() * 35) + 15);
      if (x.actasComputadas >= 30 && !x.partido) {
        x.partido    = opciones[Math.floor(Math.random() * opciones.length)];
        x.porcentaje = 35 + Math.floor(Math.random() * 25);
      }
    });

    lista.filter(x => x.actasComputadas < 100 && x.partido).forEach(x => {
      x.actasComputadas = Math.min(100, x.actasComputadas + Math.floor(Math.random() * 5));
    });

    const hora = new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    this.simLabel.set(`Corte #${this.corte} — ${hora}`);

    this.datos.set({ ...d });
    this.construirPoligonoMap(d);
    this.colorear();
  }
}
