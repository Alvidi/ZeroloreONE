import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,

  type FederatedPointerEvent,
  type Texture,
} from 'pixi.js';
import type { GameState, Mini, PlayerId, Vec2 } from '@zerolore/core';
import { COLOR_JUGADOR, TIPOS, iconoDe } from '../partida.ts';

/**
 * El tablero, dibujado con PixiJS. Todo se dibuja en PULGADAS dentro de un
 * contenedor escalado: las reglas y el dibujo hablan la misma unidad, y la
 * cámara (más adelante, para mover y hacer zoom) solo tendrá que tocar ese
 * contenedor.
 *
 * La escena no decide nada de reglas: recibe qué pintar (`DatosEscena`) y
 * avisa de lo que hace el ratón (`EventosEscena`). La partida vive en React.
 */

export interface PiezaFantasma {
  readonly id: string;
  readonly tipoId: string;
  readonly esComandante: boolean;
  readonly posicion: Vec2;
  readonly valida: boolean;
}

export interface DatosEscena {
  readonly estado: GameState;
  readonly humano: PlayerId;
  readonly seleccion: string | null;
  readonly hover: string | null;
  /** Unidades que se pueden elegir como objetivo ahora mismo. */
  readonly objetivos: readonly string[];
  readonly objetivo: string | null;
  /** Puestos por los que se puede desplegar: laten. */
  readonly puestosResaltados: readonly string[];
  /** Miniaturas que aún no están: un movimiento o un despliegue sin confirmar. */
  readonly fantasma: { readonly owner: PlayerId; readonly piezas: readonly PiezaFantasma[] } | null;
  /** Unidad cuyas miniaturas reales se apagan porque el fantasma ocupa su lugar. */
  readonly ocultarUnidad: string | null;
  readonly auraMovimiento: { readonly centro: Vec2; readonly radio: number; readonly radioCorrer: number | null } | null;
  /** Alcance del arma: un círculo por miniatura que dispara; se pinta la unión. */
  readonly auraAlcance: readonly { readonly centro: Vec2; readonly radio: number }[] | null;
  readonly trayectorias: readonly { readonly desde: Vec2; readonly hasta: Vec2 }[];
  /** Escenografía que da cobertura en el tiro marcado: se ilumina. */
  readonly coberturas: readonly string[];
}

export interface EventosEscena {
  alPulsar(p: Vec2, miniId: string | null, unidadId: string | null, boton: number): void;
  alMover(p: Vec2 | null, unidadBajo: string | null): void;
  alSoltar(p: Vec2): void;
}

const FONDO = 0x0b0f14;
const MESA = 0x151b23;
const ORO = 0xf5c451;
const ROJO = 0xef4444;
const VERDE = 0x22c55e;
const NEUTRO = 0x94a3b8;

const MS_DESPLAZAR = 380;
const MS_MORIR = 520;

/** Una miniatura dibujada: base, icono recortado en círculo, vida y marcas. */
interface NodoMini {
  readonly raiz: Container;
  readonly base: Graphics;
  readonly icono: Sprite;
  readonly vida: Graphics;
  readonly marca: Graphics;
  pos: Vec2;
  anim: { desde: Vec2; hasta: Vec2; t0: number } | null;
  muriendo: number | null;
  radio: number;
}

export class Escena {
  private readonly mundo = new Container();
  private readonly suelo = new Graphics();
  private readonly terreno = new Graphics();
  private readonly puestos = new Container();
  private readonly auras = new Container();
  private readonly lineas = new Graphics();
  private readonly marcas = new Graphics();
  private readonly minis = new Container();
  private readonly fantasmas = new Container();
  private readonly nodos = new Map<string, NodoMini>();
  private readonly texturas = new Map<string, Texture>();
  private datos: DatosEscena | null = null;
  private observador: ResizeObserver | null = null;
  private ppi = 20;
  private reloj = 0;
  private arrastrando = false;

  private constructor(
    private readonly app: Application,
    private readonly eventos: EventosEscena,
  ) {}

