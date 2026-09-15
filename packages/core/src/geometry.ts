/**
 * Geometría en espacio continuo, con las unidades en pulgadas del reglamento.
 *
 * El reglamento mide "desde el punto más cercano de la peana de la unidad que
 * actúa hasta el punto más cercano del objetivo", así que las peanas se
 * modelan como círculos y todas las distancias son de borde a borde, no de
 * centro a centro. Una distancia de 0 significa contacto de peana.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const sub = (a: Vec2, b: Vec2): Vec2 => vec(a.x - b.x, a.y - b.y);
export const add = (a: Vec2, b: Vec2): Vec2 => vec(a.x + b.x, a.y + b.y);
export const scale = (a: Vec2, k: number): Vec2 => vec(a.x * k, a.y * k);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l === 0 ? vec(0, 0) : vec(a.x / l, a.y / l);
}

/** Distancia entre centros. */
export const centerDistance = (a: Vec2, b: Vec2): number => len(sub(a, b));

/**
 * Distancia de peana a peana: la que usa el reglamento para movimiento,
 * alcance de armas y la regla de 1" respecto a enemigos.
 * Nunca es negativa; 0 es contacto (o solapamiento).
 */
export function baseDistance(
  a: Vec2,
  radiusA: number,
  b: Vec2,
  radiusB: number,
): number {
  return Math.max(0, centerDistance(a, b) - radiusA - radiusB);
}

/** Contacto de peana, con una tolerancia para errores de coma flotante. */
export function inBaseContact(
  a: Vec2,
  radiusA: number,
  b: Vec2,
  radiusB: number,
  epsilon = 1e-6,
): boolean {
  return baseDistance(a, radiusA, b, radiusB) <= epsilon;
}

/** Rectángulo alineado a los ejes, para escenografía. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Punto del rectángulo más cercano a `p`. */
export function closestPointOnRect(p: Vec2, r: Rect): Vec2 {
  return vec(
    Math.min(Math.max(p.x, r.x), r.x + r.width),
    Math.min(Math.max(p.y, r.y), r.y + r.height),
  );
}

/** Distancia del borde de una peana al borde de un rectángulo. */
export function baseToRectDistance(
  center: Vec2,
  radius: number,
  r: Rect,
): number {
  return Math.max(0, centerDistance(center, closestPointOnRect(center, r)) - radius);
}

/** ¿La peana se solapa con el rectángulo? Estar en contacto NO es solaparse. */
export function baseSolapaRect(center: Vec2, radius: number, r: Rect): boolean {
  return centerDistance(center, closestPointOnRect(center, r)) < radius - 1e-9;
}

/**
 * Pega la peana al borde del rectángulo si está a `umbral` o menos: el imán
 * que hace fácil ponerse en cobertura, que exige contacto exacto.
 */
export function imantarARect(
  center: Vec2,
  radius: number,
  r: Rect,
  umbral: number,
): Vec2 | null {
  const cercano = closestPointOnRect(center, r);
  const d = centerDistance(center, cercano);
  const separacion = d - radius;
  if (separacion < 0 || separacion > umbral) return null;
  if (d <= 1e-9) return null; // centro dentro del rectángulo: no hay dirección
  const ux = (center.x - cercano.x) / d;
  const uy = (center.y - cercano.y) / d;
  return vec(cercano.x + ux * radius, cercano.y + uy * radius);
}

/**
 * Empuja la peana fuera del rectángulo por el lado más cercano, dejándola en
 * contacto exacto. Devuelve null si no había solape.
 *
 * Es lo que impide colocar una miniatura encima de la escenografía: en vez de
 * rechazar la posición, se desliza hasta el borde.
 */
export function expulsarDeRect(center: Vec2, radius: number, r: Rect): Vec2 | null {
  if (!baseSolapaRect(center, radius, r)) return null;

  const dentro =
    center.x >= r.x && center.x <= r.x + r.width &&
    center.y >= r.y && center.y <= r.y + r.height;

  if (!dentro) {
    // El centro está fuera: basta alejarlo del punto más cercano del borde.
    const cercano = closestPointOnRect(center, r);
    const d = centerDistance(center, cercano);
    if (d > 1e-9) {
      return vec(
        cercano.x + ((center.x - cercano.x) / d) * radius,
        cercano.y + ((center.y - cercano.y) / d) * radius,
      );
    }
  }

  // El centro está dentro: se sale por el lado que tenga más cerca.
  const salidas = [
    { p: vec(r.x - radius, center.y), d: center.x - r.x },
    { p: vec(r.x + r.width + radius, center.y), d: r.x + r.width - center.x },
    { p: vec(center.x, r.y - radius), d: center.y - r.y },
    { p: vec(center.x, r.y + r.height + radius), d: r.y + r.height - center.y },
  ];
  return salidas.reduce((mejor, s) => (s.d < mejor.d ? s : mejor)).p;
}

