import type { AttackResult } from './rules/combat.ts';
import type { ActionKind, PlayerId, Vec2 } from './index.ts';

/**
 * Todo lo que ocurre en la partida se emite como evento. La interfaz se
 * construye a partir de estos eventos, no leyendo el estado a pelo: así se
 * pueden repetir partidas, hacer deshacer y sincronizar por red más adelante.
 */
export type GameEvent =
  | { type: 'TurnoIniciado'; turno: number }
  | { type: 'IniciativaTirada'; tiradas: Record<PlayerId, number>; orden: readonly PlayerId[] }
  | { type: 'UnidadActivada'; unitId: string; jugador: PlayerId }
  | { type: 'AccionUsada'; unitId: string; accion: ActionKind; coste: number }
  | { type: 'UnidadMovida'; unitId: string; desde: Vec2; hasta: Vec2; distancia: number }
  | { type: 'DisparoResuelto'; attackerId: string; targetId: string; arma: string; resultado: AttackResult }
  | { type: 'CargaResuelta'; unitId: string; targetId: string; dado: number; exito: boolean }
  | { type: 'BarridoDeclarado'; unitId: string; objetivos: readonly string[] }
  | { type: 'CaCResuelto'; attackerId: string; targetId: string; arma: string; resultado: AttackResult }
  | { type: 'DestrabeResuelto'; unitId: string; dado: number; exito: boolean }
  | { type: 'UnidadesTrabadas'; a: string; b: string }
  | { type: 'AtaqueGratuitoPendiente'; unitId: string; targetId: string }
  | { type: 'DanioAplicado'; unitId: string; danio: number; vidasRestantes: number }
  | { type: 'UnidadDestruida'; unitId: string }
  | { type: 'UnidadRetirada'; unitId: string }
  | { type: 'UnidadDesplegada'; unitId: string; puestoId: string; posicion: Vec2 }
  | { type: 'PuestoConquistado'; puestoId: string; jugador: PlayerId | null; anterior: PlayerId | null }
  | { type: 'PuntosGanados'; jugador: PlayerId; puntos: number; total: number }
  | { type: 'ActivacionTerminada'; unitId: string }
  | { type: 'TurnoTerminado'; turno: number }
  | { type: 'PartidaTerminada'; ganador: PlayerId | null };

/** Fallo de validación: la acción no se aplica y se explica por qué. */
export interface RuleViolation {
  readonly ok: false;
  readonly reason: string;
}

export type CommandResult =
  | { readonly ok: true; readonly events: readonly GameEvent[] }
  | RuleViolation;
