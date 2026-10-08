import {
  baseDistance,
  baseSolapaRect,
  centerDistance,
  vec,
  type Rect,
  type Vec2,
} from '../geometry.ts';
import { caminoMasCorto } from './camino.ts';
import { COHERENCIA, bloqueaPaso, type GameState, type PlayerId, type Terrain } from '../types.ts';

/**
 * Dónde puede quedar cada miniatura de una unidad.
 *
 * El reglamento mueve las escuadras "desde el Comandante": primero va él y el
 * resto se coloca a su alrededor manteniendo la coherencia. Aquí está esa
 * colocación automática y las comprobaciones que comparten el motor (para
 * validar) y la interfaz (para enseñar en verde o en rojo antes de confirmar).
 */

/** Otra miniatura sobre la mesa, vista como un obstáculo. */
export interface Ocupante {
  readonly centro: Vec2;
  readonly radio: number;
  readonly owner: PlayerId;
  readonly unidadId: string;
}

export interface Restricciones {
  readonly mesa: { readonly ancho: number; readonly alto: number };
  readonly terreno: readonly Terrain[];
  /** Miniaturas de OTRAS unidades. */
  readonly otros: readonly Ocupante[];
  readonly owner: PlayerId;
  /**
   * Separación mínima con los enemigos, peana a peana. `null` permite el
   * contacto: solo se usa al cargar.
   */
  readonly margenEnemigo: number | null;
}

/** Todas las miniaturas vivas menos las de las unidades indicadas. */
export function ocupantesMenos(state: GameState, ...excluir: string[]): Ocupante[] {
  const fuera = new Set(excluir);
  const out: Ocupante[] = [];
  for (const u of Object.values(state.unidades)) {
    if (fuera.has(u.id)) continue;
    for (const m of u.minis) {
      const t = state.tipos[m.tipoId];
      if (t) out.push({ centro: m.posicion, radio: t.radioPeana, owner: u.owner, unidadId: u.id });
    }
  }
  return out;
}

export function restriccionesPara(
  state: GameState,
  owner: PlayerId,
  unidadId: string | null,
  margenEnemigo: number | null,
): Restricciones {
  return {
    mesa: state.mesa,
    terreno: state.terreno,
    otros: unidadId ? ocupantesMenos(state, unidadId) : ocupantesMenos(state),
    owner,
    margenEnemigo,
  };
}

/** Por qué no puede ir una peana a un sitio. `null` si cabe. */
export function motivoSitio(
  p: Vec2,
  r: number,
  R: Restricciones,
  colocados: readonly { readonly centro: Vec2; readonly radio: number }[] = [],
): string | null {
  if (p.x - r < -1e-9 || p.y - r < -1e-9 || p.x + r > R.mesa.ancho + 1e-9 || p.y + r > R.mesa.alto + 1e-9) {
    return 'fuera de la mesa';
  }
  for (const t of R.terreno) {
    if (bloqueaPaso(t) && baseSolapaRect(p, r, t.rect)) return `encima de ${t.id}`;
  }
  for (const c of colocados) {
    if (centerDistance(p, c.centro) < r + c.radio - 1e-6) return 'encima de otra miniatura';
  }
  for (const o of R.otros) {
    if (centerDistance(p, o.centro) < r + o.radio - 1e-6) return 'encima de otra miniatura';
    if (o.owner !== R.owner && R.margenEnemigo !== null) {
      if (baseDistance(p, r, o.centro, o.radio) < R.margenEnemigo - 1e-9) {
        return R.margenEnemigo > 0
          ? `a menos de ${R.margenEnemigo}" de un enemigo`
          : 'en contacto con un enemigo';
      }
    }
  }
  return null;
}

/**
 * ¿La escuadra está en coherencia? Cada miniatura a 1" o menos de otra y todas
 * unidas en una sola cadena, Comandante incluido. Mientras la cadena no se
 * rompa, la forma da igual: línea, cuña o piña.
 */
export function esCoherente(piezas: readonly { readonly centro: Vec2; readonly radio: number }[]): boolean {
  if (piezas.length <= 1) return true;
  const visto = new Array<boolean>(piezas.length).fill(false);
  const cola = [0];
  visto[0] = true;
  while (cola.length > 0) {
    const i = cola.pop()!;
    const a = piezas[i]!;
    for (let j = 0; j < piezas.length; j++) {
      if (visto[j]) continue;
      const b = piezas[j]!;
      if (baseDistance(a.centro, a.radio, b.centro, b.radio) <= COHERENCIA + 1e-9) {
        visto[j] = true;
        cola.push(j);
      }
    }
  }
  return visto.every(Boolean);
}

/** Longitud del camino más corto, sorteando lo que no deja pasar. */
export function recorrido(desde: Vec2, hasta: Vec2, radio: number, terreno: readonly Terrain[]): number | null {
  const rects: Rect[] = terreno.filter(bloqueaPaso).map((t) => t.rect);
  const c = caminoMasCorto(desde, hasta, radio, rects);
  return c ? c.longitud : null;
}

