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

/**
 * Mesa de escaramuza, en pulgadas.
 *
 * Proporción 2:1 a propósito: es la del hueco que queda en pantalla entre la
 * cabecera y la banda, así que la mesa lo llena entero en vez de dejar dos
 * franjas muertas a los lados. Cuando haya cámara, esto dejará de mandar y la
 * mesa podrá ser tan grande como pida la partida.
 */
export const MESA = { ancho: 60, alto: 30 };

/**
 * Habilidades encendidas por separado. Las de ARMA ya se juegan; las de UNIDAD
 * (Guardia, Certero, Terror…) siguen apagadas hasta que les toque. El motor
 * tiene las dos implementadas: se encienden cambiando esto, sin tocar nada más.
 */
export const HABILIDADES_ARMA = true;
export const HABILIDADES_UNIDAD = false;

export const PERFILES = profiles;

/** Solo estas clases pueden jugar en Escaramuza (Vehículos, Monstruos y Artillería no). */
export const PERFILES_ESCARAMUZA = profiles.filter(
  (p) => !['Vehiculo', 'Monstruo', 'Artilleria'].includes(p.clase),
);

export const perfilPorId = (id: string): UnitProfile | undefined =>
  profiles.find((p) => p.id === id);

/**
 * Mesa de prácticas: lo mínimo para ver movimiento, cobertura y disparo sin
 * pasear la vista. Un murete junto al puesto disputado y nada más; los dos
 * Cuarteles Generales quedan a 16", que es distancia de tiro desde el primer
 * turno.
 */
const TERRENO: Terrain[] = [
  { id: 'murete', rect: { x: 33, y: 14.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' },
];

/**
 * Puestos de mando de la mesa de pruebas. Cada jugador arranca con su Cuartel
 * General —obligatorio según el reglamento— y hay dos puestos neutrales por
 * los flancos, a repartir. Son los únicos puntos por donde entran refuerzos.
 */
export const PUESTOS: readonly Puesto[] = [
  // Los dos Cuarteles Generales, cerca el uno del otro, y un puesto en medio.
  { id: 'cg-a', centro: vec(30, 7), radio: 3, esCuartelGeneral: true, duenio: 'A' },
  { id: 'cg-b', centro: vec(30, 23), radio: 3, esCuartelGeneral: true, duenio: 'B' },
  { id: 'centro', centro: vec(30, 15), radio: 1.5, esCuartelGeneral: false, duenio: null },
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
  Ejércitos de prueba para las habilidades de arma. Cada bando lleva su Héroe
  —el reglamento exige exactamente uno— y tres unidades de apoyo, elegidas
  para que entren en mesa ocho habilidades distintas entre los dos:

    Azul (34): Nigromante (Directo, Inestable) · Armas Pesadas Disparo
               (Parabólica, Explosiva 1) · Élite Equilibrado (Perforante) ·
               Comando Equilibrado (Errática, Anti-Élite)
    Rojo (32): Místico (Alcance, Directo) · Armas Pesadas Disparo ·
               Élite Disparo (Brutal 5+) · Comando Equilibrado

  Todo empieza en Reserva y el Héroe es lo primero que sale.
*/
export const LISTA_A: Lista = {
  heroeId: '',
  unidadIds: [],
  reservaIds: ['heroe_heroe4', 'armaspesadas_disparo', 'elite_equilibrado', 'comando_equilibrado'],
};
export const LISTA_B: Lista = {
  heroeId: '',
  unidadIds: [],
  reservaIds: ['heroe_heroe5', 'armaspesadas_disparo', 'elite_disparo', 'comando_equilibrado'],
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
    fase: 'Despliegue',
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
    refuerzosUsados: {},
    desplieguePasado: {},
    // Guerra Total recomienda 5 turnos.
    turnosTotales: 5,
    rngState: semilla,
  };
}
