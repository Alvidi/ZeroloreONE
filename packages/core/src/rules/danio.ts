import { centerDistance, type Vec2 } from '../geometry.ts';
import type { Mini, Unidad } from '../types.ts';

/**
 * Cómo se reparte el daño dentro de una escuadra.
 *
 * El reglamento suma todo el daño de un ataque en un único total y el dueño lo
 * va asignando: elige una miniatura, le aplica daño hasta eliminarla y sigue
 * con la siguiente. El Comandante es siempre el último.
 *
 * Mientras el jugador no elija a mano, se decide así: primero la miniatura más
 * tocada —no tiene sentido dejar heridas a medias por toda la escuadra—, y a
 * igualdad, la más cercana al atacante, que es la primera fila.
 */
export function ordenDeBajas(u: Unidad, desde: Vec2 | null): Mini[] {
  const tropa = u.minis.filter((m) => !m.esComandante);
  tropa.sort((a, b) => {
    if (a.vidas !== b.vidas) return a.vidas - b.vidas;
    if (!desde) return 0;
    return centerDistance(a.posicion, desde) - centerDistance(b.posicion, desde);
  });
  const comandante = u.minis.find((m) => m.esComandante);
  return comandante ? [...tropa, comandante] : tropa;
}

export interface Reparto {
  /** Miniaturas que siguen en pie, con sus vidas actualizadas. */
  readonly vivas: readonly Mini[];
  readonly muertas: readonly Mini[];
}

export function repartirDanio(u: Unidad, total: number, desde: Vec2 | null): Reparto {
  let resto = total;
  const tocadas = new Map<string, number>();
  const muertas: Mini[] = [];
  for (const m of ordenDeBajas(u, desde)) {
    if (resto <= 0) break;
    const quita = Math.min(resto, m.vidas);
    resto -= quita;
    if (quita >= m.vidas) muertas.push(m);
    else tocadas.set(m.id, m.vidas - quita);
  }
  const muertasIds = new Set(muertas.map((m) => m.id));
  const vivas = u.minis
    .filter((m) => !muertasIds.has(m.id))
    .map((m) => (tocadas.has(m.id) ? { ...m, vidas: tocadas.get(m.id)! } : m));
  return { vivas, muertas };
}

/** Cuántas miniaturas caen con este daño, sin tocar la unidad. */
export function bajasCon(u: Unidad, total: number, desde: Vec2 | null): number {
  let resto = total;
  let bajas = 0;
  for (const m of ordenDeBajas(u, desde)) {
    if (resto < m.vidas) break;
    resto -= m.vidas;
    bajas++;
  }
  return bajas;
}
