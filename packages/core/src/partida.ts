import type { EnReserva, GameState, PlayerId, Puesto, Terrain, TipoUnidad } from './types.ts';

/**
 * Una entrada de la lista de ejército: un Comandante con su escuadra, o una
 * miniatura suelta. Es lo que espera en Reserva al empezar.
 */
export interface EntradaLista {
  /** Tipo del Comandante, o de la miniatura suelta. */
  readonly tipoId: string;
  /** Si es un Comandante: tipo y número de miniaturas de su escuadra. */
  readonly escuadra?: { readonly tipoId: string; readonly cantidad: number };
}

export interface OpcionesPartida {
  readonly tipos: Readonly<Record<string, TipoUnidad>>;
  readonly jugadores: readonly PlayerId[];
  readonly listas: Readonly<Record<PlayerId, readonly EntradaLista[]>>;
  readonly terreno: readonly Terrain[];
  readonly puestos: readonly Puesto[];
  readonly mesa: { readonly ancho: number; readonly alto: number };
  readonly turnosTotales: number;
  readonly semilla: number;
}

/**
 * Monta una partida con todo en Reserva. Cada entrada de la lista recibe un id
 * corto que luego será el de la unidad en mesa: A1, A2, B1…
 */
export function crearPartida(o: OpcionesPartida): GameState {
  const reserva: EnReserva[] = [];
  for (const j of o.jugadores) {
    (o.listas[j] ?? []).forEach((e, i) => {
      const t = o.tipos[e.tipoId];
      if (!t) throw new Error(`Tipo desconocido en la lista de ${j}: ${e.tipoId}`);
      const minis: { tipoId: string; esComandante: boolean }[] = [{ tipoId: e.tipoId, esComandante: t.esComandante }];
      if (e.escuadra) {
        if (!t.esComandante) throw new Error(`${e.tipoId} no es un Comandante: no puede llevar escuadra`);
        const te = o.tipos[e.escuadra.tipoId];
        if (!te || te.escuadra === null) throw new Error(`${e.escuadra.tipoId} no forma escuadras`);
        if (e.escuadra.cantidad > te.escuadra) {
          throw new Error(`${te.nombre}: escuadra de ${e.escuadra.cantidad}, el máximo es ${te.escuadra}`);
        }
        for (let k = 0; k < e.escuadra.cantidad; k++) minis.push({ tipoId: te.id, esComandante: false });
      }
      reserva.push({ id: `${j}${i + 1}`, owner: j, minis });
    });
  }

  return {
    turno: 1,
    turnosTotales: o.turnosTotales,
    fase: 'Iniciativa',
    jugadores: o.jugadores,
    ordenIniciativa: [],
    jugadorActivo: null,
    unidadActiva: null,
    unidades: {},
    tipos: o.tipos,
    terreno: o.terreno,
    puestos: o.puestos,
    reserva,
    puntos: Object.fromEntries(o.jugadores.map((j) => [j, 0])),
    puestosUsados: [],
    reforzados: [],
    desplieguePasado: {},
    ganador: null,
    mesa: o.mesa,
    rngState: o.semilla >>> 0,
  };
}