  static async crear(contenedor: HTMLElement, eventos: EventosEscena): Promise<Escena> {
    const app = new Application();
    await app.init({
      resizeTo: contenedor,
      background: FONDO,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    contenedor.appendChild(app.canvas);
    const escena = new Escena(app, eventos);
    await escena.cargarTexturas();
    escena.montar();
    // PixiJS solo escucha a la ventana: si el hueco cambia por otra razón
    // (el panel de abajo crece), el lienzo se quedaría con el tamaño viejo.
    escena.observador = new ResizeObserver(() => app.resize());
    escena.observador.observe(contenedor);
    return escena;
  }

  private async cargarTexturas(): Promise<void> {
    const rutas = [...new Set(Object.keys(TIPOS).map(iconoDe))];
    await Promise.all(
      rutas.map(async (r) => {
        try {
          this.texturas.set(r, await Assets.load<Texture>(r));
        } catch {
          // Sin icono se pinta la ficha lisa: no es motivo para no arrancar.
        }
      }),
    );
  }

  private montar(): void {
    const { app } = this;
    this.mundo.addChild(this.suelo, this.terreno, this.puestos, this.auras, this.lineas, this.minis, this.marcas, this.fantasmas);
    app.stage.addChild(this.mundo);

    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', (e: FederatedPointerEvent) => this.pulsar(e));
    app.stage.on('pointermove', (e: FederatedPointerEvent) => this.mover(e));
    app.stage.on('pointerup', (e: FederatedPointerEvent) => this.soltar(e));
    app.stage.on('pointerupoutside', (e: FederatedPointerEvent) => this.soltar(e));
    app.stage.on('pointerleave', () => this.eventos.alMover(null, null));
    app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    app.renderer.on('resize', () => this.encuadrar());
    app.ticker.add((t) => this.fotograma(t.deltaMS));
  }

  destruir(): void {
    this.observador?.disconnect();
    this.app.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- Cámara

  /** Ajusta la mesa a la ventana. Más adelante aquí entrarán zoom y desplazamiento. */
  private encuadrar(): void {
    const d = this.datos;
    if (!d) return;
    const { width, height } = this.app.screen;
    const margen = 16;
    this.ppi = Math.max(4, Math.min((width - 2 * margen) / d.estado.mesa.ancho, (height - 2 * margen) / d.estado.mesa.alto));
    this.mundo.scale.set(this.ppi);
    this.mundo.position.set(
      (width - d.estado.mesa.ancho * this.ppi) / 2,
      (height - d.estado.mesa.alto * this.ppi) / 2,
    );
    this.app.stage.hitArea = this.app.screen;
    this.dibujarSuelo();
  }

  /** Un punto de la mesa en píxeles de pantalla, para colocar HTML encima. */
  aPantalla(p: Vec2): { x: number; y: number } {
    return { x: this.mundo.position.x + p.x * this.ppi, y: this.mundo.position.y + p.y * this.ppi };
  }

  get pulgada(): number {
    return this.ppi;
  }

  // -------------------------------------------------------------- Entrada

  private aMesa(e: FederatedPointerEvent): Vec2 {
    const p = this.mundo.toLocal(e.global);
    return { x: p.x, y: p.y };
  }

  /**
   * La miniatura bajo el puntero, si hay alguna. Las fantasma van primero: al
   * ajustar un movimiento se arrastran ellas, no las de verdad que siguen atrás.
   */
  private miniEn(p: Vec2): { id: string; unidadId: string | null } | null {
    const d = this.datos;
    if (!d) return null;
    if (d.fantasma) {
      for (const f of d.fantasma.piezas) {
        const r = TIPOS[f.tipoId]?.radioPeana ?? 0.5;
        if (Math.hypot(f.posicion.x - p.x, f.posicion.y - p.y) <= r + 0.15) {
          return { id: f.id, unidadId: d.ocultarUnidad };
        }
      }
    }
    let mejor: { id: string; unidadId: string } | null = null;
    let dist = Infinity;
    for (const u of Object.values(d.estado.unidades)) {
      if (u.id === d.ocultarUnidad) continue;
      for (const m of u.minis) {
        const r = TIPOS[m.tipoId]?.radioPeana ?? 0.5;
        const pos = this.nodos.get(m.id)?.pos ?? m.posicion;
        const dd = Math.hypot(pos.x - p.x, pos.y - p.y);
        if (dd <= r + 0.15 && dd < dist) {
          dist = dd;
          mejor = { id: m.id, unidadId: u.id };
        }
      }
    }
    return mejor;
  }

  private pulsar(e: FederatedPointerEvent): void {
    const p = this.aMesa(e);
    const bajo = this.miniEn(p);
    this.arrastrando = true;
    this.eventos.alPulsar(p, bajo?.id ?? null, bajo?.unidadId ?? null, e.button);
  }

  private mover(e: FederatedPointerEvent): void {
    const p = this.aMesa(e);
    const d = this.datos;
    const dentro = !!d && p.x >= 0 && p.y >= 0 && p.x <= d.estado.mesa.ancho && p.y <= d.estado.mesa.alto;
    this.eventos.alMover(dentro ? p : null, dentro ? (this.miniEn(p)?.unidadId ?? null) : null);
  }

  /**
   * Soltar se avisa siempre, haya empezado el gesto en la mesa o fuera: una
   * unidad arrastrada desde la Reserva se coge en el panel y se suelta aquí.
   */
  private soltar(e: FederatedPointerEvent): void {
    this.arrastrando = false;
    this.eventos.alSoltar(this.aMesa(e));
  }

  // -------------------------------------------------------------- Dibujo

  actualizar(d: DatosEscena): void {
    const primera = this.datos === null || this.datos.estado.mesa !== d.estado.mesa;
    this.datos = d;
    if (primera) this.encuadrar();
    this.dibujarTerreno();
    this.dibujarPuestos();
    this.dibujarAuras();
    this.sincronizarMinis();
    this.dibujarFantasmas();
    this.dibujarMarcas();
  }

  private dibujarSuelo(): void {
    const d = this.datos!;
    const { ancho, alto } = d.estado.mesa;
    const g = this.suelo.clear();
    g.roundRect(-0.4, -0.4, ancho + 0.8, alto + 0.8, 0.6).fill({ color: 0x1f2937 });
    g.rect(0, 0, ancho, alto).fill({ color: MESA });
    // Rejilla de pulgadas: fina cada 1", algo más marcada cada 6".
    for (let x = 1; x < ancho; x++) {
      g.moveTo(x, 0).lineTo(x, alto).stroke({ width: x % 6 === 0 ? 0.04 : 0.02, color: 0xffffff, alpha: x % 6 === 0 ? 0.07 : 0.025 });
    }
    for (let y = 1; y < alto; y++) {
      g.moveTo(0, y).lineTo(ancho, y).stroke({ width: y % 6 === 0 ? 0.04 : 0.02, color: 0xffffff, alpha: y % 6 === 0 ? 0.07 : 0.025 });
    }
  }

  private dibujarTerreno(): void {
    const d = this.datos!;
    const g = this.terreno.clear();
    for (const t of d.estado.terreno) {
      const { x, y, width, height } = t.rect;
      const encendida = d.coberturas.includes(t.id);
      if (t.tipo === 'bloqueo') {
        g.roundRect(x, y, width, height, 0.15).fill({ color: 0x2b3340 }).stroke({ width: 0.08, color: 0x4b5563 });
        g.roundRect(x + 0.35, y + 0.35, width - 0.7, height - 0.7, 0.1).stroke({ width: 0.04, color: 0x64748b, alpha: 0.5 });
      } else if (t.tipo === 'cobertura') {
        g.roundRect(x, y, width, height, 0.12)
          .fill({ color: encendida ? 0xd4a24c : 0x8a6a2a, alpha: encendida ? 0.85 : 0.6 })
          .stroke({ width: encendida ? 0.12 : 0.06, color: encendida ? 0xfde68a : 0xd4a24c });
      } else {
        g.roundRect(x, y, width, height, 0.8).fill({ color: 0x1e3a5f, alpha: 0.7 }).stroke({ width: 0.06, color: 0x3b82f6, alpha: 0.35 });
      }
    }
  }

  private dibujarPuestos(): void {
    const d = this.datos!;
    this.puestos.removeChildren().forEach((c) => c.destroy());
    for (const p of d.estado.puestos) {
      const color = p.duenio ? (COLOR_JUGADOR[p.duenio] ?? NEUTRO) : NEUTRO;
      const g = new Graphics();
      g.circle(p.centro.x, p.centro.y, p.radio).fill({ color, alpha: p.duenio ? 0.1 : 0.05 });
      g.circle(p.centro.x, p.centro.y, p.radio).stroke({ width: 0.1, color, alpha: 0.85 });
      if (p.esCuartelGeneral) g.circle(p.centro.x, p.centro.y, p.radio + 0.3).stroke({ width: 0.05, color, alpha: 0.5 });
      // Banderín en el centro: el token del puesto.
      g.circle(p.centro.x, p.centro.y, 0.55).fill({ color: 0x0b0f14 }).stroke({ width: 0.08, color });
      g.poly([p.centro.x - 0.12, p.centro.y - 0.3, p.centro.x + 0.3, p.centro.y - 0.15, p.centro.x - 0.12, p.centro.y]).fill({ color });
      g.moveTo(p.centro.x - 0.12, p.centro.y - 0.32).lineTo(p.centro.x - 0.12, p.centro.y + 0.3).stroke({ width: 0.05, color });
      g.label = p.id;
      this.puestos.addChild(g);
    }
  }

  private dibujarAuras(): void {
    const d = this.datos!;
    this.auras.removeChildren().forEach((c) => c.destroy());
    const { ancho, alto } = d.estado.mesa;

    if (d.auraAlcance && d.auraAlcance.length > 0) {
      // La unión de los alcances: un velo rojo recortado por todos los círculos.
      const velo = new Graphics().rect(0, 0, ancho, alto).fill({ color: ROJO, alpha: 0.075 });
      const molde = new Graphics();
      for (const c of d.auraAlcance) molde.circle(c.centro.x, c.centro.y, c.radio).fill({ color: 0xffffff });
      velo.mask = molde;
      this.auras.addChild(molde, velo);
    }

    if (d.auraMovimiento) {
      const { centro, radio, radioCorrer } = d.auraMovimiento;
      const g = new Graphics();
      if (radioCorrer !== null) {
        g.circle(centro.x, centro.y, radioCorrer).fill({ color: 0x60a5fa, alpha: 0.04 });
        this.discontinua(g, centro, radioCorrer, 0x93c5fd, 0.45);
      }
      g.circle(centro.x, centro.y, radio).fill({ color: 0x60a5fa, alpha: 0.07 }).stroke({ width: 0.07, color: 0x93c5fd, alpha: 0.7 });
      this.auras.addChild(g);
    }
  }

  private discontinua(g: Graphics, c: Vec2, r: number, color: number, alpha: number): void {
    const n = Math.max(24, Math.round(r * 5));
    for (let i = 0; i < n; i += 2) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      g.moveTo(c.x + Math.cos(a0) * r, c.y + Math.sin(a0) * r).arc(c.x, c.y, r, a0, a1).stroke({ width: 0.06, color, alpha });
    }
  }

  // ------------------------------------------------------------ Miniaturas

  private nuevoNodo(m: Mini, owner: PlayerId): NodoMini {
    const t = TIPOS[m.tipoId];
    const r = t?.radioPeana ?? 0.5;
    const raiz = new Container();
    const base = new Graphics();
    const textura = this.texturas.get(iconoDe(m.tipoId));
    const icono = textura ? new Sprite(textura) : new Sprite();
    icono.anchor.set(0.5);
    icono.width = icono.height = r * 2.5;
    const molde = new Graphics().circle(0, 0, r * 0.86).fill({ color: 0xffffff });
    icono.mask = molde;
    const vida = new Graphics();
    const marca = new Graphics();
    raiz.addChild(base, molde, icono, vida, marca);
    raiz.position.set(m.posicion.x, m.posicion.y);
    this.minis.addChild(raiz);
    const nodo: NodoMini = { raiz, base, icono, vida, marca, pos: m.posicion, anim: null, muriendo: null, radio: r };
    this.pintarBase(nodo, m, owner);
    return nodo;
  }

  private pintarBase(n: NodoMini, m: Mini, owner: PlayerId): void {
    const color = COLOR_JUGADOR[owner] ?? NEUTRO;
    const r = n.radio;
    n.base.clear();
    n.base.circle(0, 0, r).fill({ color: 0x0b0f14 });
    n.base.circle(0, 0, r).stroke({ width: 0.11, color });
    if (m.esComandante) {
      n.base.circle(0, 0, r + 0.1).stroke({ width: 0.06, color: ORO });
      estrella(n.base, 0, -r - 0.05, 0.22, ORO);
    }
  }

  private pintarVida(n: NodoMini, m: Mini): void {
    const max = TIPOS[m.tipoId]?.vidas ?? 1;
    const f = Math.max(0, Math.min(1, m.vidas / max));
    n.vida.clear();
    if (f >= 1) return;
    const r = n.radio + 0.16;
    const color = f > 0.5 ? VERDE : f > 0.25 ? 0xeab308 : ROJO;
    n.vida.moveTo(0, -r).arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f).stroke({ width: 0.09, color });
  }

  private sincronizarMinis(): void {
    const d = this.datos!;
    const vistas = new Set<string>();
    const ahora = performance.now();

    for (const u of Object.values(d.estado.unidades)) {
      const atenuada = u.activada && d.estado.fase === 'Activaciones';
      const oculta = d.ocultarUnidad === u.id;
      for (const m of u.minis) {
        vistas.add(m.id);
        let n = this.nodos.get(m.id);
        if (!n) {
          n = this.nuevoNodo(m, u.owner);
          // Entra de un salto suave: crece desde la mitad.
          n.raiz.scale.set(0.4);
          n.raiz.alpha = 0;
          this.nodos.set(m.id, n);
        } else if (Math.hypot(n.pos.x - m.posicion.x, n.pos.y - m.posicion.y) > 1e-3 && !n.anim) {
          n.anim = { desde: n.pos, hasta: m.posicion, t0: ahora };
        } else if (n.anim && (n.anim.hasta.x !== m.posicion.x || n.anim.hasta.y !== m.posicion.y)) {
          n.anim = { desde: n.pos, hasta: m.posicion, t0: ahora };
        }
        n.muriendo = null;
        this.pintarVida(n, m);
        n.icono.alpha = atenuada ? 0.35 : 1;
        n.raiz.alpha = oculta ? 0.18 : Math.max(n.raiz.alpha, 0.001);
        n.marca.clear();
        if (d.seleccion === u.id) {
          n.marca.circle(0, 0, n.radio + 0.32).stroke({ width: 0.1, color: 0xffffff, alpha: 0.9 });
        } else if (d.hover === u.id) {
          n.marca.circle(0, 0, n.radio + 0.28).stroke({ width: 0.06, color: 0xffffff, alpha: 0.45 });
        }
        if (u.trabadaCon.length > 0) {
          n.marca.circle(0, 0, n.radio + 0.2).stroke({ width: 0.05, color: ROJO, alpha: 0.8 });
        }
      }
    }

    // Las que ya no están: se desvanecen en vez de desaparecer de golpe.
    for (const [id, n] of this.nodos) {
      if (!vistas.has(id) && n.muriendo === null) n.muriendo = ahora;
    }
  }

  private dibujarFantasmas(): void {
    const d = this.datos!;
    this.fantasmas.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!d.fantasma) return;
    const color = COLOR_JUGADOR[d.fantasma.owner] ?? NEUTRO;
    for (const p of d.fantasma.piezas) {
      const r = TIPOS[p.tipoId]?.radioPeana ?? 0.5;
      const c = new Container();
      const g = new Graphics();
      g.circle(0, 0, r).fill({ color: 0x0b0f14, alpha: 0.75 });
      g.circle(0, 0, r).stroke({ width: 0.12, color: p.valida ? color : ROJO });
      if (!p.valida) {
        g.moveTo(-r * 0.5, -r * 0.5).lineTo(r * 0.5, r * 0.5).stroke({ width: 0.1, color: ROJO });
        g.moveTo(r * 0.5, -r * 0.5).lineTo(-r * 0.5, r * 0.5).stroke({ width: 0.1, color: ROJO });
      }
      if (p.esComandante) g.circle(0, 0, r + 0.1).stroke({ width: 0.05, color: ORO, alpha: 0.8 });
      c.addChild(g);
      const textura = this.texturas.get(iconoDe(p.tipoId));
      if (textura && p.valida) {
        const s = new Sprite(textura);
        s.anchor.set(0.5);
        s.width = s.height = r * 2.5;
        s.alpha = 0.7;
        const molde = new Graphics().circle(0, 0, r * 0.86).fill({ color: 0xffffff });
        s.mask = molde;
        c.addChild(molde, s);
      }
      c.position.set(p.posicion.x, p.posicion.y);
      c.alpha = 0.85;
      this.fantasmas.addChild(c);
    }
  }

