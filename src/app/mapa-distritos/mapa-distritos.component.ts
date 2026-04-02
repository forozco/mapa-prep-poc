import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, inject,
  signal, computed, ChangeDetectionStrategy
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';

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
export class MapaDistritosComponent implements OnInit, AfterViewInit, OnDestroy {

  private http = inject(HttpClient);

  @ViewChild('svgContainer', { static: true })
  svgContainerRef!: ElementRef<HTMLDivElement>;

  @ViewChild('mapaWrapper') mapaWrapperRef!: ElementRef<HTMLDivElement>;

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
  tooltipVisible = signal(false);
  tooltipData    = signal<{
    titulo: string;
    entidad: string;
    partido: Partido | null;
    isCI: boolean;
    numDistritos: number;
    pct: string;
  } | null>(null);

  // Zoom y pan — variables nativas para evitar change detection en cada frame
  isDragging  = signal(false);
  private _trackpadUntil = 0;   // timestamp hasta el que el scroll sin ctrlKey es trackpad pan
  private _zoom = 1;
  private _panX = 0;
  private _panY = 0;
  private readonly ZOOM_MIN = 0.5;
  private readonly ZOOM_MAX = 4;
  private _zoomSig = signal(1);
  canZoomOut = computed(() => this._zoomSig() > 1);
  private _dragStartX    = 0;
  private _dragStartY    = 0;
  private _dragStartPanX = 0;
  private _dragStartPanY = 0;
  private _rafId?: number;

  // Inline SVG element reference
  private svgEl: SVGSVGElement | null = null;

  private poligonoMap: Record<string, Distrito> = {};

  // ── Zoom helpers ─────────────────────────────────────────────────────────
  zoomIn():    void { this._zoomButton(1.2); }
  zoomOut():   void { this._zoomButton(1 / 1.2); }
  zoomReset(): void { this._zoom = 1; this._panX = 0; this._panY = 0; this._zoomSig.set(1); this._commitTransform(); }

  /** Zoom centrado en el centro visual del wrapper, sin depender de svgRect */
  private _zoomButton(factor: number): void {
    const wrap = this.mapaWrapperRef?.nativeElement;
    if (!wrap) return;
    const newZoom = Math.min(Math.max(this._zoom * factor, this.ZOOM_MIN), this.ZOOM_MAX);
    if (newZoom === this._zoom) return;
    const ratio = newZoom / this._zoom;
    const cx = wrap.clientWidth  / 2;
    const cy = wrap.clientHeight / 2;
    this._panX = cx - (cx - this._panX) * ratio;
    this._panY = cy - (cy - this._panY) * ratio;
    this._zoom = newZoom;
    this._zoomSig.set(newZoom);
    this._commitTransform();
  }

