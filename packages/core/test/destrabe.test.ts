import { describe, expect, it } from 'vitest';
import { Engine, vec, type GameState, type Unit, type UnitProfile } from '@zerolore/core';

const perfil = (over: Partial<UnitProfile> = {}): UnitProfile => ({
  id: 'p', nombre: 'Choque', rol: null, clase: 'Choque', set: 'Equilibrado',
  movimiento: 5, vidas: 8, salvacion: 5, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: 0.63,
  armas: [{ kind: 'cuerpo_a_cuerpo', nombre: 'Espada', ataques: 2, danio: 1, danioCritico: 2, habilidades: [] }],
  ...over,
});

const unit = (id: string, owner: string, x: number, y: number, trabadaCon: string[]): Unit => ({
  id, profileId: 'p', owner, position: vec(x, y), vidas: 8,
  activated: false, accionesRestantes: 0, accionesUsadas: [],
  trabadaCon, seMovio: false, corrio: false, cargo: false,
  destruidaEnTurno: null, ataqueGratuitoContra: null,
});

const estado = (semilla: number, profiles: Record<string, UnitProfile>, units: Record<string, Unit>): GameState => ({
  mode: 'Escaramuza', turno: 1, fase: 'Iniciativa',
  jugadores: ['A', 'B'], ordenIniciativa: [], jugadorActivo: null, unidadActiva: null,
  units, profiles, terrain: [], puestos: [], reserva: [], puntos: {}, refuerzoUsado: {}, turnosTotales: 6, rngState: semilla,
});

const trabadas = (semilla: number) =>
  estado(semilla, { p: perfil() }, {
    a1: unit('a1', 'A', 10, 10, ['b1']),
    b1: unit('b1', 'B', 11.26, 10, ['a1']),
  });

function activar(e: Engine): string {
  e.execute({ type: 'TirarIniciativa' });
  e.execute({ type: 'ComenzarActivaciones' });
  const s = e.getState();
  const u = Object.values(s.units).find((x) => x.owner === s.jugadorActivo)!;
  e.execute({ type: 'ActivarUnidad', unitId: u.id });
  return u.id;
}

describe('Destrabarse', () => {
  it('con 4+ se libera y conserva la acción restante', () => {
    for (let semilla = 0; semilla < 40; semilla++) {
      const e = new Engine(trabadas(semilla));
      const id = activar(e);
      const r = e.execute({ type: 'Destrabarse', unitId: id });
      if (!r.ok) continue;
      const ev = r.events.find((x) => x.type === 'DestrabeResuelto');
      if (!ev || ev.type !== 'DestrabeResuelto' || !ev.exito) continue;

      expect(ev.dado).toBeGreaterThanOrEqual(4);
      const u = e.getState().units[id]!;
      expect(u.trabadaCon).toHaveLength(0);
      // Destrabarse cuesta 1 acción: queda otra.
      expect(u.accionesRestantes).toBe(1);
      // El rival también deja de estar trabado con ella.
      const rival = id === 'a1' ? 'b1' : 'a1';
      expect(e.getState().units[rival]!.trabadaCon).not.toContain(id);
      return;
    }
    throw new Error('Ninguna semilla dio un destrabe con éxito');
  });

  it('con 1, 2 o 3 pierde todas las acciones y termina su activación', () => {
    for (let semilla = 0; semilla < 40; semilla++) {
      const e = new Engine(trabadas(semilla));
      const id = activar(e);
      const r = e.execute({ type: 'Destrabarse', unitId: id });
      if (!r.ok) continue;
      const ev = r.events.find((x) => x.type === 'DestrabeResuelto');
      if (!ev || ev.type !== 'DestrabeResuelto' || ev.exito) continue;

      expect(ev.dado).toBeLessThanOrEqual(3);
      const u = e.getState().units[id]!;
      expect(u.trabadaCon).toContain(id === 'a1' ? 'b1' : 'a1');
      expect(u.accionesRestantes).toBe(0);
      expect(r.events.some((x) => x.type === 'ActivacionTerminada')).toBe(true);
      return;
    }
    throw new Error('Ninguna semilla dio un destrabe fallido');
  });

  it('Anclado del rival impide destrabarse', () => {
    const anclado = perfil({ id: 'anc', habilidad: { nombre: 'Anclado', descripcion: '' } });
    const e = new Engine(
      estado(7, { p: perfil(), anc: anclado }, {
        a1: unit('a1', 'A', 10, 10, ['b1']),
        b1: { ...unit('b1', 'B', 11.26, 10, ['a1']), profileId: 'anc' },
      }),
    );
    e.execute({ type: 'TirarIniciativa' });
    e.execute({ type: 'ComenzarActivaciones' });
    // Se fuerza que actúe A, que es quien está anclado por b1.
    while (e.getState().jugadorActivo !== 'A') {
      const s = e.getState();
      const u = Object.values(s.units).find((x) => x.owner === s.jugadorActivo && !x.activated)!;
      e.execute({ type: 'ActivarUnidad', unitId: u.id });
      e.execute({ type: 'TerminarActivacion', unitId: u.id });
    }
    e.execute({ type: 'ActivarUnidad', unitId: 'a1' });
    const r = e.execute({ type: 'Destrabarse', unitId: 'a1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Anclado');
  });

  it('Porrazo se destraba sin chequeo', () => {
    const porrazo = perfil({ id: 'por', habilidad: { nombre: 'Porrazo', descripcion: '' } });
    const e = new Engine(
      estado(7, { p: perfil(), por: porrazo }, {
        a1: { ...unit('a1', 'A', 10, 10, ['b1']), profileId: 'por' },
        b1: unit('b1', 'B', 11.26, 10, ['a1']),
      }),
    );
    e.execute({ type: 'TirarIniciativa' });
    e.execute({ type: 'ComenzarActivaciones' });
    while (e.getState().jugadorActivo !== 'A') {
      const s = e.getState();
      const u = Object.values(s.units).find((x) => x.owner === s.jugadorActivo && !x.activated)!;
      e.execute({ type: 'ActivarUnidad', unitId: u.id });
      e.execute({ type: 'TerminarActivacion', unitId: u.id });
    }
    e.execute({ type: 'ActivarUnidad', unitId: 'a1' });
    const r = e.execute({ type: 'Destrabarse', unitId: 'a1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ev = r.events.find((x) => x.type === 'DestrabeResuelto');
      expect(ev?.type === 'DestrabeResuelto' && ev.exito).toBe(true);
    }
    expect(e.getState().units.a1!.trabadaCon).toHaveLength(0);
  });
});
