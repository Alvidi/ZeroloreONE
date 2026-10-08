import type { Vec2 } from './geometry.ts';
import type { TiradaAtaque } from './rules/combat.ts';
import type { ActionKind, PlayerId } from './types.ts';

/**
 * Lo que ha pasado, con detalle suficiente para animarlo. La interfaz no
 * deduce nada mirando el estado antes y después: lee estos eventos.
 */
export type GameEvent =
  | { type: 'IniciativaTirada'; turno: number; tiradas: Readonly<Record<PlayerId, number>>; orden: readonly PlayerId[] }
  | { type: 'UnidadDesplegada'; unidadId: string; owner: PlayerId; puestoId: string }
  | { type: 'MiniaturaReforzada'; unidadId: string; miniId: string }
  | { type: 'DesplieguePasado'; jugador: PlayerId }
  | { type: 'ActivacionesAbiertas'; turno: number }
  | { type: 'UnidadActivada'; unidadId: string; jugador: PlayerId }
  | { type: 'AccionUsada'; unidadId: string; accion: ActionKind; coste: number }
  | {
      type: 'UnidadMovida';
      unidadId: string;
      desde: Readonly<Record<string, Vec2>>;
      hasta: Readonly<Record<string, Vec2>>;
      corriendo: boolean;
    }
  | {
      type: 'AtaqueResuelto';
      atacanteId: string;
      objetivoId: string;
      arma: 'disparo' | 'cac';
      /** Qué parte de la unidad ataca: la tropa, el Comandante, o la miniatura suelta. */
      parte: 'tropa' | 'comandante' | 'unidad';
      minis: number;
      enCobertura: boolean;
      gratuito: boolean;
      tirada: TiradaAtaque;
    }
  | { type: 'ExplosivaAlcanza'; atacanteId: string; unidadId: string; minis: number; danio: number }
  | {
      type: 'DanioRecibido';
      unidadId: string;
      danio: number;
      /** Lo que se quitó Resistente. */
      reducido: number;
      muertas: readonly string[];
      porId: string | null;
    }
  | { type: 'UnidadDestruida'; unidadId: string; owner: PlayerId; porId: string | null }
  | {
      type: 'CargaResuelta';
      unidadId: string;
      objetivoId: string;
      dado: number;
      exito: boolean;
      desde: Readonly<Record<string, Vec2>>;
      hasta: Readonly<Record<string, Vec2>>;
    }
  | { type: 'UnidadesTrabadas'; a: string; b: string }
  | { type: 'AtaqueGratuitoPendiente'; unidadId: string; objetivoId: string }
  | { type: 'DestrabeResuelto'; unidadId: string; dado: number; exito: boolean }
  | { type: 'ActivacionTerminada'; unidadId: string }
  | { type: 'TurnoTerminado'; turno: number }
  | { type: 'PuestoConquistado'; puestoId: string; jugador: PlayerId | null; anterior: PlayerId | null }
  | { type: 'PuntosGanados'; jugador: PlayerId; puntos: number; motivo: string; total: number }
  | { type: 'PartidaTerminada'; ganador: PlayerId | null; motivo: string };

export type CommandResult =
  | { readonly ok: true; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly reason: string };
