import {
  baseToRectDistance,
  vec,
  type Rect,
  type Vec2,
} from '../geometry.ts';

/**
 * Zona que una unidad ve realmente desde donde está: el círculo de alcance
 * menos las sombras que proyecta lo que bloquea la visión. Es la "linterna"
 * que se pinta en el tablero — sirve para colocarse sabiendo a quién se va a
 * poder disparar desde ahí.
 *
 * Solo la escenografía entra en el cálculo. Las miniaturas también tapan (lo
 * recoge `lineOfSight`), pero se mueven a cada activación y meterlas aquí
 * llenaría el aura de sombras parpadeantes sin ganar precisión: la línea de
 * visión se mide entre perímetros y basta un rayo limpio para ver.
 */

/** Un radio de arco por muestra: suficiente para que el borde se vea redondo. */
const MUESTRAS_ARCO = 96;
/** Los rayos a las esquinas se doblan a cada lado para que la sombra corte limpia. */
const ROCE = 0.0006;

export function poligonoDeVision(
  origen: Vec2,
  radio: number,
  rects: readonly Rect[],
): Vec2[] {
  // Lo que ni siquiera roza el círculo no puede proyectar sombra dentro.
  const cerca = rects.filter((r) => baseToRectDistance(origen, 0, r) < radio);
  const lados = cerca.flatMap(ladosDe);

  const angulos: number[] = [];
  for (let i = 0; i < MUESTRAS_ARCO; i += 1) angulos.push((i * 2 * Math.PI) / MUESTRAS_ARCO);
  for (const r of cerca) {
    for (const esquina of esquinasDe(r)) {
      const a = Math.atan2(esquina.y - origen.y, esquina.x - origen.x);
      angulos.push(normalizar(a - ROCE), normalizar(a), normalizar(a + ROCE));
    }
  }
  angulos.sort((a, b) => a - b);

  return angulos.map((a) => {
    const dir = vec(Math.cos(a), Math.sin(a));
    let t = radio;
    for (const [p, q] of lados) {
      const golpe = rayoContraSegmento(origen, dir, p, q);
      if (golpe !== null && golpe < t) t = golpe;
    }
    return vec(origen.x + dir.x * t, origen.y + dir.y * t);
  });
}

/** ¿Cae el punto dentro del polígono? Regla par-impar. */
export function puntoEnPoligono(p: Vec2, poligono: readonly Vec2[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const a = poligono[i]!;
    const b = poligono[j]!;
    const cruza = a.y > p.y !== b.y > p.y;
    if (!cruza) continue;
    const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (p.x < x) dentro = !dentro;
  }
  return dentro;
}

/** Todos los ángulos al mismo rango [0, 2π): si no, el polígono sale cruzado. */
function normalizar(a: number): number {
  const vuelta = 2 * Math.PI;
  return ((a % vuelta) + vuelta) % vuelta;
}

function esquinasDe(r: Rect): Vec2[] {
  return [
    vec(r.x, r.y),
    vec(r.x + r.width, r.y),
    vec(r.x + r.width, r.y + r.height),
    vec(r.x, r.y + r.height),
  ];
}

function ladosDe(r: Rect): [Vec2, Vec2][] {
  const e = esquinasDe(r);
  return [
    [e[0]!, e[1]!],
    [e[1]!, e[2]!],
    [e[2]!, e[3]!],
    [e[3]!, e[0]!],
  ];
}

/**
 * Distancia desde `origen` hasta donde el rayo de dirección `dir` (unitaria)
 * corta el segmento `a → b`. `null` si no lo corta.
 */
function rayoContraSegmento(origen: Vec2, dir: Vec2, a: Vec2, b: Vec2): number | null {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const den = dir.x * sy - dir.y * sx;
  if (Math.abs(den) < 1e-12) return null; // paralelos
  const wx = a.x - origen.x;
  const wy = a.y - origen.y;
  const t = (wx * sy - wy * sx) / den;
  const u = (wx * dir.y - wy * dir.x) / den;
  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}