  /** Aplica el transform al SVG inline en el próximo animation frame (evita jitter) */
  private _commitTransform(): void {
    if (this._rafId !== undefined) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = undefined;
      if (this.svgEl) {
        this.svgEl.style.transform =
          `translate(${this._panX}px,${this._panY}px) scale(${this._zoom})`;
      }
    });
  }

  private _applyZoom(factor: number, ax: number | null, ay: number | null): void {
    const newZoom = Math.min(Math.max(this._zoom * factor, this.ZOOM_MIN), this.ZOOM_MAX);
    if (newZoom === this._zoom) return;
    if (ax !== null && ay !== null) {
      const ratio = newZoom / this._zoom;
      this._panX = ax - (ax - this._panX) * ratio;
      this._panY = ay - (ay - this._panY) * ratio;
    }
    this._zoom = newZoom;
    this._zoomSig.set(newZoom);
    this._commitTransform();
  }

  onWheelZoom(e: WheelEvent): void {
    e.preventDefault();

    if (e.ctrlKey) {
      // Pinch (Mac trackpad) → zoom suave per-evento, centrado en cursor
      this._applyZoom(Math.pow(0.99, e.deltaY), ...this._cursorAnchor(e));
      return;
    }

    if (Math.abs(e.deltaX) > 0) {
      // Componente horizontal → solo puede ser trackpad → pan y renovar ventana
      this._trackpadUntil = Date.now() + 300;
      this._panX -= e.deltaX;
      this._panY -= e.deltaY;
      this._commitTransform();
      return;
    }

    // deltaX === 0: dentro de ventana trackpad → seguir paneando vertical
    if (Date.now() < this._trackpadUntil) {
      this._panY -= e.deltaY;
      this._commitTransform();
      return;
    }

    // Fuera de ventana → mouse wheel → zoom centrado en cursor
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    if (e.deltaMode === 2) dy *= 400;
    this._applyZoom(Math.pow(0.992, dy), ...this._cursorAnchor(e));
  }

  /**
   * Calcula el anchor del cursor en el espacio del contenedor SVG (sin transform).
   * Usar el div contenedor —no el SVG— porque el SVG ya tiene el transform aplicado.
   */
  private _cursorAnchor(e: MouseEvent): [number, number] {
    const r = this.svgContainerRef.nativeElement.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }


  onDragStart(e: MouseEvent): void {
    if (e.button !== 0) return;
    this._dragStartX    = e.clientX;
    this._dragStartY    = e.clientY;
    this._dragStartPanX = this._panX;
    this._dragStartPanY = this._panY;
    this.isDragging.set(true);

    const onMove = (me: MouseEvent) => {
      this._panX = this._dragStartPanX + me.clientX - this._dragStartX;
      this._panY = this._dragStartPanY + me.clientY - this._dragStartY;
      this._commitTransform();
    };

    const onUp = () => {
      this.isDragging.set(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // Simulación
  simActiva = signal(false);
  simLabel  = signal('Listo');
  private simTimer?: ReturnType<typeof setInterval>;
  private corte = 0;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngAfterViewInit(): void {
    // Register wheel listener with passive:false on the wrapper so we can
    // call preventDefault() and prevent page scroll while over the map.
    this.mapaWrapperRef.nativeElement.addEventListener(
      'wheel',
      (e: WheelEvent) => this.onWheelZoom(e),
      { passive: false }
    );
  }

  ngOnInit(): void {
    forkJoin({
      datos: this.http.get<PrepData>('assets/datos-mock.json'),
      svg:   this.http.get('assets/mapa-mexico.svg', { responseType: 'text' })
    }).subscribe(({ datos, svg }) => {
      this.datos.set(datos);
      this.construirPoligonoMap(datos);
      this.initTooltipGanador(datos);

      const container = this.svgContainerRef.nativeElement;
      container.innerHTML = svg;
      const el = container.querySelector('svg');
      if (!el) return;
      this.svgEl = el as SVGSVGElement;
      this.svgEl.style.width          = '100%';
      this.svgEl.style.display        = 'block';
      this.svgEl.style.transformOrigin = '0 0';

      this.colorear();
      this.bindSvgEventos();
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
      titulo:      'Nacional',
      entidad:     '',
      partido:     ganador,
      isCI:        false,
      numDistritos: ganador.numDistritos,
      pct:         `${ganador.pctVotos.toFixed(4)}%`
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

  // ── Colorear ─────────────────────────────────────────────────────────────
  private colorear(): void {
    if (!this.svgEl || !this.datos()) return;
    this.svgEl.querySelectorAll<SVGPathElement>('path[id^="p-"]').forEach(path => {
      const dist = this.poligonoMap[path.id];
      if (!dist?.partido) {
        path.style.fill        = '#dce8f0';
        path.style.stroke      = '#888';
        path.style.strokeWidth = '1.2';
      } else {
        path.style.fill        = this.pastel(this.colorPartido(dist.partido));
        path.style.stroke      = '#888';
        path.style.strokeWidth = '1.2';
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
    if (!this.svgEl) return;
    let lastHovered: SVGPathElement | null = null;

    this.svgEl.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isDragging()) return;
      const path = (e.target as Element).closest?.('path[id^="p-"]') as SVGPathElement | null;
      if (path === lastHovered) return;
      if (lastHovered) this.onPolyLeave(lastHovered);
      lastHovered = path;
      if (path) this.onPolyHover(e, path);
    });

    this.svgEl.addEventListener('mouseleave', () => {
      if (lastHovered) { this.onPolyLeave(lastHovered); lastHovered = null; }
      this.tooltipVisible.set(false);
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
      titulo:      dist.estado,
      entidad:     `Distrito ${String(dist.numeroDistrito).padStart(2, '0')}. ${dist.cabecera}`,
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
    this.tooltipVisible.set(false);
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
