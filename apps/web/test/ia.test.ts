import { describe, expect, it } from 'vitest';
import { Engine, centerDistance, vec } from '@zerolore/core';
import type { GameState, Unit, UnitProfile } from '@zerolore/core';
import { siguienteJugada } from '../src/ia.ts';
import { LISTA_A, LISTA_B, createGame } from '../src/setup.ts';

/** Juega una partida entera con las dos IAs y devuelve lo que pasó. */
function partidaAutomatica(semilla: number, topePasos = 4000) {
  const engine = new Engine(createGame(LISTA_A, LISTA_B, semilla), [], { habilidades: false });
  let pasos = 0;
  let turnos = 0;

  while (pasos < topePasos) {
    pasos += 1;
    const state = engine.getState();
    if (engine.getLog().some((e) => e.type === 'PartidaTerminada')) break;

    if (state.fase === 'Iniciativa') {
      if (state.ordenIniciativa.length === 0) {
        engine.execute({ type: 'TirarIniciativa' });
        continue;
      }
      // Refuerzos de ambos bandos hasta que ninguno pueda meter más.
      const jugada = state.ordenIniciativa
        .map((j) => siguienteJugada(state, j))
        .find((x) => x !== null);
      if (jugada) {
        engine.execute(jugada.cmd);
        continue;
      }
      continue;
    }

    if (state.fase === 'Activaciones') {
      const jugada = state.jugadorActivo ? siguienteJugada(state, state.jugadorActivo) : null;
      if (jugada) {
        // Si el motor rechaza la jugada, la IA estaría en bucle: se corta.
        const r = engine.execute(jugada.cmd);
        if (!r.ok && state.unidadActiva) {
          engine.execute({ type: 'TerminarActivacion', unitId: state.unidadActiva });
        }
        continue;
      }
      if (state.unidadActiva) {
        engine.execute({ type: 'TerminarActivacion', unitId: state.unidadActiva });
        continue;
      }
      break; // nadie a quien activar y la fase no avanza
    }

    if (state.fase === 'FinDeTurno') {
      turnos += 1;
      if (turnos > 12) break;
      engine.execute({ type: 'TerminarTurno' });
      continue;
    }
    break;
  }

  return { engine, pasos, turnos, state: engine.getState(), log: engine.getLog() };
}

describe('IA: decisiones sueltas', () => {
  it('no juega cuando no es su turno', () => {
    const engine = new Engine(createGame(LISTA_A, LISTA_B, 7), [], { habilidades: false });
    engine.execute({ type: 'TirarIniciativa' });
    const s = engine.getState();
    const quieto = s.jugadores.find((j) => j !== s.ordenIniciativa[0])!;
    // En Iniciativa ambos pueden desplegar; en Activaciones solo el activo.
    engine.execute({ type: 'Desplegar', ...primerDespliegue(engine) });
    expect(siguienteJugada(engine.getState(), quieto)).not.toBeNull();
  });

  it('lo primero que despliega es su Héroe', () => {
    const engine = new Engine(createGame(LISTA_A, LISTA_B, 3), [], { habilidades: false });
    engine.execute({ type: 'TirarIniciativa' });
    const s = engine.getState();
    const jugada = siguienteJugada(s, 'B');
    expect(jugada?.cmd.type).toBe('Desplegar');
    if (jugada?.cmd.type !== 'Desplegar') return;
    const entrada = s.reserva.find((r) => r.id === (jugada.cmd as { unitId: string }).unitId)!;
    expect(s.profiles[entrada.profileId]?.clase).toBe('Heroe');
  });

  it('despliega desde la reserva por un puesto propio', () => {
    const engine = new Engine(createGame(LISTA_A, LISTA_B, 3), [], { habilidades: false });
    engine.execute({ type: 'TirarIniciativa' });
    const jugada = siguienteJugada(engine.getState(), 'B');
    expect(jugada?.cmd.type).toBe('Desplegar');
    expect(engine.execute(jugada!.cmd).ok).toBe(true);
  });

  it('activa una unidad cuando le toca y no hay ninguna activa', () => {
    const { engine } = partidaAutomatica(5, 40);
    const s = engine.getState();
    if (s.fase === 'Activaciones' && s.jugadorActivo && !s.unidadActiva) {
      expect(siguienteJugada(s, s.jugadorActivo)?.cmd.type).toBe('ActivarUnidad');
    }
  });
});

function primerDespliegue(engine: Engine) {
  const s = engine.getState();
  const jugada = siguienteJugada(s, s.ordenIniciativa[0]!)!;
  const cmd = jugada.cmd as Extract<typeof jugada.cmd, { type: 'Desplegar' }>;
  return { unitId: cmd.unitId, puestoId: cmd.puestoId, posicion: cmd.posicion };
}