  private dibujarMarcas(): void {
    const d = this.datos!;
    const g = this.lineas.clear();
    for (const t of d.trayectorias) flecha(g, t.desde, t.hasta, ROJO);
  }

  /** Marcas que laten: objetivos y puestos de despliegue. Se repintan cada fotograma. */
  private pintarLatidos(): void {
    const d = this.datos;
    const g = this.marcas.clear();
    if (!d) return;
    const pulso = 0.5 + 0.5 * Math.sin(this.reloj / 220);

    for (const id of d.objetivos) {
      const u = d.estado.unidades[id];
      if (!u) continue;
      const elegido = d.objetivo === id;
      for (const m of u.minis) {
        const n = this.nodos.get(m.id);
        const pos = n?.pos ?? m.posicion;
        const r = (TIPOS[m.tipoId]?.radioPeana ?? 0.5) + 0.35 + (elegido ? 0.1 * pulso : 0);
        g.circle(pos.x, pos.y, r).stroke({ width: elegido ? 0.13 : 0.07, color: ROJO, alpha: elegido ? 0.95 : 0.45 + 0.35 * pulso });
        if (elegido) {
          for (let k = 0; k < 4; k++) {
            const a = (k * Math.PI) / 2;
            g.moveTo(pos.x + Math.cos(a) * (r + 0.05), pos.y + Math.sin(a) * (r + 0.05))
              .lineTo(pos.x + Math.cos(a) * (r + 0.4), pos.y + Math.sin(a) * (r + 0.4))
              .stroke({ width: 0.1, color: ROJO });
          }
        }
      }
    }

    for (const id of d.puestosResaltados) {
      const p = d.estado.puestos.find((x) => x.id === id);
      if (!p) continue;
      const color = p.duenio ? (COLOR_JUGADOR[p.duenio] ?? NEUTRO) : NEUTRO;
      g.circle(p.centro.x, p.centro.y, p.radio + 0.15 + 0.25 * pulso).stroke({ width: 0.12, color, alpha: 0.35 + 0.5 * pulso });
    }
  }

