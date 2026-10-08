import { CATALOGO } from '@zerolore/data';
import {
  crearPartida,
  leerCatalogo,
  vec,
  type EntradaLista,
  type GameState,
  type PlayerId,
  type Puesto,
  type Terrain,
} from '@zerolore/core';

/** Los tipos de unidad, leídos una vez del catálogo de la web. */
export const TIPOS = leerCatalogo(CATALOGO);

export const MESA = { ancho: 60, alto: 30 };

/** El jugador humano. La IA lleva al otro. */
export const HUMANO: PlayerId = 'A';
export const MAQUINA: PlayerId = 'B';

export const NOMBRE_JUGADOR: Record<PlayerId, string> = { A: 'Azul', B: 'Rojo' };
export const COLOR_JUGADOR: Record<PlayerId, number> = { A: 0x3b82f6, B: 0xef4444 };
export const CSS_JUGADOR: Record<PlayerId, string> = { A: '#3b82f6', B: '#ef4444' };

/**
 * Ejércitos de prueba con los siete perfiles del prototipo. Azul es de
 * disparo con un martillo de Choques; Rojo, una marea de Milicia con un
 * Exterminador y una escuadra de Tiradores. Las sueltas sirven para reforzar
 * a los Comandantes o para salir solas.
 */
const LISTAS: Record<PlayerId, EntradaLista[]> = {
  A: [
    { tipoId: 'comandante-disparo', escuadra: { tipoId: 'tirador', cantidad: 3 } },
    { tipoId: 'comandante-cac', escuadra: { tipoId: 'choque', cantidad: 3 } },
    { tipoId: 'juggernaut' },
    { tipoId: 'tirador' },
    { tipoId: 'choque' },
  ],
  B: [
    { tipoId: 'comandante-cac', escuadra: { tipoId: 'milicia', cantidad: 6 } },
    { tipoId: 'exterminador' },
    { tipoId: 'comandante-disparo', escuadra: { tipoId: 'tirador', cantidad: 3 } },
    { tipoId: 'milicia' },
    { tipoId: 'milicia' },
  ],
};

/**
 * Mesa de 60×30 con simetría central: lo que tiene un bando lo tiene el otro
 * girado media vuelta. Los Cuarteles Generales en los bordes largos y tres
 * puestos neutrales que, conquistados, aceleran los refuerzos.
 */
const TERRENO: Terrain[] = [
  { id: 'edificio-oeste', rect: { x: 8, y: 19, width: 6, height: 5 }, altura: 4, tipo: 'bloqueo' },
  { id: 'edificio-este', rect: { x: 46, y: 6, width: 6, height: 5 }, altura: 4, tipo: 'bloqueo' },
  { id: 'murete-norte', rect: { x: 21, y: 10.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' },
  { id: 'murete-sur', rect: { x: 33, y: 18.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' },
  { id: 'barricada-oeste', rect: { x: 17, y: 16, width: 1.2, height: 4 }, altura: 1.4, tipo: 'cobertura' },
  { id: 'barricada-este', rect: { x: 41.8, y: 10, width: 1.2, height: 4 }, altura: 1.4, tipo: 'cobertura' },
  { id: 'charca-norte', rect: { x: 2, y: 4, width: 5, height: 3 }, altura: 0, tipo: 'obstaculo' },
  { id: 'charca-sur', rect: { x: 53, y: 23, width: 5, height: 3 }, altura: 0, tipo: 'obstaculo' },
];

const PUESTOS: Puesto[] = [
  { id: 'cg-azul', centro: vec(30, 4), radio: 3, esCuartelGeneral: true, duenio: 'A' },
  { id: 'cg-rojo', centro: vec(30, 26), radio: 3, esCuartelGeneral: true, duenio: 'B' },
  { id: 'oeste', centro: vec(10, 13), radio: 2.5, esCuartelGeneral: false, duenio: null },
  { id: 'centro', centro: vec(30, 15), radio: 2.5, esCuartelGeneral: false, duenio: null },
  { id: 'este', centro: vec(50, 17), radio: 2.5, esCuartelGeneral: false, duenio: null },
];

/** Semilla nueva para cada partida: el azar de cosmética no toca la partida. */
export function semillaNueva(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

export function nuevaPartida(semilla: number): GameState {
  return crearPartida({
    tipos: TIPOS,
    jugadores: ['A', 'B'],
    listas: LISTAS,
    terreno: TERRENO,
    puestos: PUESTOS,
    mesa: MESA,
    // Guerra Total recomienda 5 turnos.
    turnosTotales: 5,
    semilla,
  });
}

/** Ruta del icono de un tipo de unidad (los cuatro Comandantes comparten uno). */
export function iconoDe(tipoId: string): string {
  return `tipos/${tipoId.startsWith('comandante') ? 'comandante' : tipoId}.png`;
}