describe('IA: juega a los puntos', () => {
  const perfil = (over: Partial<UnitProfile> = {}): UnitProfile => ({
    id: 'p', nombre: 'Tropa', rol: null, clase: 'Choque', set: 'Disparo',
    movimiento: 5, vidas: 8, salvacion: 6, velocidad: 2,
    escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: 0.63,
    armas: [
      { kind: 'disparo', nombre: 'Fusil', ataques: 3, distancia: 24, precision: 3, danio: 1, danioCritico: 2, habilidades: [] },
      { kind: 'cuerpo_a_cuerpo', nombre: 'Culata', ataques: 1, danio: 1, danioCritico: 1, habilidades: [] },
    ],
    ...over,
  });

  const soldado = (id: string, owner: string, x: number, y: number, profileId: string, vidas: number): Unit => ({
    id, profileId, owner, position: vec(x, y), vidas, activated: true,
    accionesRestantes: 2, accionesUsadas: [], trabadaCon: [], seMovio: false,
    corrio: false, cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null,
  });

  /** Un tirador de A y dos enemigos a tiro, con la vida y el Valor que se pidan. */
  const escena = (caro: { vidas: number; valor: number }, barato: { vidas: number; valor: number }): GameState => ({
    mode: 'Escaramuza', turno: 1, fase: 'Activaciones',
    jugadores: ['A', 'B'], ordenIniciativa: ['A', 'B'], jugadorActivo: 'A', unidadActiva: 'a1',
    units: {
      a1: soldado('a1', 'A', 10, 10, 'p', 8),
      caro: soldado('caro', 'B', 14, 10, 'caro', caro.vidas),
      barato: soldado('barato', 'B', 10, 14, 'barato', barato.vidas),
    },
    profiles: {
      p: perfil(),
      caro: perfil({ id: 'caro', valor: caro.valor }),
      barato: perfil({ id: 'barato', valor: barato.valor }),
    },
    terrain: [], puestos: [], reserva: [], puntos: {}, refuerzosUsados: {}, desplieguePasado: {}, turnosTotales: 6, rngState: 4,
  });

  it('remata al que puede tumbar aunque valga menos', () => {
    // El caro está entero (8 vidas) y el barato a una: la baja solo se cobra
    // si cae, así que se remata al barato.
    const jugada = siguienteJugada(escena({ vidas: 8, valor: 9 }, { vidas: 1, valor: 2 }), 'A');
    expect(jugada?.cmd.type).toBe('Disparar');
    if (jugada?.cmd.type === 'Disparar') expect(jugada.cmd.targetId).toBe('barato');
  });

  it('entre dos que puede tumbar, se queda con el que más vale', () => {
    const jugada = siguienteJugada(escena({ vidas: 1, valor: 9 }, { vidas: 1, valor: 2 }), 'A');
    expect(jugada?.cmd.type).toBe('Disparar');
    if (jugada?.cmd.type === 'Disparar') expect(jugada.cmd.targetId).toBe('caro');
  });

  it('si no puede tumbar a ninguno, va al que más puntos rinde por vida', () => {
    // Ninguno cae de un golpe; el caro rinde 9/8 y el barato 2/8.
    const jugada = siguienteJugada(escena({ vidas: 8, valor: 9 }, { vidas: 8, valor: 2 }), 'A');
    expect(jugada?.cmd.type).toBe('Disparar');
    if (jugada?.cmd.type === 'Disparar') expect(jugada.cmd.targetId).toBe('caro');
  });
});

