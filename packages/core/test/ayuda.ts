import catalogo from '../../data/catalogo.json';
import {
  Engine,
  leerCatalogo,
  vec,
  type GameState,
  type Mini,
  type PlayerId,
  type Puesto,
  type Terrain,
  type Unidad,
  type Vec2,
} from '@zerolore/core';

/** El catálogo de verdad: los tests juegan con las mismas cifras que la partida. */
export const TIPOS = leerCatalogo(catalogo);

export interface MiniDef {
  readonly tipo: string;
  readonly x: number;
  readonly y: number;
  readonly comandante?: boolean;
  readonly vidas?: number;
}

export interface UnidadDef {
  readonly id: string;
  readonly owner: PlayerId;
  readonly minis: readonly MiniDef[];
  readonly trabadaCon?: readonly string[];
}

export function unidad(d: UnidadDef): Unidad {
  const minis: Mini[] = d.minis.map((m, i) => ({
    id: `${d.id}.${i}`,
    tipoId: m.tipo,
    posicion: vec(m.x, m.y),
    vidas: m.vidas ?? TIPOS[m.tipo]!.vidas,
    esComandante: m.comandante ?? TIPOS[m.tipo]!.esComandante,
  }));
  return {
    id: d.id,
    owner: d.owner,
    minis,
    activada: false,
    accionesRestantes: 0,
    accionesUsadas: [],
    trabadaCon: d.trabadaCon ?? [],
    seMovio: false,
    corrio: false,
    cargo: false,
    ataqueGratuitoContra: null,
    resistenteUsado: false,
  };
}

/** Una escuadra en fila horizontal a partir de (x, y), con el Comandante delante. */
export function escuadra(
  id: string,
  owner: PlayerId,
  comandante: string,
  tropa: string,
  n: number,
  x: number,
  y: number,
): UnidadDef {
  const paso = 1.3;
  return {
    id,
    owner,
    minis: [
      { tipo: comandante, x, y, comandante: true },
      ...Array.from({ length: n }, (_, i) => ({ tipo: tropa, x: x + paso * (i + 1), y })),
    ],
  };
}

export interface OpcionesMesa {
  readonly unidades: readonly UnidadDef[];
  readonly terreno?: readonly Terrain[];
  readonly puestos?: readonly Puesto[];
  readonly semilla?: number;
  readonly juega?: PlayerId;
}

/** Una partida ya en marcha, en activaciones, con las unidades puestas en mesa. */
export function enMesa(o: OpcionesMesa): GameState {
  const unidades: Record<string, Unidad> = {};
  for (const d of o.unidades) unidades[d.id] = unidad(d);
  const juega = o.juega ?? 'A';
  return {
    turno: 1,
    turnosTotales: 5,
    fase: 'Activaciones',
    jugadores: ['A', 'B'],
    ordenIniciativa: juega === 'A' ? ['A', 'B'] : ['B', 'A'],
    jugadorActivo: juega,
    unidadActiva: null,
    unidades,
    tipos: TIPOS,
    terreno: o.terreno ?? [],
    puestos: o.puestos ?? [],
    reserva: [],
    puntos: { A: 0, B: 0 },
    puestosUsados: [],
    reforzados: [],
    desplieguePasado: {},
    ganador: null,
    mesa: { ancho: 60, alto: 30 },
    rngState: o.semilla ?? 7,
  };
}

/** Motor en mesa con la unidad indicada ya activada. */
export function activada(o: OpcionesMesa, unidadId: string): Engine {
  const e = new Engine(enMesa(o));
  const r = e.execute({ type: 'ActivarUnidad', unidadId });
  if (!r.ok) throw new Error(r.reason);
  return e;
}

/** Posiciones desplazando toda la unidad en bloque. */
export function desplazada(u: Unidad, dx: number, dy: number): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  for (const m of u.minis) out[m.id] = vec(m.posicion.x + dx, m.posicion.y + dy);
  return out;
}

/** Repite con varias semillas hasta dar con una que cumpla, o falla. */
export function conAlgunaSemilla<T>(prueba: (semilla: number) => T | null, intentos = 60): T {
  for (let s = 1; s <= intentos; s++) {
    const r = prueba(s);
    if (r !== null) return r;
  }
  throw new Error('Ninguna semilla produjo el caso buscado');
}
