import { beforeEach, describe, expect, it } from 'vitest';
import { Engine, vec, type GameState, type Unit, type UnitProfile } from '@zerolore/core';

const soldado: UnitProfile = {
  id: 'soldado',
  nombre: 'Infantería Táctica',
  faccion: 'La Alianza',
  clase: 'Choque',
  movimiento: 6,
  vidas: 4,
  salvacion: 4,
  velocidad: 3,
  valor: 5,
  especialidad: null,
  radioPeana: 0.63,
  armas: [
    {
      kind: 'disparo',
      nombre: 'Fusil de Batalla',
      ataques: 2,
      distancia: 14,
      precision: 4,
      danio: 1,
      danioCritico: 2,
      habilidades: [],
    },
    {
      kind: 'cuerpo_a_cuerpo',
      nombre: 'Cuchillo de combate',
      ataques: 2,
      danio: 1,
      danioCritico: 2,
      habilidades: [],
    },
  ],
};

const unit = (id: string, owner: string, x: number, y: number): Unit => ({
  id,
  profileId: 'soldado',
  owner,
  position: vec(x, y),
  vidas: 4,
  activated: false,
  accionesRestantes: 0,
  accionesUsadas: [],
  trabadaCon: [],
  seMovio: false,
  corrio: false,
});

function makeState(over: Partial<GameState> = {}): GameState {
  return {
    mode: 'Escaramuza',
    turno: 1,
    fase: 'Iniciativa',
    jugadores: ['A', 'B'],
    ordenIniciativa: [],
    jugadorActivo: null,
    unidadActiva: null,
    units: {
      a1: unit('a1', 'A', 0, 0),
      b1: unit('b1', 'B', 10, 0),
    },
    profiles: { soldado },
    terrain: [],
    puestos: [],
    puntos: {}, refuerzoUsado: {}, turnosTotales: 6,
    reserva: [],
    rngState: 12345,
    ...over,
  };
}

describe('Estructura del turno', () => {
  let engine: Engine;
  beforeEach(() => {
    engine = new Engine(makeState());
  });

  it('la Iniciativa fija el orden y pasa a Activaciones', () => {
    const r = engine.execute({ type: 'TirarIniciativa' });
 engine.execute({ type: 'ComenzarActivaciones' });
    expect(r.ok).toBe(true);
    const s = engine.getState();
    expect(s.fase).toBe('Activaciones');
    expect(s.ordenIniciativa).toHaveLength(2);
    expect(s.jugadorActivo).toBe(s.ordenIniciativa[0]);
  });

  it('no se puede activar una unidad del jugador que no tiene el turno', () => {
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    const otro = engine.getState().jugadorActivo === 'A' ? 'b1' : 'a1';
    const r = engine.execute({ type: 'ActivarUnidad', unitId: otro });
    expect(r.ok).toBe(false);
  });

  it('una unidad no puede activarse dos veces en el mismo turno', () => {
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    const first = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    engine.execute({ type: 'ActivarUnidad', unitId: first });
    engine.execute({ type: 'TerminarActivacion', unitId: first });
    // Tras alternar, el otro jugador activa; luego vuelve el turno.
    const r = engine.execute({ type: 'ActivarUnidad', unitId: first });
    expect(r.ok).toBe(false);
  });

  it('los jugadores alternan activaciones', () => {
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    const primero = engine.getState().jugadorActivo!;
    const u1 = primero === 'A' ? 'a1' : 'b1';
    engine.execute({ type: 'ActivarUnidad', unitId: u1 });
    engine.execute({ type: 'TerminarActivacion', unitId: u1 });
    expect(engine.getState().jugadorActivo).not.toBe(primero);
  });
});

