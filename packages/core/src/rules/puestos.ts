import { areaSolapeCirculos, baseDistance, centerDistance } from '../geometry.ts';
import type { GameState, PlayerId, Puesto, Unit, UnitProfile } from '../types.ts';

/**
 * Reglas de los puestos de mando: quién los ocupa, quién los controla y desde
 * dónde se puede desplegar.
 */

/** Clases que ocupan un puesto pero nunca lo conquistan ni lo defienden. */
const SIN_VALOR = new Set(['Vehiculo', 'Monstruo', 'Artilleria']);

/**
 * ¿La miniatura está DENTRO del puesto? El reglamento pide que la mitad o más
 * de la peana esté encima, así que se compara el área de solape con media
 * peana — no basta con que el centro caiga dentro.
 */
export function unidadOcupa(puesto: Puesto, unit: Unit, perfil: UnitProfile): boolean {
  if (unit.vidas <= 0) return false;
  const peana = Math.PI * perfil.radioPeana ** 2;
  return areaSolapeCirculos(unit.position, perfil.radioPeana, puesto.centro, puesto.radio)
    >= peana / 2 - 1e-9;
}

/**
 * A qué distancia del centro del puesto puede estar el centro de la peana y
 * seguir ocupándolo. Sale de la misma regla de "media peana o más": se resuelve
 * por tanteo porque el área de la lente no se despeja a mano.
 *
 * Para un puesto de 3" y una peana de 25 mm da 1,45" — o sea, prácticamente
 * que el centro caiga dentro del token.
 */
export function distanciaMaximaParaOcupar(puesto: Puesto, radioPeana: number): number {
  const media = (Math.PI * radioPeana ** 2) / 2;
  let dentro = 0;
  let fuera = puesto.radio + radioPeana;
  for (let i = 0; i < 40; i += 1) {
    const medio = (dentro + fuera) / 2;
    const solape = areaSolapeCirculos(
      { x: puesto.centro.x + medio, y: puesto.centro.y }, radioPeana, puesto.centro, puesto.radio,
    );
    if (solape >= media) dentro = medio;
    else fuera = medio;
  }
  return dentro;
}

/** Unidades de un jugador que ocupan el puesto, vivas y sobre la mesa. */
export function ocupantes(state: GameState, puesto: Puesto, owner?: PlayerId): Unit[] {
  return Object.values(state.units).filter((u) => {
    if (owner !== undefined && u.owner !== owner) return false;
    const perfil = state.profiles[u.profileId];
    return !!perfil && unidadOcupa(puesto, u, perfil);
  });
}

/**
 * Valor total que un jugador aporta al puesto. No suman los Vehículos,
 * Monstruos ni Artillería, ni las unidades trabadas en cuerpo a cuerpo —
 * estas últimas se tratan como si no estuvieran hasta resolver el combate.
 */
export function valorEnPuesto(state: GameState, puesto: Puesto, owner: PlayerId): number {
  let total = 0;
  for (const u of ocupantes(state, puesto, owner)) {
    if (u.trabadaCon.length > 0) continue;
    const perfil = state.profiles[u.profileId]!;
    if (SIN_VALOR.has(perfil.clase)) continue;
    total += perfil.valor;
  }
  return total;
}

/**
 * Quién controla el puesto tras este turno. En empate —incluido el 0 a 0 de un
 * puesto vacío— se queda quien ya lo tuviera.
 */
export function controlTrasTurno(state: GameState, puesto: Puesto): PlayerId | null {
  let mejor: PlayerId | null = puesto.duenio;
  let mejorValor = -1;
  let empatado = false;

  for (const jugador of state.jugadores) {
    const valor = valorEnPuesto(state, puesto, jugador);
    if (valor === 0) continue;
    if (valor > mejorValor) {
      mejor = jugador;
      mejorValor = valor;
      empatado = false;
    } else if (valor === mejorValor) {
      empatado = true;
    }
  }

  if (mejorValor < 0) return puesto.duenio; // nadie aporta valor
  return empatado ? puesto.duenio : mejor;
}

/**
 * ¿Puede este jugador meter refuerzos por este puesto? Tiene que controlarlo y
 * no puede haber enemigos ocupándolo, aunque siga siendo suyo por Valor.
 */
export function puedeDesplegarEn(state: GameState, puesto: Puesto, owner: PlayerId): boolean {
  if (puesto.duenio !== owner) return false;
  return !ocupantes(state, puesto).some((u) => u.owner !== owner);
}

/**
 * ¿Vale esta posición para desplegar? La peana tiene que caber ENTERA dentro
 * del puesto, sin sobresalir. Así la unidad lo ocupa desde el primer momento
 * —la mitad o más de la peana encima— y no entra a la mesa regalando el punto.
 */
export function dentroDelPuesto(
  posicion: { x: number; y: number },
  radioPeana: number,
  puesto: Puesto,
): boolean {
  return centerDistance(posicion, puesto.centro) <= puesto.radio - radioPeana + 1e-6;
}

/**
 * Encierra una posición dentro del puesto: la jaula de despliegue. Devuelve el
 * punto más cercano al pedido que deja la peana entera dentro.
 */
export function encerrarEnPuesto(
  posicion: { x: number; y: number },
  radioPeana: number,
  puesto: Puesto,
): { x: number; y: number } {
  const tope = Math.max(0, puesto.radio - radioPeana);
  const dx = posicion.x - puesto.centro.x;
  const dy = posicion.y - puesto.centro.y;
  const d = Math.hypot(dx, dy);
  if (d <= tope) return { x: posicion.x, y: posicion.y };
  if (d < 1e-9) return { x: puesto.centro.x, y: puesto.centro.y + tope };
  return { x: puesto.centro.x + (dx / d) * tope, y: puesto.centro.y + (dy / d) * tope };
}

/** Distancia de peana a peana entre una posición y la unidad más cercana. */
export function libreDeUnidades(
  state: GameState,
  posicion: { x: number; y: number },
  radioPeana: number,
  margen = 0,
): boolean {
  return Object.values(state.units).every((u) => {
    if (u.vidas <= 0) return true;
    const perfil = state.profiles[u.profileId];
    if (!perfil) return true;
    return baseDistance(posicion, radioPeana, u.position, perfil.radioPeana) > margen;
  });
}
