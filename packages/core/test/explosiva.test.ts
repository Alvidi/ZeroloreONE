import { describe, expect, it } from 'vitest';
import { Engine, vec } from '@zerolore/core';
import type { GameState, Unit, UnitProfile } from '@zerolore/core';

/**
 * Un arma que siempre impacta (Directo), contra un defensor sin salvación útil,
 * para que el daño sea seguro y la prueba no dependa de los dados.
 */
const perfil = (explosiva: number | null): UnitProfile => ({
  id: 'p', nombre: 'Granadero', rol: null, clase: 'Choque', set: 'Disparo',
  movimiento: 5, vidas: 10, salvacion: 6, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 3, habilidad: null, radioPeana: 0.63,
  armas: [
    {
      kind: 'disparo', nombre: 'Lanzagranadas', ataques: 2, distancia: 24, precision: null,
      danio: 2, danioCritico: 2,
      habilidades: [
        { nombre: 'Directo' },
        ...(explosiva !== null ? [{ nombre: 'Explosiva X' as const, x: explosiva }] : []),
      ],
    },
    { kind: 'cuerpo_a_cuerpo', nombre: 'Culata', ataques: 1, danio: 1, danioCritico: 1, habilidades: [] },
  ],
});

const soldado = (id: string, owner: string, x: number, y: number): Unit => ({
  id, profileId: 'p', owner, position: vec(x, y), vidas: 10, activated: true,
  accionesRestantes: 2, accionesUsadas: [], trabadaCon: [], seMovio: false,
  corrio: false, cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null,
});

const escena = (explosiva: number | null, units: Record<string, Unit>): Engine =>
  new Engine(
    {
      mode: 'Escaramuza', turno: 1, fase: 'Activaciones',
      jugadores: ['A', 'B'], ordenIniciativa: ['A', 'B'], jugadorActivo: 'A', unidadActiva: 'a1',
      units, profiles: { p: perfil(explosiva) }, terrain: [], puestos: [], reserva: [],
      puntos: {}, refuerzosUsados: {}, desplieguePasado: {}, turnosTotales: 6, rngState: 7,
    } satisfies GameState,
    [],
    { habilidadesArma: true, habilidadesUnidad: false },
  );

const disparar = (e: Engine) =>
  e.execute({ type: 'Disparar', unitId: 'a1', targetId: 'b1', armaNombre: 'Lanzagranadas' });

describe('Explosiva (X)', () => {
  it('la onda alcanza a un enemigo a 3" del impactado y le hace el mismo daño', () => {
    const e = escena(1, {
      a1: soldado('a1', 'A', 5, 10),
      b1: soldado('b1', 'B', 15, 10),
      b2: soldado('b2', 'B', 17, 10), // 2" entre centros: pegada al objetivo
    });
    const r = disparar(e);
    expect(r.ok).toBe(true);
    const s = e.getState();
    const recibido = 10 - s.units.b1!.vidas;
    expect(recibido).toBeGreaterThan(0);
    expect(10 - s.units.b2!.vidas).toBe(recibido);
  });

  it('no pasa de X miniaturas, y elige las más cercanas', () => {
    const e = escena(1, {
      a1: soldado('a1', 'A', 5, 10),
      b1: soldado('b1', 'B', 15, 10),
      cerca: soldado('cerca', 'B', 16.5, 10),
      lejos: soldado('lejos', 'B', 15, 13),
    });
    disparar(e);
    const s = e.getState();
    expect(s.units.cerca!.vidas).toBeLessThan(10);
    expect(s.units.lejos!.vidas).toBe(10);
  });

  it('no alcanza a lo que está a más de 3"', () => {
    const e = escena(2, {
      a1: soldado('a1', 'A', 5, 10),
      b1: soldado('b1', 'B', 15, 10),
      b2: soldado('b2', 'B', 20, 10), // 5" entre centros: 3.74" de peana a peana
    });
    disparar(e);
    expect(e.getState().units.b2!.vidas).toBe(10);
  });

  it('nunca le mete la metralla a los aliados del atacante', () => {
    const e = escena(3, {
      a1: soldado('a1', 'A', 5, 10),
      a2: soldado('a2', 'A', 16.5, 10), // aliado pegado al objetivo
      b1: soldado('b1', 'B', 15, 10),
    });
    disparar(e);
    expect(e.getState().units.a2!.vidas).toBe(10);
  });

  it('sin la habilidad no hay onda', () => {
    const e = escena(null, {
      a1: soldado('a1', 'A', 5, 10),
      b1: soldado('b1', 'B', 15, 10),
      b2: soldado('b2', 'B', 16.5, 10),
    });
    disparar(e);
    expect(e.getState().units.b2!.vidas).toBe(10);
  });

  it('las bajas de la onda también puntúan para el atacante', () => {
    const e = escena(1, {
      a1: soldado('a1', 'A', 5, 10),
      b1: soldado('b1', 'B', 15, 10),
      b2: { ...soldado('b2', 'B', 16.5, 10), vidas: 1 },
    });
    const r = disparar(e);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.some((ev) => ev.type === 'UnidadDestruida' && ev.unitId === 'b2')).toBe(true);
    expect(e.getState().puntos.A ?? 0).toBeGreaterThanOrEqual(3);
  });
});