describe('Acciones', () => {
  let engine: Engine;
  let activo: string;

  beforeEach(() => {
    engine = new Engine(makeState());
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    activo = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    engine.execute({ type: 'ActivarUnidad', unitId: activo });
  });

  it('cada unidad dispone de 2 acciones', () => {
    expect(engine.getState().units[activo]!.accionesRestantes).toBe(2);
  });

  it('no permite moverse más allá del valor de Movimiento', () => {
    const u = engine.getState().units[activo]!;
    const lejos = vec(u.position.x, u.position.y + 7); // Movimiento 6"
    const r = engine.execute({ type: 'Mover', unitId: activo, destino: lejos });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Movimiento excedido');
  });

  it('Correr permite Movimiento + Velocidad', () => {
    const u = engine.getState().units[activo]!;
    const destino = vec(u.position.x, u.position.y + 9); // 6 + 3
    expect(engine.execute({ type: 'Correr', unitId: activo, destino }).ok).toBe(true);
  });

  it('tras Correr la unidad no puede disparar', () => {
    const u = engine.getState().units[activo]!;
    engine.execute({ type: 'Correr', unitId: activo, destino: vec(u.position.x, u.position.y + 1) });
    const objetivo = activo === 'a1' ? 'b1' : 'a1';
    const r = engine.execute({
      type: 'Disparar',
      unitId: activo,
      targetId: objetivo,
      armaNombre: 'Fusil de Batalla',
    });
    expect(r.ok).toBe(false);
  });

  it('Correr consume las 2 acciones', () => {
    const u = engine.getState().units[activo]!;
    engine.execute({ type: 'Correr', unitId: activo, destino: vec(u.position.x, u.position.y + 1) });
    expect(engine.getState().units[activo]!.accionesRestantes).toBe(0);
  });

  it('no se puede repetir la misma acción en una activación', () => {
    const u = engine.getState().units[activo]!;
    engine.execute({ type: 'Mover', unitId: activo, destino: vec(u.position.x, u.position.y + 1) });
    const r = engine.execute({ type: 'Mover', unitId: activo, destino: vec(u.position.x, u.position.y + 2) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('repetir');
  });

  it('Mover y luego Disparar es legal y no penaliza', () => {
    const objetivo = activo === 'a1' ? 'b1' : 'a1';
    const u = engine.getState().units[activo]!;
    expect(engine.execute({ type: 'Mover', unitId: activo, destino: vec(u.position.x, u.position.y + 1) }).ok).toBe(true);
    expect(
      engine.execute({ type: 'Disparar', unitId: activo, targetId: objetivo, armaNombre: 'Fusil de Batalla' }).ok,
    ).toBe(true);
  });

  it('no se puede terminar el movimiento a 1" o menos de un enemigo', () => {
    // Enemigo a 5": el destino queda dentro del Movimiento de 6", de modo que
    // lo único que puede rechazar la acción es la zona de control de 1".
    const cerca = new Engine(
      makeState({ units: { a1: unit('a1', 'A', 0, 0), b1: unit('b1', 'B', 5, 0) } }),
    );
    cerca.execute({ type: 'TirarIniciativa' });
    cerca.execute({ type: 'ComenzarActivaciones' });
    const u = cerca.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    cerca.execute({ type: 'ActivarUnidad', unitId: u });
    const enemigo = cerca.getState().units[u === 'a1' ? 'b1' : 'a1']!;
    const pegado = vec(enemigo.position.x - 1.5, enemigo.position.y);
    const r = cerca.execute({ type: 'Mover', unitId: u, destino: pegado });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('1"');
  });
});

describe('Disparo', () => {
  it('falla si el objetivo está fuera de alcance', () => {
    const state = makeState({
      units: { a1: unit('a1', 'A', 0, 0), b1: unit('b1', 'B', 40, 0) },
    });
    const engine = new Engine(state);
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    const activo = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    engine.execute({ type: 'ActivarUnidad', unitId: activo });
    const r = engine.execute({
      type: 'Disparar',
      unitId: activo,
      targetId: activo === 'a1' ? 'b1' : 'a1',
      armaNombre: 'Fusil de Batalla',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('alcance');
  });

  it('un muro que bloquea la visión impide disparar', () => {
    const state = makeState({
      terrain: [
        { id: 'muro', rect: { x: 4, y: -5, width: 1, height: 10 }, altura: 3, tipo: 'bloqueo' as const },
      ],
    });
    const engine = new Engine(state);
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    const activo = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    engine.execute({ type: 'ActivarUnidad', unitId: activo });
    const r = engine.execute({
      type: 'Disparar',
      unitId: activo,
      targetId: activo === 'a1' ? 'b1' : 'a1',
      armaNombre: 'Fusil de Batalla',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('línea de visión');
  });
});

describe('Trabado y destrabe', () => {
  const trabadas = () =>
    makeState({
      units: {
        a1: { ...unit('a1', 'A', 0, 0), trabadaCon: ['b1'] },
        b1: { ...unit('b1', 'B', 1.26, 0), trabadaCon: ['a1'] },
      },
    });

  it('una unidad trabada no puede moverse ni disparar', () => {
    const engine = new Engine(trabadas());
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    const activo = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    engine.execute({ type: 'ActivarUnidad', unitId: activo });
    const mover = engine.execute({ type: 'Mover', unitId: activo, destino: vec(0, 5) });
    expect(mover.ok).toBe(false);
    if (!mover.ok) expect(mover.reason).toContain('trabada');
  });

  it('puede Atacar cuerpo a cuerpo a la unidad con la que combate', () => {
    const engine = new Engine(trabadas());
    engine.execute({ type: 'TirarIniciativa' });
    engine.execute({ type: 'ComenzarActivaciones' });
    const activo = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
    engine.execute({ type: 'ActivarUnidad', unitId: activo });
    const r = engine.execute({
      type: 'AtacarCaC',
      unitId: activo,
      targetId: activo === 'a1' ? 'b1' : 'a1',
      armaNombre: 'Cuchillo de combate',
    });
    expect(r.ok).toBe(true);
  });

  it('Destrabarse con 4+ libera; con 1-3 pierde las acciones', () => {
    // Se prueban varias semillas para cubrir los dos desenlaces.
    let hubieronExitos = false;
    let hubieronFallos = false;
    for (let seed = 0; seed < 40; seed++) {
      const engine = new Engine({ ...trabadas(), rngState: seed });
      engine.execute({ type: 'TirarIniciativa' });
      engine.execute({ type: 'ComenzarActivaciones' });
      const activo = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
      engine.execute({ type: 'ActivarUnidad', unitId: activo });
      const r = engine.execute({ type: 'Destrabarse', unitId: activo });
      if (!r.ok) continue;
      const ev = r.events.find((e) => e.type === 'DestrabeResuelto');
      if (ev && ev.type === 'DestrabeResuelto') {
        const u = engine.getState().units[activo]!;
        if (ev.exito) {
          hubieronExitos = true;
          expect(ev.dado).toBeGreaterThanOrEqual(4);
          expect(u.trabadaCon).toHaveLength(0);
        } else {
          hubieronFallos = true;
          expect(ev.dado).toBeLessThanOrEqual(3);
          expect(u.accionesRestantes).toBe(0);
        }
      }
    }
    expect(hubieronExitos).toBe(true);
    expect(hubieronFallos).toBe(true);
  });
});

describe('Determinismo', () => {
  it('la misma semilla reproduce la misma partida', () => {
    const play = () => {
      const engine = new Engine(makeState({ rngState: 777 }));
      engine.execute({ type: 'TirarIniciativa' });
      engine.execute({ type: 'ComenzarActivaciones' });
      const activo = engine.getState().jugadorActivo === 'A' ? 'a1' : 'b1';
      engine.execute({ type: 'ActivarUnidad', unitId: activo });
      engine.execute({
        type: 'Disparar',
        unitId: activo,
        targetId: activo === 'a1' ? 'b1' : 'a1',
        armaNombre: 'Fusil de Batalla',
      });
      return JSON.stringify(engine.getLog());
    };
    expect(play()).toBe(play());
  });
});