  // ------------------------------------------------------------ Animación

  private fotograma(dt: number): void {
    this.reloj += dt;
    const ahora = performance.now();
    for (const [id, n] of this.nodos) {
      if (n.muriendo !== null) {
        const t = Math.min(1, (ahora - n.muriendo) / MS_MORIR);
        n.raiz.alpha = 1 - t;
        n.raiz.scale.set(1 + 0.35 * t);
        n.raiz.rotation = 0.6 * t;
        if (t >= 1) {
          n.raiz.destroy({ children: true });
          this.nodos.delete(id);
        }
        continue;
      }
      if (n.raiz.scale.x < 1) n.raiz.scale.set(Math.min(1, n.raiz.scale.x + dt / 250));
      const oculta = this.datos?.ocultarUnidad && this.esDe(id, this.datos.ocultarUnidad);
      if (!oculta && n.raiz.alpha < 1) n.raiz.alpha = Math.min(1, n.raiz.alpha + dt / 250);
      if (n.anim) {
        const t = Math.min(1, (ahora - n.anim.t0) / MS_DESPLAZAR);
        const e = 1 - (1 - t) ** 3;
        n.pos = {
          x: n.anim.desde.x + (n.anim.hasta.x - n.anim.desde.x) * e,
          y: n.anim.desde.y + (n.anim.hasta.y - n.anim.desde.y) * e,
        };
        if (t >= 1) n.anim = null;
      }
      n.raiz.position.set(n.pos.x, n.pos.y);
    }
    this.pintarLatidos();
  }

  private esDe(miniId: string, unidadId: string): boolean {
    return miniId.startsWith(`${unidadId}.`);
  }

  /** ¿Queda alguna miniatura moviéndose o muriendo? */
  get animando(): boolean {
    for (const n of this.nodos.values()) if (n.anim || n.muriendo !== null) return true;
    return false;
  }
}

function estrella(g: Graphics, cx: number, cy: number, r: number, color: number): void {
  const puntos: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    puntos.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.poly(puntos).fill({ color }).stroke({ width: 0.03, color: 0x0b0f14 });
}

function flecha(g: Graphics, a: Vec2, b: Vec2, color: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 0.1) return;
  const ux = dx / l;
  const uy = dy / l;
  const fin = { x: b.x - ux * 0.35, y: b.y - uy * 0.35 };
  g.moveTo(a.x, a.y).lineTo(fin.x, fin.y).stroke({ width: 0.09, color, alpha: 0.85 });
  g.poly([
    b.x, b.y,
    fin.x - uy * 0.28, fin.y + ux * 0.28,
    fin.x + uy * 0.28, fin.y - ux * 0.28,
  ]).fill({ color, alpha: 0.95 });
}