export interface Pieza {
  readonly id: string;
  readonly radio: number;
  /** Dónde está ahora. Para un despliegue, dónde se querría poner. */
  readonly desde: Vec2;
  readonly esAncla: boolean;
}

/** Hueco que se deja entre peanas al formar: se tocan casi, sin solaparse. */
const HUECO = 0.15;

/**
 * Coloca la unidad con el ancla (Comandante o miniatura suelta) en `destino`.
 *
 * Primero intenta mover la escuadra en bloque, como si fuera rígida: cada
 * miniatura conserva su posición respecto al Comandante. Solo las que no caben
 * ahí —un muro, otra unidad, un enemigo— buscan el hueco libre más cercano a
 * su sitio ideal, siempre pegadas a alguna ya colocada para no romper la
 * coherencia.
 *
 * `alcance` limita lo que puede recorrer cada miniatura (su propio movimiento);
 * `null` para el despliegue, que no se mide.
 */
export function formar(
  piezas: readonly Pieza[],
  destino: Vec2,
  R: Restricciones,
  alcance: number | null,
): Record<string, Vec2> | null {
  const ancla = piezas.find((p) => p.esAncla) ?? piezas[0];
  if (!ancla) return {};
  if (motivoSitio(destino, ancla.radio, R) !== null) return null;
  if (alcance !== null) {
    const r = recorrido(ancla.desde, destino, ancla.radio, R.terreno);
    if (r === null || r > alcance + 1e-6) return null;
  }

  const delta = vec(destino.x - ancla.desde.x, destino.y - ancla.desde.y);
  const colocados: { id: string; centro: Vec2; radio: number }[] = [
    { id: ancla.id, centro: destino, radio: ancla.radio },
  ];

  const resto = piezas
    .filter((p) => p !== ancla)
    .map((p) => ({ p, ideal: vec(p.desde.x + delta.x, p.desde.y + delta.y) }))
    .sort((a, b) => centerDistance(a.ideal, destino) - centerDistance(b.ideal, destino));

  for (const { p, ideal } of resto) {
    const candidatos: Vec2[] = [ideal];
    for (const c of colocados) {
      const d = c.radio + p.radio + HUECO;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        candidatos.push(vec(c.centro.x + Math.cos(a) * d, c.centro.y + Math.sin(a) * d));
      }
    }

    let mejor: Vec2 | null = null;
    let mejorNota = Infinity;
    for (const cand of candidatos) {
      const nota = centerDistance(cand, ideal);
      if (nota >= mejorNota) continue;
      if (motivoSitio(cand, p.radio, R, colocados) !== null) continue;
      const pegada = colocados.some(
        (c) => baseDistance(cand, p.radio, c.centro, c.radio) <= COHERENCIA + 1e-9,
      );
      if (!pegada) continue;
      if (alcance !== null) {
        const r = recorrido(p.desde, cand, p.radio, R.terreno);
        if (r === null || r > alcance + 1e-6) continue;
      }
      mejor = cand;
      mejorNota = nota;
    }
    if (!mejor) return null;
    colocados.push({ id: p.id, centro: mejor, radio: p.radio });
  }

  const out: Record<string, Vec2> = {};
  for (const c of colocados) out[c.id] = c.centro;
  return out;
}

/**
 * Formación de salida para un despliegue: una piña compacta alrededor del
 * Comandante, abierta hacia `haciaAtras` para que no tape su línea de fuego.
 * Devuelve desplazamientos respecto al ancla, en el mismo orden que `radios`.
 */
export function piniaAlrededor(radioAncla: number, radios: readonly number[], haciaAtras: Vec2): Vec2[] {
  if (radios.length === 0) return [];
  const r = Math.max(...radios);
  const paso = 2 * r + HUECO;
  const puntos: Vec2[] = [];
  const alcance = Math.ceil(Math.sqrt(radios.length)) + 2;
  for (let fila = -alcance; fila <= alcance; fila++) {
    for (let col = -alcance; col <= alcance; col++) {
      const x = (col + (fila % 2 === 0 ? 0 : 0.5)) * paso;
      const y = fila * paso * Math.sqrt(3) / 2;
      const d = Math.hypot(x, y);
      if (d < radioAncla + r + HUECO - 1e-6) continue;
      puntos.push(vec(x, y));
    }
  }
  const n = Math.hypot(haciaAtras.x, haciaAtras.y) || 1;
  const atras = vec(haciaAtras.x / n, haciaAtras.y / n);
  // Más cerca primero; a igual distancia, mejor detrás que delante.
  puntos.sort((a, b) => {
    const da = Math.hypot(a.x, a.y) - 0.3 * (a.x * atras.x + a.y * atras.y);
    const db = Math.hypot(b.x, b.y) - 0.3 * (b.x * atras.x + b.y * atras.y);
    return da - db;
  });
  return radios.map((_, i) => puntos[i]!);
}
