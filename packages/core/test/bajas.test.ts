import { describe, expect, it } from 'vitest';
import { Engine, vec, type GameState, type Unit, type UnitProfile } from '@zerolore/core';

const perfil: UnitProfile = {
  id: 'p', nombre: 'Choque', rol: null, clase: 'Choque', set: 'Disparo',
  movimiento: 5, vidas: 2, salvacion: 6, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: 0.63,
  armas: [
    { kind: 'disparo', nombre: 'Fusil', ataques: 6, distancia: 24, precision: 2, danio: 3, danioCritico: 3, habilidades: [] },
    { kind: 'cuerpo_a_cuerpo', nombre: 'Culata', ataques: 1, danio: 1, danioCritico: 1, habilidades: [] },
  ],
};

const unit = (id: string, owner: string, x: number, y: number): Unit => ({
  id, profileId: 'p', owner, position: vec(x, y), vidas: 2,
  activated: false, accionesRestantes: 0, accionesUsadas: [],
  trabadaCon: [], seMovio: false, corrio: false, cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null,
});

const estado = (): GameState => ({
  mode: 'Escaramuza', turno: 1, fase: 'Iniciativa',
  jugadores: ['A', 'B'], ordenIniciativa: [], jugadorActivo: null, unidadActiva: null,
  units: {
    a1: unit('a1', 'A', 10, 10),
    b1: unit('b1', 'B', 10, 18),
    b2: unit('b2', 'B', 30, 18),
  },
  profiles: { p: perfil }, terrain: [], puestos: [], reserva: [], puntos: {}, refuerzoUsado: {}, turnosTotales: 6, rngState: 5,
});

describe('Bajas en el campo de batalla', () => {
  it('la unidad destruida se queda en la mesa durante ese turno', () => {
    const e = new Engine(estado());
    e.execute({ type: 'TirarIniciativa' });
    e.execute({ type: 'ComenzarActivaciones' });
    // Se fuerza el turno de A para poder disparar con a1.
    // a1 dispara a b1; b2 sigue viva, así que la partida continúa.
    if (e.getState().jugadorActivo !== 'A') {
      const primero = Object.values(e.getState().units).find((x) => x.owner !== 'A')!;
      e.execute({ type: 'ActivarUnidad', unitId: primero.id });
      e.execute({ type: 'TerminarActivacion', unitId: primero.id });
    }
    e.execute({ type: 'ActivarUnidad', unitId: 'a1' });
    e.execute({ type: 'Disparar', unitId: 'a1', targetId: 'b1', armaNombre: 'Fusil' });

    const u = e.getState().units.b1!;
    expect(u.vidas).toBe(0);
    expect(u.destruidaEnTurno).toBe(1);
    // Sigue presente: nada la ha retirado todavía.
    expect(e.getState().units.b1).toBeDefined();
  });

  it('se retira al empezar el turno siguiente', () => {
    const e = new Engine(estado());
    e.execute({ type: 'TirarIniciativa' });
    e.execute({ type: 'ComenzarActivaciones' });
    if (e.getState().jugadorActivo !== 'A') {
      const primero = Object.values(e.getState().units).find((x) => x.owner !== 'A')!;
      e.execute({ type: 'ActivarUnidad', unitId: primero.id });
      e.execute({ type: 'TerminarActivacion', unitId: primero.id });
    }
    e.execute({ type: 'ActivarUnidad', unitId: 'a1' });
    e.execute({ type: 'Disparar', unitId: 'a1', targetId: 'b1', armaNombre: 'Fusil' });
    e.execute({ type: 'TerminarActivacion', unitId: 'a1' });

    // Se agotan las activaciones hasta llegar al Fin de Turno.
    for (let i = 0; i < 10 && e.getState().fase === 'Activaciones'; i++) {
      const s = e.getState();
      const pendiente = Object.values(s.units).find(
        (x) => x.owner === s.jugadorActivo && !x.activated && x.vidas > 0,
      );
      if (!pendiente) break;
      e.execute({ type: 'ActivarUnidad', unitId: pendiente.id });
      e.execute({ type: 'TerminarActivacion', unitId: pendiente.id });
    }

    expect(e.getState().units.b1).toBeDefined();
    const r = e.execute({ type: 'TerminarTurno' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('TerminarTurno falló');

    // b2 sigue viva, así que la partida continúa y se pasa al turno 2.
    expect(r.events.some((ev) => ev.type === 'PartidaTerminada')).toBe(false);
    expect(e.getState().turno).toBe(2);
    expect(e.getState().units.b1).toBeUndefined();
    expect(e.getState().units.b2).toBeDefined();
    expect(r.events.some((ev) => ev.type === 'UnidadRetirada' && ev.unitId === 'b1')).toBe(true);
  });
});

describe('Puntos por bajas', () => {
  it('quien mata se apunta el Valor de la unidad destruida', () => {
    const e = new Engine(estado(), [], { habilidades: false });
    e.execute({ type: 'TirarIniciativa' });
    e.execute({ type: 'ComenzarActivaciones' });
    // Igual que arriba: se cede el turno hasta que le toque a A.
    if (e.getState().jugadorActivo !== 'A') {
      const primero = Object.values(e.getState().units).find((x) => x.owner !== 'A')!;
      e.execute({ type: 'ActivarUnidad', unitId: primero.id });
      e.execute({ type: 'TerminarActivacion', unitId: primero.id });
    }

    e.execute({ type: 'ActivarUnidad', unitId: 'a1' });
    const r = e.execute({ type: 'Disparar', unitId: 'a1', targetId: 'b1', armaNombre: 'Fusil' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.events.some((ev) => ev.type === 'UnidadDestruida' && ev.unitId === 'b1')).toBe(true);
    const puntos = r.events.find((ev) => ev.type === 'PuntosGanados');
    expect(puntos).toBeDefined();
    if (puntos?.type === 'PuntosGanados') {
      expect(puntos.jugador).toBe('A');
      expect(puntos.puntos).toBe(perfil.valor);
    }
    expect(e.getState().puntos.A).toBe(perfil.valor);
  });

  it('matarte tú solo no da puntos a nadie', () => {
    // El retroceso de un arma Inestable no lleva causante.
    const e = new Engine(estado(), [], { habilidades: false });
    expect(e.getState().puntos).toEqual({});
  });
});
