import { describe, expect, it } from 'vitest';
import { Engine, vec, type GameState, type Unit, type UnitProfile } from '@zerolore/core';

const perfil: UnitProfile = {
  id: 'choque_asalto',
  nombre: 'Choque Asalto', rol: null,
  clase: 'Choque',
  set: 'Asalto',
  movimiento: 5,
  vidas: 4,
  salvacion: 5,
  velocidad: 2,
  escuadraMin: 5,
  escuadraMax: 10,
  valor: 2,
  habilidad: null,
  armas: [],
  radioPeana: 0.63,
};

const unit = (id: string, owner: string, x: number, y: number): Unit => ({
  id, profileId: 'choque_asalto', owner, position: vec(x, y),
  vidas: 4, activated: false, accionesRestantes: 0, accionesUsadas: [],
  trabadaCon: [], seMovio: false, corrio: false, cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null,
});

const estado = (): GameState => ({
  mode: 'Escaramuza', turno: 1, fase: 'Despliegue',
  jugadores: ['A', 'B'], ordenIniciativa: [], jugadorActivo: null, unidadActiva: null,
  units: { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 26) },
  profiles: { choque_asalto: perfil },
  terrain: [], puestos: [], reserva: [], puntos: {}, refuerzosUsados: {}, desplieguePasado: {}, turnosTotales: 6, rngState: 99,
});

describe('Deshacer una jugada', () => {
  it('restaura la posición y las acciones tras un movimiento', () => {
    const e = new Engine(estado());
    e.execute({ type: 'TirarIniciativa' });
    const activo = e.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    e.execute({ type: 'ActivarUnidad', unitId: activo });

    const antes = e.getState();
    const registroAntes = e.getLog().length;

    e.execute({ type: 'Mover', unitId: activo, destino: vec(antes.units[activo]!.position.x, antes.units[activo]!.position.y + 4) });
    expect(e.getState().units[activo]!.accionesRestantes).toBe(1);

    // Deshacer = reconstruir el motor desde la instantánea previa.
    const deshecho = new Engine(antes, e.getLog().slice(0, registroAntes));
    expect(deshecho.getState().units[activo]!.position).toEqual(antes.units[activo]!.position);
    expect(deshecho.getState().units[activo]!.accionesRestantes).toBe(2);
    expect(deshecho.getState().units[activo]!.accionesUsadas).toHaveLength(0);
    expect(deshecho.getLog()).toHaveLength(registroAntes);
  });

  it('tras deshacer se puede volver a mover, esta vez a otro sitio', () => {
    const e = new Engine(estado());
    e.execute({ type: 'TirarIniciativa' });
    const activo = e.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    e.execute({ type: 'ActivarUnidad', unitId: activo });

    const antes = e.getState();
    const origen = antes.units[activo]!.position;
    e.execute({ type: 'Mover', unitId: activo, destino: vec(origen.x + 3, origen.y) });

    const deshecho = new Engine(antes, e.getLog());
    const r = deshecho.execute({ type: 'Mover', unitId: activo, destino: vec(origen.x, origen.y + 3) });
    expect(r.ok).toBe(true);
    expect(deshecho.getState().units[activo]!.position.y).toBeCloseTo(origen.y + 3);
  });

  it('deshacer conserva el estado del generador: la tirada se repite igual', () => {
    const e = new Engine(estado());
    const antes = e.getState();
    e.execute({ type: 'TirarIniciativa' });
    const primera = e.getState().ordenIniciativa;

    const deshecho = new Engine(antes, []);
    deshecho.execute({ type: 'TirarIniciativa' });
    expect(deshecho.getState().ordenIniciativa).toEqual(primera);
  });
});