/** Distancia mínima del segmento AB al punto P. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lengthSquared = dot(ab, ab);
  if (lengthSquared === 0) return centerDistance(p, a);
  let t = dot(sub(p, a), ab) / lengthSquared;
  t = Math.min(1, Math.max(0, t));
  return centerDistance(p, add(a, scale(ab, t)));
}

/** ¿El segmento AB corta el círculo (centro, radio)? */
export function segmentIntersectsCircle(
  a: Vec2,
  b: Vec2,
  center: Vec2,
  radius: number,
): boolean {
  return pointSegmentDistance(center, a, b) < radius;
}

/** ¿El segmento AB corta el rectángulo? (Slab test / Liang-Barsky.) */
export function segmentIntersectsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // paralelo al borde: solo pasa si está dentro
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };

  return (
    clip(-dx, a.x - r.x) &&
    clip(dx, r.x + r.width - a.x) &&
    clip(-dy, a.y - r.y) &&
    clip(dy, r.y + r.height - a.y)
  );
}

/**
 * Puntos repartidos por el perímetro de una peana, para trazar rayos de
 * línea de visión hacia "cualquier parte" de la miniatura objetivo.
 */
export function perimeterSamples(
  center: Vec2,
  radius: number,
  samples = 12,
): Vec2[] {
  const out: Vec2[] = [center];
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    out.push(vec(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius));
  }
  return out;
}

/**
 * Punto más lejano del segmento `desde → hasta` al que puede llegar una peana
 * de radio `radio` sin meterse dentro de ninguno de los rectángulos. Si el
 * camino está limpio devuelve `hasta` tal cual.
 *
 * Sirve para la escenografía que bloquea el paso: no basta con impedir que el
 * movimiento TERMINE dentro del muro, hay que impedir que lo atraviese. Tocar
 * el borde sí vale — es justo la posición pegada que busca la cobertura.
 */
export function recortarPorObstaculos(
  desde: Vec2,
  hasta: Vec2,
  radio: number,
  rects: readonly Rect[],
): Vec2 {
  if (rects.length === 0) return hasta;

  const en = (t: number): Vec2 => ({
    x: desde.x + (hasta.x - desde.x) * t,
    y: desde.y + (hasta.y - desde.y) * t,
  });
  // Tocar el borde vale: es justo la posición pegada que busca la cobertura.
  const libre = (t: number): boolean => rects.every((r) => !baseSolapaRect(en(t), radio, r));

  /*
    No basta con mirar el destino: el caso que importa es el muro EN MEDIO,
    con las dos puntas despejadas. Se recorre el trayecto a pasos cortos —
    más cortos que el tramo mínimo que una peana pasa solapando cualquier
    obstáculo, que es su propio diámetro — y se afina con búsqueda binaria.
  */
  const largo = centerDistance(desde, hasta);
  if (largo < 1e-9) return hasta;
  const pasos = Math.max(2, Math.ceil(largo / Math.min(0.15, Math.max(radio, 0.1))));

  let ultimoLibre = 0;
  for (let i = 1; i <= pasos; i += 1) {
    const t = i / pasos;
    if (libre(t)) {
      ultimoLibre = t;
      continue;
    }
    // Afinar entre el último libre y este, y parar ahí.
    let ok = ultimoLibre;
    let ko = t;
    for (let j = 0; j < 24; j += 1) {
      const medio = (ok + ko) / 2;
      if (libre(medio)) ok = medio;
      else ko = medio;
    }
    return en(ok);
  }

  return hasta;
}

/**
 * Área de solape entre dos círculos. Hace falta para saber si una miniatura
 * ocupa un puesto de mando: el reglamento pide que la MITAD O MÁS de la peana
 * esté encima, y con dos círculos eso es el área de la lente, no una distancia.
 */
export function areaSolapeCirculos(c1: Vec2, r1: number, c2: Vec2, r2: number): number {
  const d = centerDistance(c1, c2);
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;

  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}
