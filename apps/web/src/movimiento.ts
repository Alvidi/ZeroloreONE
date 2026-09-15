import type { Unit, UnitProfile } from '@zerolore/core';

/**
 * Qué puede hacer ahora mismo la unidad activa en cuanto a desplazarse.
 *
 * El tope es lo que limita el arrastre en el tablero: si aún caben 2 acciones
 * se puede Correr (Movimiento + Velocidad); si solo queda 1 —porque ya disparó,
 * por ejemplo— el tope baja al Movimiento. Y si ya usó Mover, no hay arrastre.
 */
export interface OpcionesMovimiento {
  readonly puedeMover: boolean;
  readonly puedeCorrer: boolean;
  /** Distancia máxima a la que se puede soltar el arrastre, en pulgadas. */
  readonly tope: number | null;
}

export function opcionesMovimiento(
  unidad: Unit | undefined,
  perfil: UnitProfile | undefined,
  unidadActiva: string | null,
): OpcionesMovimiento {
  if (!unidad || !perfil || unidadActiva !== unidad.id) {
    return { puedeMover: false, puedeCorrer: false, tope: null };
  }
  // Una unidad trabada no puede moverse: solo Atacar o Destrabarse.
  if (unidad.trabadaCon.length > 0) {
    return { puedeMover: false, puedeCorrer: false, tope: null };
  }

  const puedeMover =
    unidad.accionesRestantes >= 1 && !unidad.accionesUsadas.includes('Mover');
  const puedeCorrer =
    unidad.accionesRestantes >= 2 && !unidad.accionesUsadas.includes('Correr');

  const tope = puedeCorrer
    ? perfil.movimiento + perfil.velocidad
    : puedeMover
      ? perfil.movimiento
      : null;

  return { puedeMover, puedeCorrer, tope };
}
