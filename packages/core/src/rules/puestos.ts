import { areaSolapeCirculos, centerDistance, type Vec2 } from '../geometry.ts';
import {
  aportaValorEnPuestos,
  type GameState,
  type Mini,
  type PlayerId,
  type Puesto,
} from '../types.ts';

/**
 * Puestos de mando: quién los ocupa, quién los controla y desde dónde se
 * despliega. En escuadras, cada miniatura se comprueba por separado.
 */

/** ¿La miniatura está dentro? El reglamento pide media peana o más encima. */
export function miniOcupa(state: GameState, puesto: Puesto, m: Mini): boolean {
  const t = state.tipos[m.tipoId];
  if (!t || m.vidas <= 0) return false;
  const peana = Math.PI * t.radioPeana ** 2;
  return areaSolapeCirculos(m.posicion, t.radioPeana, puesto.centro, puesto.radio) >= peana / 2 - 1e-9;
}

/**
 * Valor que un jugador tiene en el puesto. No suman los tipos que ocupan sin
 * conquistar (Vehículos, Monstruos, Artillería, Titanes) ni las unidades
 * trabadas en cuerpo a cuerpo, que cuentan como si no estuvieran.
 */
export function valorEnPuesto(state: GameState, puesto: Puesto, owner: PlayerId): number {
  let total = 0;
  for (const u of Object.values(state.unidades)) {
    if (u.owner !== owner || u.trabadaCon.length > 0) continue;
    for (const m of u.minis) {
      const t = state.tipos[m.tipoId];
      if (!t || !aportaValorEnPuestos(t)) continue;
      if (miniOcupa(state, puesto, m)) total += t.valor;
    }
  }
  return total;
}

/** ¿Hay alguna miniatura de ese jugador en el puesto? */
export function hayMinisDe(state: GameState, puesto: Puesto, owner: PlayerId): boolean {
  return Object.values(state.unidades).some(
    (u) => u.owner === owner && u.minis.some((m) => miniOcupa(state, puesto, m)),
  );
}

/**
 * Quién controla el puesto al final del turno: quien más Valor sume en él. Si
 * empatan, o no suma nadie, sigue como estaba.
 */
export function controlTrasTurno(state: GameState, puesto: Puesto): PlayerId | null {
  let mejor: PlayerId | null = null;
  let mejorValor = 0;
  let empate = false;
  for (const j of state.jugadores) {
    const v = valorEnPuesto(state, puesto, j);
    if (v > mejorValor) {
      mejor = j;
      mejorValor = v;
      empate = false;
    } else if (v === mejorValor && v > 0) {
      empate = true;
    }
  }
  if (mejor === null || empate) return puesto.duenio;
  return mejor;
}

/** ¿Puede este jugador desplegar por este puesto ahora mismo? */
export function puedeDesplegarEn(state: GameState, puesto: Puesto, owner: PlayerId): boolean {
  if (puesto.duenio !== owner) return false;
  if (state.puestosUsados.includes(puesto.id)) return false;
  // Ocupado por el enemigo: aunque sea tuyo, por ahí no entra nadie.
  return !state.jugadores.some((j) => j !== owner && hayMinisDe(state, puesto, j));
}

/**
 * ¿El ancla de un despliegue cae bien? "En contacto con él o dentro de su
 * área": basta con que la peana toque el círculo del puesto.
 */
export function tocaPuesto(puesto: Puesto, p: Vec2, radio: number): boolean {
  return centerDistance(p, puesto.centro) <= puesto.radio + radio + 1e-9;
}
