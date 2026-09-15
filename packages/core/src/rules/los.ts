import {
  perimeterSamples,
  segmentIntersectsCircle,
  segmentIntersectsRect,
  baseToRectDistance,
  type Vec2,
} from '../geometry.ts';
import { bloqueaVision, esCobertura } from '../types.ts';
import type { GameState, Unit, UnitProfile } from '../types.ts';

/**
 * Simplificación consciente: el reglamento mide la línea de visión desde
 * cualquier punto del CUERPO de la miniatura (no de la peana) hacia cualquier
 * parte del objetivo. Aquí se usa el círculo de la peana como aproximación del
 * cuerpo, trazando rayos entre puntos de ambos perímetros. Es determinista y
 * suficiente para el motor; si más adelante se modelan volúmenes reales, solo
 * cambia esta función.
 */
const LOS_SAMPLES = 12;

export interface LosResult {
  readonly visible: boolean;
  /** Ids de escenografía que se interponen en algún rayo. */
  readonly obstruccionesParciales: readonly string[];
  /** True si TODOS los rayos están limpios: sin cobertura por interposición. */
  readonly visionCompletamenteLimpia: boolean;
}

/**
 * ¿El atacante ve al objetivo? Basta con que un solo rayo llegue limpio.
 * Bloquean la visión la escenografía marcada como bloqueante y las peanas de
 * otras miniaturas (aliadas o enemigas) que se interpongan por completo.
 */
export function lineOfSight(
  state: GameState,
  attacker: Unit,
  attackerProfile: UnitProfile,
  target: Unit,
  targetProfile: UnitProfile,
): LosResult {
  const origins = perimeterSamples(attacker.position, attackerProfile.radioPeana, LOS_SAMPLES);
  const destinations = perimeterSamples(target.position, targetProfile.radioPeana, LOS_SAMPLES);

  const blockers = Object.values(state.units).filter(
    (u) => u.id !== attacker.id && u.id !== target.id && u.vidas > 0,
  );

  let anyClear = false;
  let allClear = true;
  const obstrucciones = new Set<string>();

  for (const from of origins) {
    for (const to of destinations) {
      const blocking = rayObstructions(state, from, to, blockers);
      if (blocking.length === 0) {
        anyClear = true;
      } else {
        allClear = false;
        for (const id of blocking) obstrucciones.add(id);
      }
    }
  }

  return {
    visible: anyClear,
    obstruccionesParciales: [...obstrucciones],
    visionCompletamenteLimpia: allClear,
  };
}

/** Ids de lo que corta el rayo `from -> to`. Vacío si el rayo está limpio. */
function rayObstructions(
  state: GameState,
  from: Vec2,
  to: Vec2,
  blockers: readonly Unit[],
): string[] {
  const hits: string[] = [];

  for (const t of state.terrain) {
    if (!bloqueaVision(t)) continue;
    if (segmentIntersectsRect(from, to, t.rect)) hits.push(t.id);
  }

  for (const u of blockers) {
    const profile = state.profiles[u.profileId];
    if (!profile) continue;
    if (segmentIntersectsCircle(from, to, u.position, profile.radioPeana)) hits.push(u.id);
  }

  return hits;
}

/**
 * Elementos de escenografía que dan cobertura al objetivo frente a ESTE
 * atacante. Devuelve los ids para poder pintarlos en pantalla.
 *
 * El reglamento pide tres condiciones a la vez:
 *  1. Contacto de peana con el elemento de escenografía.
 *  2. Que el elemento supere la mitad de la altura de la miniatura.
 *  3. Que el elemento se interponga de verdad en el tiro. La cobertura no es
 *     una propiedad de la posición del defensor sino de la trayectoria: un
 *     murete pegado al defensor pero por el lado contrario al atacante no
 *     tapa nada, y no da cobertura.
 *
 * La trayectoria es el segmento centro→centro, exactamente la misma línea que
 * dibuja la interfaz al apuntar: lo que se ve es lo que se aplica.
 *
 * Vehículos, Monstruos y Artillería nunca se benefician de cobertura.
 */
export function coberturasDeTiro(
  state: GameState,
  attacker: Unit,
  target: Unit,
  targetProfile: UnitProfile,
  alturaMiniatura = 2,
): string[] {
  if (
    targetProfile.clase === 'Vehiculo' ||
    targetProfile.clase === 'Monstruo' ||
    targetProfile.clase === 'Artilleria'
  ) {
    return [];
  }

  const cubren: string[] = [];

  for (const t of state.terrain) {
    // 0. Solo la escenografía de tipo cobertura cubre. Un muro no: por detrás
    //    no hay disparo que recibir y por delante no tapa nada.
    if (!esCobertura(t)) continue;

    // 1. Contacto de peana con el elemento.
    const enContacto =
      baseToRectDistance(target.position, targetProfile.radioPeana, t.rect) <= 1e-6;
    if (!enContacto) continue;

    // 2. Que supere la mitad de la altura de la miniatura.
    if (t.altura * 2 < alturaMiniatura) continue;

    // 3. Que la trayectoria lo cruce.
    if (!segmentIntersectsRect(attacker.position, target.position, t.rect)) continue;

    cubren.push(t.id);
  }

  return cubren;
}

/** ¿La unidad se beneficia de cobertura frente a este atacante? */
export function hasCover(
  state: GameState,
  attacker: Unit,
  _attackerProfile: UnitProfile,
  target: Unit,
  targetProfile: UnitProfile,
  alturaMiniatura = 2,
): boolean {
  return coberturasDeTiro(state, attacker, target, targetProfile, alturaMiniatura).length > 0;
}
