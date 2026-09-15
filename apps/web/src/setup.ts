import {
  vec,
  type EnReserva,
  type GameState,
  type Puesto,
  type Terrain,
  type Unit,
  type UnitProfile,
} from '@zerolore/core';
import profilesJson from '../../../packages/data/profiles.json';

const profiles = profilesJson as unknown as UnitProfile[];

/** Mesa de escaramuza, en pulgadas. */
export const MESA = { ancho: 44, alto: 30 };

/**
 * Habilidades de arma y de unidad apagadas mientras se cierra la base del
 * juego. El motor las tiene implementadas y probadas; se encienden poniendo
 * esto en true, sin tocar nada más.
 */
export const HABILIDADES_ACTIVAS = false;

export const PERFILES = profiles;

/** Solo estas clases pueden jugar en Escaramuza (Vehículos, Monstruos y Artillería no). */
export const PERFILES_ESCARAMUZA = profiles.filter(
  (p) => !['Vehiculo', 'Monstruo', 'Artilleria'].includes(p.clase),
);

export const perfilPorId = (id: string): UnitProfile | undefined =>
  profiles.find((p) => p.id === id);

/**
 * Mesa de pruebas: un bloqueo en el centro que parte la mesa en dos y obliga a
 * elegir flanco, y una cobertura a cada lado para tener dónde resguardarse al
 * avanzar. Nada más, para que se lea bien lo que pasa.
 */
const TERRENO: Terrain[] = [
  { id: 'ruina-central', rect: { x: 19, y: 12, width: 6, height: 6 }, altura: 4, tipo: 'bloqueo' },
  { id: 'murete-oeste', rect: { x: 8, y: 14.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' },
  { id: 'murete-este', rect: { x: 30, y: 14.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' },
];

/**
 * Puestos de mando de la mesa de pruebas. Cada jugador arranca con su Cuartel
 * General —obligatorio según el reglamento— y hay dos puestos neutrales por
 * los flancos, a repartir. Son los únicos puntos por donde entran refuerzos.
 */
export const PUESTOS: readonly Puesto[] = [
  // Los Cuarteles Generales usan el token grande de 6"; los demás, el de 3".
  { id: 'cg-a', centro: vec(22, 4), radio: 3, esCuartelGeneral: true, duenio: 'A' },
  { id: 'cg-b', centro: vec(22, 26), radio: 3, esCuartelGeneral: true, duenio: 'B' },
  /*
    Los cuatro a disputar van pegados a la ruina central, uno por cara. Se
    conquistan desde su sombra: quien los quiera tiene que meterse justo donde
    no ve ni le ven, y el que ataca no puede tirarle desde lejos. Ninguno toca
    los Cuarteles Generales, para que no se regalen.
  */
  { id: 'ruina-oeste', centro: vec(17.4, 15), radio: 1.5, esCuartelGeneral: false, duenio: null },
  { id: 'ruina-este', centro: vec(26.6, 15), radio: 1.5, esCuartelGeneral: false, duenio: null },
  { id: 'ruina-norte', centro: vec(22, 10.5), radio: 1.5, esCuartelGeneral: false, duenio: null },
  { id: 'ruina-sur', centro: vec(22, 19.5), radio: 1.5, esCuartelGeneral: false, duenio: null },
];

/**
 * Lista por defecto: un Héroe (obligatorio según el reglamento) más las
 * unidades que se le indiquen por id de perfil.
 */
export interface Lista {
  readonly heroeId: string;
  readonly unidadIds: readonly string[];
  /** Unidades que empiezan fuera de la mesa y entran como refuerzo. */
  readonly reservaIds?: readonly string[];
}

/**
 * Mapa de pruebas: un solo combatiente por bando. Sin Héroe todavía —el
 * reglamento lo exige en partida real, pero aquí estorba para probar reglas.
 */
/*
  Tres unidades por bando, una de cada set, para ver la diferencia entre ellas.
  TODAS empiezan en Reserva: como dice el reglamento, la mesa se llena
  desplegando por los puestos de mando que controlas, y en el turno 1 eso son
  solo los Cuarteles Generales.
*/
export const LISTA_A: Lista = {
  heroeId: '',
  unidadIds: [],
  reservaIds: ['choque_disparo', 'choque_equilibrado', 'choque_asalto'],
};
export const LISTA_B: Lista = {
  heroeId: '',
  unidadIds: [],
  reservaIds: ['choque_disparo', 'choque_equilibrado', 'choque_asalto'],
};
export const LISTA_POR_DEFECTO: Lista = LISTA_A;

export function createGame(listaA: Lista, listaB: Lista, semilla: number): GameState {
  const units: Record<string, Unit> = {};
  const profileMap: Record<string, UnitProfile> = {};
  const reserva: EnReserva[] = [];

  /** Unidades que empiezan fuera de la mesa, a la espera de un puesto de mando. */
  const enviarAReserva = (lista: Lista, owner: string, desde: number): void => {
    (lista.reservaIds ?? []).forEach((pid, i) => {
      const p = perfilPorId(pid);
      if (!p) return;
      profileMap[p.id] = p;
      reserva.push({ id: `${owner}${desde + i}`, profileId: p.id, owner });
    });
  };

  const deploy = (lista: Lista, owner: string, y: number): void => {
    const ids = [lista.heroeId, ...lista.unidadIds].filter((v) => v !== '');
    const paso = MESA.ancho / (ids.length + 1);
    ids.forEach((pid, i) => {
      const p = perfilPorId(pid);
      if (!p) return;
      profileMap[p.id] = p;
      const id = `${owner}${i + 1}`;
      units[id] = {
        id,
        profileId: p.id,
        owner,
        position: vec(paso * (i + 1), y),
        vidas: p.vidas,
        activated: false,
        accionesRestantes: 0,
        accionesUsadas: [],
        trabadaCon: [],
        seMovio: false,
        corrio: false,
        cargo: false,
      destruidaEnTurno: null,
      ataqueGratuitoContra: null,
      };
    });
  };

  deploy(listaA, 'A', 6);
  deploy(listaB, 'B', MESA.alto - 6);
  enviarAReserva(listaA, 'A', 1 + [listaA.heroeId, ...listaA.unidadIds].filter((v) => v !== '').length);
  enviarAReserva(listaB, 'B', 1 + [listaB.heroeId, ...listaB.unidadIds].filter((v) => v !== '').length);

  return {
    mode: 'Escaramuza',
    turno: 1,
    fase: 'Iniciativa',
    jugadores: ['A', 'B'],
    ordenIniciativa: [],
    jugadorActivo: null,
    unidadActiva: null,
    units,
    profiles: profileMap,
    terrain: TERRENO,
    puestos: PUESTOS,
    reserva,
    puntos: { A: 0, B: 0 },
    refuerzoUsado: {}, turnosTotales: 6,
    rngState: semilla,
  };
}
