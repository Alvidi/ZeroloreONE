export { Rng } from './rng.ts';
export * from './geometry.ts';
export * from './types.ts';
export * from './dados.ts';
export { Engine, distanciaEntre, type Command } from './engine.ts';
export type { GameEvent, CommandResult } from './events.ts';
export { leerCatalogo, claveTipo } from './catalogo.ts';
export { crearPartida, type EntradaLista, type OpcionesPartida } from './partida.ts';
export {
  parametrosAtaque,
  resolverAtaque,
  tiene,
  type Parametros,
  type Situacion,
  type TiradaAtaque,
} from './rules/combat.ts';
export { prever, preverParte, type Prevision, type PrevisionParte } from './rules/prevision.ts';
export { ordenDeBajas, repartirDanio, bajasCon } from './rules/danio.ts';
export {
  esCoherente,
  formar,
  motivoSitio,
  ocupantesMenos,
  piniaAlrededor,
  recorrido,
  restriccionesPara,
  type Ocupante,
  type Pieza,
  type Restricciones,
} from './rules/formacion.ts';
export { coberturasDe, disparaDesdeCobertura, masCercana, unidadEnCobertura, veA } from './rules/los.ts';
export { controlTrasTurno, hayMinisDe, miniOcupa, puedeDesplegarEn, tocaPuesto, valorEnPuesto } from './rules/puestos.ts';
export { poligonoDeVision, puntoEnPoligono } from './rules/vision.ts';
export { caminoMasCorto, recortarCamino, type Camino } from './rules/camino.ts';
export { siguienteJugada, huecoJuntoA, posicionesDeDespliegue, type Jugada } from './ia.ts';