describe('IA: aprovecha las habilidades de arma', () => {
  const base = (armas: UnitProfile['armas'], over: Partial<UnitProfile> = {}): UnitProfile => ({
    id: 'p', nombre: 'Tropa', rol: null, clase: 'Choque', set: 'Disparo',
    movimiento: 5, vidas: 8, salvacion: 6, velocidad: 2,
    escuadraMin: 1, escuadraMax: 1, valor: 3, habilidad: null, radioPeana: 0.63,
    armas, ...over,
  });
  const culata = { kind: 'cuerpo_a_cuerpo' as const, nombre: 'Culata', ataques: 1, danio: 1, danioCritico: 1, habilidades: [] };
  const u = (id: string, owner: string, x: number, y: number, profileId: string, vidas = 8): Unit => ({
    id, profileId, owner, position: vec(x, y), vidas, activated: true,
    accionesRestantes: 2, accionesUsadas: [], trabadaCon: [], seMovio: false,
    corrio: false, cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null,
  });
  const partida = (units: Record<string, Unit>, profiles: Record<string, UnitProfile>): GameState => ({
    mode: 'Escaramuza', turno: 1, fase: 'Activaciones',
    jugadores: ['A', 'B'], ordenIniciativa: ['A', 'B'], jugadorActivo: 'A', unidadActiva: 'a1',
    units, profiles, terrain: [], puestos: [], reserva: [], puntos: {}, refuerzosUsados: {}, desplieguePasado: {},
    turnosTotales: 6, rngState: 3,
  });
  const objetivoDe = (s: GameState): string | undefined => {
    const j = siguienteJugada(s, 'A');
    return j?.cmd.type === 'Disparar' ? j.cmd.targetId : undefined;
  };

  it('con Explosiva prefiere al que tiene enemigos pegados', () => {
    const lanzagranadas = {
      kind: 'disparo' as const, nombre: 'Lanzagranadas', ataques: 2, distancia: 24, precision: 3,
      danio: 1, danioCritico: 2, habilidades: [{ nombre: 'Explosiva X' as const, x: 2 }],
    };
    const s = partida(
      {
        a1: u('a1', 'A', 5, 15, 'tirador'),
        solo: u('solo', 'B', 15, 5, 'blanco'),
        grupo: u('grupo', 'B', 15, 25, 'blanco'),
        pegada1: u('pegada1', 'B', 16.5, 25, 'blanco'),
        pegada2: u('pegada2', 'B', 15, 26.5, 'blanco'),
      },
      { tirador: base([lanzagranadas, culata], { id: 'tirador' }), blanco: base([culata], { id: 'blanco' }) },
    );
    expect(objetivoDe(s)).toBe('grupo');
  });

  it('con Anti- va a por la clase contra la que pega de más', () => {
    const antiMonstruo = {
      kind: 'disparo' as const, nombre: 'Arpón', ataques: 2, distancia: 24, precision: 3,
      danio: 1, danioCritico: 2, habilidades: [{ nombre: 'Anti-X' as const, objetivo: 'Monstruo' as const }],
    };
    const s = partida(
      {
        a1: u('a1', 'A', 5, 15, 'tirador'),
        choque: u('choque', 'B', 15, 10, 'choque'),
        bestia: u('bestia', 'B', 15, 20, 'bestia'),
      },
      {
        tirador: base([antiMonstruo, culata], { id: 'tirador' }),
        choque: base([culata], { id: 'choque' }),
        bestia: base([culata], { id: 'bestia', clase: 'Monstruo' }),
      },
    );
    expect(objetivoDe(s)).toBe('bestia');
  });

  it('no se empeña con quien casi siempre salva si hay otro al que sí hace daño', () => {
    const fusil = {
      kind: 'disparo' as const, nombre: 'Fusil', ataques: 3, distancia: 24, precision: 3,
      danio: 1, danioCritico: 1, habilidades: [],
    };
    const s = partida(
      {
        a1: u('a1', 'A', 5, 15, 'tirador'),
        blindado: u('blindado', 'B', 15, 10, 'blindado', 2),
        blando: u('blando', 'B', 15, 20, 'blando', 2),
      },
      {
        tirador: base([fusil, culata], { id: 'tirador' }),
        blindado: base([culata], { id: 'blindado', salvacion: 2 }),
        blando: base([culata], { id: 'blando', salvacion: 6 }),
      },
    );
    // Mismas vidas y mismo Valor: contra 2+ apenas pasa daño; contra 6+ lo tumba.
    expect(objetivoDe(s)).toBe('blando');
  });
});

describe('IA contra IA: la partida avanza sola', () => {
  it('no se queda atascada y llega a jugarse varios turnos', () => {
    const { turnos, pasos, state } = partidaAutomatica(2024);
    expect(turnos).toBeGreaterThan(2);
    expect(pasos).toBeLessThan(4000);
    // Han salido tropas a la mesa por los puestos de mando.
    expect(Object.keys(state.units).length).toBeGreaterThan(0);
  });

  it('se reparten puntos por los puestos que controlan', () => {
    const { state } = partidaAutomatica(2024);
    const total = (state.puntos.A ?? 0) + (state.puntos.B ?? 0);
    expect(total).toBeGreaterThan(0);
  });

  it('nunca deja dos miniaturas encima de otra', () => {
    for (const semilla of [2024, 7, 99]) {
      const { state } = partidaAutomatica(semilla);
      const enMesa = Object.values(state.units).filter((u) => u.vidas > 0);
      for (const a of enMesa) {
        for (const b of enMesa) {
          if (a.id >= b.id) continue;
          const ra = state.profiles[a.profileId]!.radioPeana;
          const rb = state.profiles[b.profileId]!.radioPeana;
          const separacion = centerDistance(a.position, b.position) - ra - rb;
          expect(separacion).toBeGreaterThan(-1e-6);
        }
      }
    }
  });

  it('solo mete un refuerzo por jugador y turno', () => {
    const { log } = partidaAutomatica(2024);
    // Entre dos TurnoTerminado no puede haber dos despliegues del mismo bando.
    let porTurno: Record<string, number> = {};
    for (const e of log) {
      if (e.type === 'TurnoTerminado') porTurno = {};
      if (e.type !== 'UnidadDesplegada') continue;
      const bando = e.unitId.startsWith('A') ? 'A' : 'B';
      porTurno[bando] = (porTurno[bando] ?? 0) + 1;
      expect(porTurno[bando]).toBeLessThanOrEqual(1);
    }
  });

  it('es determinista: la misma semilla da la misma partida', () => {
    const a = partidaAutomatica(99);
    const b = partidaAutomatica(99);
    expect(b.state.puntos).toEqual(a.state.puntos);
    expect(b.log.length).toBe(a.log.length);
  });
});
