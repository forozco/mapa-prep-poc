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
  private _trackpadUntil = 0;
  private _zoom = 1;
  private _panX = 0;
  private _panY = 0;
  private readonly ZOOM_MIN = 0.5;
  private readonly ZOOM_MAX = 40;
  private _zoomSig = signal(1);
  canZoomOut = computed(() => this._zoomSig() > 1);
  canZoomIn  = computed(() => this._zoomSig() < this.ZOOM_MAX);
  private _dragStartX    = 0;
  private _dragStartY    = 0;
  private _dragStartPanX = 0;
  private _dragStartPanY = 0;
  private _rafId?: number;

  // Inercia de arrastre
  private _velX         = 0;
  private _velY         = 0;
  private _prevDragX    = 0;
  private _prevDragY    = 0;
  private _prevDragT    = 0;
  private _momentumRaf?: number;

  // Inline SVG element reference
  private svgEl: SVGSVGElement | null = null;

  private poligonoMap: Record<string, Distrito> = {};

  // ── Zoom helpers ─────────────────────────────────────────────────────────
  zoomIn():    void { this._zoomButton(1.2); }
  zoomOut():   void { this._zoomButton(1 / 1.2); }
  zoomReset(): void {
    this._cancelMomentum();
    this._zoom = 1; this._panX = 0; this._panY = 0; this._zoomSig.set(1);
    this._updateStrokeWidth();
    this._setTransition('250ms');
    this._commitTransform();
  }

  /** Zoom centrado en el centro visual del wrapper */
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
    this._updateStrokeWidth();
    this._setTransition('200ms');
    this._commitTransform();
  }

  /** Activa/desactiva la transición CSS del SVG */
  private _setTransition(duration: string): void {
    if (this.svgEl)
      this.svgEl.style.transition = duration === 'none' ? 'none'
        : `transform ${duration} cubic-bezier(0.25,0.46,0.45,0.94)`;
  }

  /** Aplica el transform en el próximo animation frame */
  private _commitTransform(): void {
    if (this._rafId !== undefined) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = undefined;
      if (this.svgEl)
        this.svgEl.style.transform =
          `translate(${this._panX}px,${this._panY}px) scale(${this._zoom})`;
    });
  }

  private _applyZoom(factor: number, ax: number, ay: number): void {
    const newZoom = Math.min(Math.max(this._zoom * factor, this.ZOOM_MIN), this.ZOOM_MAX);
    if (newZoom === this._zoom) return;
    const ratio = newZoom / this._zoom;
    this._panX = ax - (ax - this._panX) * ratio;
    this._panY = ay - (ay - this._panY) * ratio;
    this._zoom = newZoom;
    this._zoomSig.set(newZoom);
    this._updateStrokeWidth();
    this._clampPan();
    this._commitTransform();
  }

  onWheelZoom(e: WheelEvent): void {
    e.preventDefault();
    this._cancelMomentum();

    if (e.ctrlKey) {
      // Pinch → respuesta inmediata, sin transición
      this._setTransition('none');
      this._applyZoom(Math.pow(0.99, e.deltaY), ...this._cursorAnchor(e));
      return;
    }

    if (Math.abs(e.deltaX) > 0) {
      // Trackpad horizontal → pan directo
      this._trackpadUntil = Date.now() + 300;
      this._setTransition('none');
      this._panX -= e.deltaX;
      this._panY -= e.deltaY;
      this._commitTransform();
      return;
    }

    if (Date.now() < this._trackpadUntil) {
      // Continuación de gesto trackpad → pan vertical directo
      this._panY -= e.deltaY;
      this._commitTransform();
      return;
    }

    // Mouse wheel → zoom suave con transición
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    if (e.deltaMode === 2) dy *= 400;
    this._setTransition('120ms');
    this._applyZoom(Math.pow(0.992, dy), ...this._cursorAnchor(e));
  }

  /** Anchor del cursor en el espacio del contenedor (el div no se transforma) */
  private _cursorAnchor(e: MouseEvent): [number, number] {
    const r = this.svgContainerRef.nativeElement.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  onDragStart(e: MouseEvent): void {
    if (e.button !== 0) return;
    this._cancelMomentum();
    this._setTransition('none');

    this._dragStartX    = e.clientX;
    this._dragStartY    = e.clientY;
    this._dragStartPanX = this._panX;
    this._dragStartPanY = this._panY;
    this._velX = 0; this._velY = 0;
    this._prevDragX = e.clientX;
    this._prevDragY = e.clientY;
    this._prevDragT = performance.now();
    this.isDragging.set(true);

    const onMove = (me: MouseEvent) => {
      const now = performance.now();
      const dt  = now - this._prevDragT;
      if (dt > 0 && dt < 80) {
        const alpha = 0.5;   // suavizado exponencial de velocidad
        this._velX = alpha * (me.clientX - this._prevDragX) / dt * 16 + (1 - alpha) * this._velX;
        this._velY = alpha * (me.clientY - this._prevDragY) / dt * 16 + (1 - alpha) * this._velY;
      }
      this._prevDragX = me.clientX;
      this._prevDragY = me.clientY;
      this._prevDragT = now;

      this._panX = this._dragStartPanX + me.clientX - this._dragStartX;
      this._panY = this._dragStartPanY + me.clientY - this._dragStartY;
      this._clampPan();
      this._commitTransform();
    };

    const onUp = () => {
      this.isDragging.set(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      this._applyMomentum();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Inercia de arrastre ───────────────────────────────────────────────────
  private _cancelMomentum(): void {
    if (this._momentumRaf !== undefined) {
      cancelAnimationFrame(this._momentumRaf);
      this._momentumRaf = undefined;
    }
  }

  private _applyMomentum(): void {
    this._cancelMomentum();
    const speed = Math.hypot(this._velX, this._velY);
    if (speed < 0.5) return;   // demasiado lento, ignorar

    const decay   = 0.91;
    const minSpd  = 0.12;

    const tick = () => {
      this._velX *= decay;
      this._velY *= decay;
      if (Math.hypot(this._velX, this._velY) < minSpd) {
        this._momentumRaf = undefined;
        this._setTransition('120ms');   // restaurar transición para zoom posterior
        return;
      }
      this._panX += this._velX;
      this._panY += this._velY;
      this._clampPan();
      // Escribir directo — ya estamos dentro de rAF
      if (this.svgEl)
        this.svgEl.style.transform =
          `translate(${this._panX}px,${this._panY}px) scale(${this._zoom})`;
      this._momentumRaf = requestAnimationFrame(tick);
    };
    this._momentumRaf = requestAnimationFrame(tick);
  }

  // Simulación
  simActiva = signal(false);
  simLabel  = signal('Listo');
  private simTimer?: ReturnType<typeof setInterval>;
  private corte = 0;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngAfterViewInit(): void {
    const wrapper = this.mapaWrapperRef.nativeElement;

    wrapper.addEventListener('wheel', (e: WheelEvent) => this.onWheelZoom(e), { passive: false });

    // ── Touch: pan con un dedo, pinch zoom con dos ────────────────────────
    let lastDist = 0, lastMidX = 0, lastMidY = 0;
    let t0PanX = 0, t0PanY = 0, t0X = 0, t0Y = 0;

    wrapper.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      this._cancelMomentum();
      this._setTransition('none');
      if (e.touches.length === 1) {
        t0X = e.touches[0].clientX;  t0Y = e.touches[0].clientY;
        t0PanX = this._panX;          t0PanY = this._panY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        lastDist = Math.hypot(dx, dy);
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        t0PanX = this._panX;  t0PanY = this._panY;
      }
    }, { passive: false });

    wrapper.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        this._panX = t0PanX + e.touches[0].clientX - t0X;
        this._panY = t0PanY + e.touches[0].clientY - t0Y;
        this._clampPan();
        this._commitTransform();
      } else if (e.touches.length === 2) {
        const dx   = e.touches[1].clientX - e.touches[0].clientX;
        const dy   = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx, dy);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (lastDist > 0) {
          const r = this.svgContainerRef.nativeElement.getBoundingClientRect();
          this._applyZoom(dist / lastDist, midX - r.left, midY - r.top);
        }
        this._panX += midX - lastMidX;
        this._panY += midY - lastMidY;
        this._clampPan();
        this._commitTransform();
        lastDist = dist;  lastMidX = midX;  lastMidY = midY;
      }
    }, { passive: false });

    wrapper.addEventListener('touchend', () => { lastDist = 0; }, { passive: true });
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
      this.svgEl.style.width           = '100%';
      this.svgEl.style.display         = 'block';
      this.svgEl.style.transformOrigin  = '0 0';
      this.svgEl.style.shapeRendering  = 'geometricPrecision';

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
    this._cancelMomentum();
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

    // Inyectar/actualizar la regla CSS para stroke-width adaptativo al zoom
    this._updateStrokeWidth();

    this.svgEl.querySelectorAll<SVGPathElement>('path[id^="p-"]').forEach(path => {
      const dist = this.poligonoMap[path.id];
      path.style.fill       = dist?.partido ? this.pastel(this.colorPartido(dist.partido)) : '#dce8f0';
      path.style.stroke     = '#777';
      path.style.transition = 'fill 0.15s ease';
      path.style.cursor     = 'pointer';
      (path as any)._clave  = dist?.clave ?? '';
    });
  }

  /** Mantiene strokes en píxeles de pantalla fijos independientemente del zoom.
   *  Al hacer zoom, los bordes de entidad cambian de color para distinguirse de los distritos. */
  private _updateStrokeWidth(): void {
    if (!this.svgEl) return;
    const swDist   = Math.max(0.1,  0.6 / this._zoom).toFixed(4);
    const swEntity = Math.max(0.15, 1.2 / this._zoom).toFixed(4);
    // En cuanto se hace cualquier zoom los bordes de entidad se vuelven azul oscuro
    const entityColor = this._zoom > 1 ? '#1e3a5f' : '#888';
    let styleEl = this.svgEl.querySelector<Element>('#dyn-sw');
    if (!styleEl) {
      styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleEl.id = 'dyn-sw';
      this.svgEl.prepend(styleEl);
    }
    const isZoomingOut = this._zoom <= 1;
    const duration     = isZoomingOut ? '1.4s' : '0.5s';
    const delay        = isZoomingOut ? '0.1s' : '0s';
    styleEl.textContent =
      `path[id^="p-"] { stroke-width: ${swDist}; }` +
      `path[id^="e-"] { stroke-width: ${swEntity}; stroke: ${entityColor}; ` +
      `transition: stroke ${duration} cubic-bezier(0.4,0,0.2,1) ${delay}, ` +
      `stroke-width ${duration} cubic-bezier(0.4,0,0.2,1) ${delay}; }`;
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

    // Doble click → zoom x2 centrado en el cursor
    this.svgEl.addEventListener('dblclick', (e: MouseEvent) => {
      e.preventDefault();
      this._cancelMomentum();
      this._setTransition('300ms');
      this._applyZoom(2, ...this._cursorAnchor(e));
    });
  }

  // ── Pan clamping ─────────────────────────────────────────────────────────
  private _clampPan(): void {
    const wrap = this.mapaWrapperRef?.nativeElement;
    const cont = this.svgContainerRef?.nativeElement;
    if (!wrap || !cont) return;
    const W  = wrap.clientWidth;
    const H  = wrap.clientHeight;
    const sW = cont.clientWidth  * this._zoom;
    const sH = cont.clientHeight * this._zoom;
    const m  = 80; // mínimo de píxeles visibles
    this._panX = Math.min(W - m, Math.max(m - sW, this._panX));
    this._panY = Math.min(H - m, Math.max(m - sH, this._panY));
  }

  private onPolyHover(_e: MouseEvent, path: SVGPathElement): void {
    const clave = (path as any)._clave as string;
    const d     = this.datos();
    if (!clave || !d) return;
    const dist = d.distritos[clave];
    if (!dist) return;

    // Traer al frente para que sus bordes no queden tapados por distritos vecinos
    path.parentNode?.appendChild(path);
    path.style.fill   = this.colorPartido(dist.partido ?? '');
    path.style.filter = 'drop-shadow(0 0 4px rgba(0,0,0,0.55))';

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
    path.style.fill   = dist?.partido ? this.pastel(this.colorPartido(dist.partido)) : '#dce8f0';
    path.style.filter = '';
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
