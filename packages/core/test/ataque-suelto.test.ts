import { describe, expect, it } from 'vitest';
import { Engine, vec, type GameState, type Unit, type UnitProfile } from '@zerolore/core';

/**
 * Ataque suelto: pegarse a un enemigo a 1" o menos sin estar trabado. Ni el
 * atacante ni el objetivo quedan trabados, así que los dos siguen libres para
 * moverse o disparar en su activación. A contacto solo se llega cargando.
 */

const RADIO = 0.5;

const perfil: UnitProfile = {
  id: 'p', nombre: 'Choque Asalto', rol: null, clase: 'Choque', set: 'Asalto',
  movimiento: 5, vidas: 8, salvacion: 5, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: RADIO,
  armas: [
    { kind: 'cuerpo_a_cuerpo', nombre: 'Bárbaro', ataques: 2, danio: 1, danioCritico: 2, habilidades: [] },
    { kind: 'disparo', nombre: 'Corta', ataques: 1, distancia: 6, precision: 4, danio: 1, danioCritico: 1, habilidades: [] },
  ],
};

const unit = (id: string, owner: string, x: number, y: number): Unit => ({
  id, profileId: 'p', owner, position: vec(x, y), vidas: 8,
  activated: false, accionesRestantes: 0, accionesUsadas: [],
  trabadaCon: [], seMovio: false, corrio: false, cargo: false,
  destruidaEnTurno: null, ataqueGratuitoContra: null,
});

/** Dos enemigos separados exactamente `separacion` pulgadas de peana a peana. */
function enfrentados(separacion: number): { motor: Engine; u: string; enemigo: string } {
  const estado: GameState = {
    mode: 'Escaramuza', turno: 1, fase: 'Despliegue',
    jugadores: ['A', 'B'], ordenIniciativa: [], jugadorActivo: null, unidadActiva: null,
    units: { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 10 + separacion + RADIO * 2) },
    profiles: { p: perfil }, terrain: [], puestos: [], reserva: [], puntos: {}, refuerzosUsados: {}, desplieguePasado: {},
    turnosTotales: 6, rngState: 7,
  };
  const motor = new Engine(estado);
  motor.execute({ type: 'TirarIniciativa' });
  const s = motor.getState();
  const u = Object.values(s.units).find((x) => x.owner === s.jugadorActivo)!.id;
  motor.execute({ type: 'ActivarUnidad', unitId: u });
  return { motor, u, enemigo: u === 'a1' ? 'b1' : 'a1' };
}

describe('ataque suelto', () => {
  it('se puede atacar a un enemigo a 1" sin estar trabado', () => {
    const { motor, u, enemigo } = enfrentados(1);
    const r = motor.execute({ type: 'AtacarCaC', unitId: u, targetId: enemigo, armaNombre: 'Bárbaro' });
    expect(r.ok).toBe(true);
  });

  it('atacando suelto no queda trabada ninguna de las dos', () => {
    const { motor, u, enemigo } = enfrentados(1);
    motor.execute({ type: 'AtacarCaC', unitId: u, targetId: enemigo, armaNombre: 'Bárbaro' });
    const s = motor.getState();
    expect(s.units[u]!.trabadaCon).toEqual([]);
    expect(s.units[enemigo]!.trabadaCon).toEqual([]);
  });

  it('a más de 1" no se puede', () => {
    const { motor, u, enemigo } = enfrentados(2);
    const r = motor.execute({ type: 'AtacarCaC', unitId: u, targetId: enemigo, armaNombre: 'Bárbaro' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('trabado');
  });
});
