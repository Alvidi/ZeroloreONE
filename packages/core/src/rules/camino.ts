import {
  baseSolapaRect,
  centerDistance,
  recortarPorObstaculos,
  vec,
  type Rect,
  type Vec2,
} from '../geometry.ts';

/**
 * Camino más corto entre dos puntos rodeando lo que bloquea el paso.
 *
 * El movimiento no es un salto en línea recta: con un muro delante puedes ir
 * hasta su esquina y girar, y lo que cuesta es la distancia REAL recorrida. Sin
 * esto, una miniatura pegada a una esquina no podía ir a ningún sitio del otro
 * lado aunque le sobrara movimiento para rodearla.
 *
 * Se resuelve como un grafo diminuto: los extremos más las esquinas de cada
 * obstáculo, separadas lo justo para que quepa la peana. Con tres o cuatro
 * elementos de escenografía son catorce nodos; no hace falta nada más caro.
 */

/** Cuánto se despega el nodo de la esquina, además del radio de la peana. */
const HOLGURA = 0.02;

export interface Camino {
  /** Tramos del recorrido, empezando en el origen y acabando en el destino. */
  readonly puntos: readonly Vec2[];
  /** Distancia total recorrida, en pulgadas. */
  readonly longitud: number;
}

export function caminoMasCorto(
  origen: Vec2,
  destino: Vec2,
  radio: number,
  rects: readonly Rect[],
): Camino | null {
  if (llegaRecto(origen, destino, radio, rects)) {
    return { puntos: [origen, destino], longitud: centerDistance(origen, destino) };
  }
  if (baseSolapaRect2(destino, radio, rects)) return null;

  const nodos = [origen, destino, ...esquinasNavegables(radio, rects)];
  const n = nodos.length;

  // Dijkstra a pelo: con estos tamaños, buscar el mínimo a mano sobra.
  const dist = new Array<number>(n).fill(Infinity);
  const previo = new Array<number>(n).fill(-1);
  const visto = new Array<boolean>(n).fill(false);
  dist[0] = 0;

  for (let paso = 0; paso < n; paso += 1) {
    let actual = -1;
    for (let i = 0; i < n; i += 1) {
      if (!visto[i] && dist[i]! < (actual === -1 ? Infinity : dist[actual]!)) actual = i;
    }
    if (actual === -1 || dist[actual] === Infinity) break;
    if (actual === 1) break; // llegado al destino
    visto[actual] = true;

    for (let i = 0; i < n; i += 1) {
      if (visto[i]) continue;
      if (!llegaRecto(nodos[actual]!, nodos[i]!, radio, rects)) continue;
      const candidato = dist[actual]! + centerDistance(nodos[actual]!, nodos[i]!);
      if (candidato < dist[i]!) {
        dist[i] = candidato;
        previo[i] = actual;
      }
    }
  }

  if (dist[1] === Infinity) return null;

  const puntos: Vec2[] = [];
  for (let i = 1; i !== -1; i = previo[i]!) puntos.unshift(nodos[i]!);
  return { puntos, longitud: dist[1]! };
}

/** Recorta el camino a la distancia dada, devolviendo hasta dónde se llega. */
export function recortarCamino(camino: Camino, tope: number): Camino {
  if (camino.longitud <= tope) return camino;

  const puntos: Vec2[] = [camino.puntos[0]!];
  let recorrido = 0;
  for (let i = 1; i < camino.puntos.length; i += 1) {
    const a = camino.puntos[i - 1]!;
    const b = camino.puntos[i]!;
    const tramo = centerDistance(a, b);
    if (recorrido + tramo <= tope) {
      puntos.push(b);
      recorrido += tramo;
      continue;
    }
    const resto = tope - recorrido;
    const k = tramo > 1e-9 ? resto / tramo : 0;
    puntos.push(vec(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k));
    return { puntos, longitud: tope };
  }
  return { puntos, longitud: recorrido };
}

function llegaRecto(a: Vec2, b: Vec2, radio: number, rects: readonly Rect[]): boolean {
  const hasta = recortarPorObstaculos(a, b, radio, rects);
  return centerDistance(hasta, b) <= 1e-6;
}

function baseSolapaRect2(p: Vec2, radio: number, rects: readonly Rect[]): boolean {
  return rects.some((r) => baseSolapaRect(p, radio, r));
}

/** Las cuatro esquinas de cada obstáculo, apartadas para que quepa la peana. */
function esquinasNavegables(radio: number, rects: readonly Rect[]): Vec2[] {
  const fuera = radio + HOLGURA;
  const nodos: Vec2[] = [];
  for (const r of rects) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const x = sx < 0 ? r.x - fuera : r.x + r.width + fuera;
      const y = sy < 0 ? r.y - fuera : r.y + r.height + fuera;
      const p = vec(x, y);
      if (!baseSolapaRect2(p, radio, rects)) nodos.push(p);
    }
  }
  return nodos;
}
