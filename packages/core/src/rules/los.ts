import {
  baseToRectDistance,
  perimeterSamples,
  segmentIntersectsCircle,
  segmentIntersectsRect,
  type Vec2,
} from '../geometry.ts';
import {
  bloqueaVision,
  esCobertura,
  puedeTenerCobertura,
  type GameState,
  type Mini,
  type Unidad,
} from '../types.ts';

/**
 * Línea de visión y cobertura, miniatura a miniatura.
 *
 * Simplificación consciente: el reglamento mide desde cualquier punto del
 * CUERPO; aquí se usa el círculo de la peana como aproximación del cuerpo y se
 * trazan rayos entre puntos de los dos perímetros. Basta con que uno llegue
 * limpio para ver.
 */
const MUESTRAS = 8;

/**
 * ¿`de` ve a `a`? Tapan la escenografía que bloquea la visión y las peanas de
 * las demás miniaturas. Las de la propia unidad atacante y las de la unidad
 * objetivo no cuentan: una escuadra no se tapa a sí misma, y si ves a una
 * miniatura de la escuadra enemiga, la escuadra es visible.
 */
export function veA(state: GameState, de: Mini, a: Mini, ignorar: ReadonlySet<string>): boolean {
  const tDe = state.tipos[de.tipoId];
  const tA = state.tipos[a.tipoId];
  if (!tDe || !tA) return false;

  const muros = state.terreno.filter(bloqueaVision);
  const peanas: { c: Vec2; r: number }[] = [];
  for (const u of Object.values(state.unidades)) {
    if (ignorar.has(u.id)) continue;
    for (const m of u.minis) {
      const t = state.tipos[m.tipoId];
      if (t) peanas.push({ c: m.posicion, r: t.radioPeana });
    }
  }

  const origenes = perimeterSamples(de.posicion, tDe.radioPeana * 0.9, MUESTRAS);
  const destinos = perimeterSamples(a.posicion, tA.radioPeana * 0.9, MUESTRAS);
  origenes.push(de.posicion);
  destinos.push(a.posicion);

  for (const o of origenes) {
    for (const d of destinos) {
      if (muros.some((t) => segmentIntersectsRect(o, d, t.rect))) continue;
      if (peanas.some((p) => segmentIntersectsCircle(o, d, p.c, p.r))) continue;
      return true;
    }
  }
  return false;
}

/**
 * Escenografía que cubre a `objetivo` frente a un tiro que sale de `desde`.
 *
 * El reglamento pide tres cosas a la vez: contacto de peana con el elemento,
 * que el elemento supere media miniatura de alto, y que se interponga de
 * verdad en el tiro. La cobertura es de la trayectoria, no de la posición: un
 * murete pegado al defensor pero por el lado contrario al atacante no tapa
 * nada. Por eso un disparo por la espalda la ignora.
 */
export function coberturasDe(state: GameState, desde: Vec2, objetivo: Mini): string[] {
  const t = state.tipos[objetivo.tipoId];
  if (!t || !puedeTenerCobertura(t)) return [];
  const out: string[] = [];
  for (const e of state.terreno) {
    if (!esCobertura(e)) continue;
    if (baseToRectDistance(objetivo.posicion, t.radioPeana, e.rect) > 1e-6) continue;
    if (e.altura * 2 < t.altura) continue;
    if (!segmentIntersectsRect(desde, objetivo.posicion, e.rect)) continue;
    out.push(e.id);
  }
  return out;
}

/** La miniatura del conjunto más cercana a un punto. */
export function masCercana(minis: readonly Mini[], p: Vec2): Mini | undefined {
  let mejor: Mini | undefined;
  let d = Infinity;
  for (const m of minis) {
    const dm = Math.hypot(m.posicion.x - p.x, m.posicion.y - p.y);
    if (dm < d) {
      d = dm;
      mejor = m;
    }
  }
  return mejor;
}

/**
 * ¿La unidad objetivo está en cobertura frente a estos atacantes?
 *
 * Cada miniatura del objetivo se mira contra el atacante que tenga más cerca.
 * La unidad se cubre si lo está la mitad o más de sus miniaturas: con una
 * escuadra de doce, que dos estén tras un murete no protege a las otras diez.
 */
export function unidadEnCobertura(state: GameState, atacantes: readonly Mini[], objetivo: Unidad): boolean {
  if (atacantes.length === 0 || objetivo.minis.length === 0) return false;
  let cubiertas = 0;
  for (const m of objetivo.minis) {
    const a = masCercana(atacantes, m.posicion);
    if (a && coberturasDe(state, a.posicion, m).length > 0) cubiertas++;
  }
  return cubiertas * 2 >= objetivo.minis.length;
}

/**
 * Atrincherado: ¿el tirador dispara desde detrás de una cobertura? Lo está si
 * toca un elemento de cobertura que su propio tiro atraviesa.
 */
export function disparaDesdeCobertura(state: GameState, tirador: Mini, hacia: Vec2): boolean {
  const t = state.tipos[tirador.tipoId];
  if (!t) return false;
  return state.terreno.some(
    (e) =>
      esCobertura(e) &&
      baseToRectDistance(tirador.posicion, t.radioPeana, e.rect) <= 1e-6 &&
      segmentIntersectsRect(tirador.posicion, hacia, e.rect),
  );
}
