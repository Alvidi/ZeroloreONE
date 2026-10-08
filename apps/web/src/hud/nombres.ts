import { anclaDe, comandanteDe, tropaDe, vidasDe, type GameState, type Unidad } from '@zerolore/core';
import { TIPOS } from '../partida.ts';

/** Cómo se llama una unidad en pantalla, y qué icono la representa. */
export interface Rotulo {
  readonly titulo: string;
  readonly detalle: string;
  /** El icono de la unidad es el de su tropa: una escuadra de Tiradores se ve como Tirador. */
  readonly tipoId: string;
}

export function rotulo(u: Unidad): Rotulo {
  const tropa = tropaDe(u);
  const comandante = comandanteDe(u);
  if (tropa.length > 0 && comandante) {
    const t = TIPOS[tropa[0]!.tipoId]!;
    return { titulo: t.nombre, detalle: `${tropa.length} + ${TIPOS[comandante.tipoId]!.nombre}`, tipoId: t.id };
  }
  const m = anclaDe(u);
  const t = TIPOS[m.tipoId]!;
  return { titulo: t.nombre, detalle: tropa.length > 1 ? `${tropa.length} miniaturas` : '', tipoId: t.id };
}

/** Lo mismo para algo que aún está en Reserva. */
export function rotuloReserva(minis: readonly { tipoId: string; esComandante: boolean }[]): Rotulo {
  const tropa = minis.filter((m) => !m.esComandante);
  const comandante = minis.find((m) => m.esComandante);
  if (tropa.length > 0 && comandante) {
    const t = TIPOS[tropa[0]!.tipoId]!;
    return { titulo: t.nombre, detalle: `${tropa.length} + ${TIPOS[comandante.tipoId]!.nombre}`, tipoId: t.id };
  }
  const t = TIPOS[minis[0]!.tipoId]!;
  return { titulo: t.nombre, detalle: comandante ? 'sin escuadra' : 'suelta', tipoId: t.id };
}

export function vidaDe(estado: GameState, u: Unidad): { actuales: number; maximas: number } {
  return vidasDe(estado, u);
}
