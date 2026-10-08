import { describe, expect, it } from 'vitest';
import {
  Engine,
  controlTrasTurno,
  puedeDesplegarEn,
  unidadOcupa,
  valorEnPuesto,
  vec,
} from '@zerolore/core';
import type { GameState, Puesto, Unit, UnitProfile } from '@zerolore/core';

const perfil = (over: Partial<UnitProfile> = {}): UnitProfile => ({
  id: 'p', nombre: 'Tropa', rol: null, clase: 'Choque', set: 'Disparo',
  movimiento: 5, vidas: 8, salvacion: 4, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: 0.63,
  armas: [
    { kind: 'disparo', nombre: 'A distancia', ataques: 2, distancia: 24, precision: 4, danio: 1, danioCritico: 2, habilidades: [] },
    { kind: 'cuerpo_a_cuerpo', nombre: 'Cuerpo a cuerpo', ataques: 1, danio: 1, danioCritico: 1, habilidades: [] },
  ],
  ...over,
});

const unit = (id: string, owner: string, x: number, y: number, profileId = 'p'): Unit => ({
  id, profileId, owner, position: vec(x, y), vidas: 8, activated: false,
  accionesRestantes: 2, accionesUsadas: [], trabadaCon: [], seMovio: false,
  corrio: false, cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null,
});

const puesto = (over: Partial<Puesto> = {}): Puesto => ({
  id: 'cg-a', centro: vec(10, 10), radio: 1.5, esCuartelGeneral: true, duenio: 'A', ...over,
});

const estado = (over: Partial<GameState> = {}): GameState => ({
  mode: 'Escaramuza', turno: 1, fase: 'Despliegue',
  jugadores: ['A', 'B'], ordenIniciativa: ['A', 'B'], jugadorActivo: 'A', unidadActiva: null,
  units: {}, profiles: { p: perfil() }, terrain: [], puestos: [puesto()], reserva: [], puntos: {}, refuerzosUsados: {}, desplieguePasado: {}, turnosTotales: 6,
  rngState: 7, ...over,
});

describe('Ocupar un puesto de mando', () => {
  it('con el centro de la peana dentro, la ocupa', () => {
    expect(unidadOcupa(puesto(), unit('a1', 'A', 10, 10), perfil())).toBe(true);
  });

  it('rozando el borde por fuera, no', () => {
    // Peana tangente al token: solape cero.
    expect(unidadOcupa(puesto(), unit('a1', 'A', 10, 12.13), perfil())).toBe(false);
  });

  it('el corte está en media peana, no en el centro', () => {
    // Justo sobre el borde del token: algo menos de media peana dentro.
    expect(unidadOcupa(puesto(), unit('a1', 'A', 10, 11.5), perfil())).toBe(false);
    // Un poco más adentro ya pasa de la mitad.
    expect(unidadOcupa(puesto(), unit('a1', 'A', 10, 11.3), perfil())).toBe(true);
  });

  it('una unidad destruida no ocupa nada', () => {
    const muerta = { ...unit('a1', 'A', 10, 10), vidas: 0 };
    expect(unidadOcupa(puesto(), muerta, perfil())).toBe(false);
  });
});

describe('Control de un puesto al final del turno', () => {
  it('gana quien suma más Valor', () => {
    const s = estado({
      units: {
        a1: unit('a1', 'A', 10, 10),
        b1: unit('b1', 'B', 10.4, 10),
        b2: unit('b2', 'B', 9.6, 10),
      },
      puestos: [puesto({ duenio: 'A' })],
    });
    expect(valorEnPuesto(s, s.puestos[0]!, 'A')).toBe(2);
    expect(valorEnPuesto(s, s.puestos[0]!, 'B')).toBe(4);
    expect(controlTrasTurno(s, s.puestos[0]!)).toBe('B');
  });

  it('en empate se queda quien lo tuviera', () => {
    const s = estado({
      units: { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10.4, 10) },
      puestos: [puesto({ duenio: 'A' })],
    });
    expect(controlTrasTurno(s, s.puestos[0]!)).toBe('A');
  });

  it('un puesto vacío no cambia de manos', () => {
    const s = estado({ puestos: [puesto({ duenio: 'B' })] });
    expect(controlTrasTurno(s, s.puestos[0]!)).toBe('B');
  });

  it('los Vehículos ocupan pero no aportan Valor', () => {
    const s = estado({
      profiles: { p: perfil(), v: perfil({ id: 'v', clase: 'Vehiculo', valor: 10 }) },
      units: { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10.4, 10, 'v') },
      puestos: [puesto({ duenio: 'A' })],
    });
    expect(valorEnPuesto(s, s.puestos[0]!, 'B')).toBe(0);
    expect(controlTrasTurno(s, s.puestos[0]!)).toBe('A');
  });

  it('las unidades trabadas en CaC no cuentan', () => {
    const trabada = (u: Unit, con: string): Unit => ({ ...u, trabadaCon: [con] });
    const s = estado({
      units: {
        a1: trabada(unit('a1', 'A', 10, 10), 'b1'),
        b1: trabada(unit('b1', 'B', 10.4, 10), 'a1'),
        b2: unit('b2', 'B', 9.6, 10),
      },
      puestos: [puesto({ duenio: 'A' })],
    });
    expect(valorEnPuesto(s, s.puestos[0]!, 'A')).toBe(0);
    expect(valorEnPuesto(s, s.puestos[0]!, 'B')).toBe(2);
    expect(controlTrasTurno(s, s.puestos[0]!)).toBe('B');
  });
});

describe('Desplegar desde la Reserva', () => {
  const conReserva = (over: Partial<GameState> = {}) =>
    new Engine(
      estado({ reserva: [{ id: 'a2', profileId: 'p', owner: 'A' }], ...over }),
      [],
      { habilidades: false },
    );

  it('entra dentro de un puesto propio', () => {
    const e = conReserva();
    const r = e.execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10.8) });
    expect(r.ok).toBe(true);
    expect(e.getState().units.a2?.position.y).toBeCloseTo(10.8, 2);
    expect(e.getState().reserva).toHaveLength(0);
  });

  it('la peana no puede sobresalir del puesto', () => {
    // Pegada por fuera: antes valía, ahora no.
    const fuera = conReserva().execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 12.1) });
    expect(fuera.ok).toBe(false);
    if (!fuera.ok) expect(fuera.reason).toContain('entera dentro');
    // Asomando por el borde: tampoco.
    const asomando = conReserva().execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 11) });
    expect(asomando.ok).toBe(false);
  });

  it('no se puede desplegar en un puesto que no controlas', () => {
    const r = conReserva({ puestos: [puesto({ duenio: 'B' })] })
      .execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10.8) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('control');
  });

  it('con enemigos ocupando el puesto, no entran refuerzos', () => {
    const r = conReserva({ units: { b1: unit('b1', 'B', 10, 10) } })
      .execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10.8) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('enemigos');
  });

  it('en partida no se despliega con una unidad a medias', () => {
    const r = conReserva({ fase: 'Activaciones', unidadActiva: 'a1' })
      .execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10.8) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Termina la activación');
  });

  it('no se despliega encima de la escenografía', () => {
    const r = conReserva({
      terrain: [{ id: 'muro', rect: { x: 9, y: 10.5, width: 3, height: 1 }, altura: 2, tipo: 'cobertura' }],
    }).execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10.8) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('muro');
  });
});

describe('Refuerzos: uno por puesto controlado y turno', () => {
  const conReserva = () =>
    new Engine(
      estado({
        units: { a1: unit('a1', 'A', 20, 20), b1: unit('b1', 'B', 30, 20) },
        reserva: [{ id: 'a2', profileId: 'p', owner: 'A' }],
      }),
      [],
      { habilidades: false },
    );

  /** Deja la partida en Activaciones con A de vez y su reserva intacta. */
  const enPartida = (): Engine => {
    const e = conReserva();
    e.execute({ type: 'TirarIniciativa' });
    // Con reserva pendiente la tirada abre el despliegue inicial; se pasa.
    while (e.getState().fase === 'Despliegue') {
      e.execute({ type: 'PasarDespliegue', jugador: e.getState().jugadorActivo! });
    }
    return e;
  };

  it('con reserva, la tirada abre el despliegue inicial', () => {
    const e = conReserva();
    e.execute({ type: 'TirarIniciativa' });
    expect(e.getState().fase).toBe('Despliegue');
  });

  it('cuando todos pasan, empieza el turno 1 sin botón', () => {
    const e = enPartida();
    expect(e.getState().fase).toBe('Activaciones');
    expect(e.getState().turno).toBe(1);
  });

  it('en partida se puede meter un refuerzo, y consume la vez', () => {
    const e = enPartida();
    // A controla su Cuartel General: un refuerzo por turno.
    const s = e.getState();
    const antes = s.jugadorActivo;
    expect(antes).toBe('A');
    const r = e.execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10.8) });
    expect(r.ok).toBe(true);
    expect(e.getState().refuerzosUsados.A).toBe(1);
    // La vez pasa al rival: desplegar cuenta como jugada.
    expect(e.getState().jugadorActivo).not.toBe(antes);
  });
});

describe('La Iniciativa se tira una sola vez', () => {
  const partida = () =>
    new Engine(
      estado({
        fase: 'Despliegue',
        ordenIniciativa: [],
        jugadorActivo: null,
        units: { a1: unit('a1', 'A', 20, 20), b1: unit('b1', 'B', 30, 20) },
      }),
      [],
      { habilidades: false },
    );

  it('no se puede tirar Iniciativa dos veces', () => {
    const e = partida();
    expect(e.execute({ type: 'TirarIniciativa' }).ok).toBe(true);
    const otra = e.execute({ type: 'TirarIniciativa' });
    expect(otra.ok).toBe(false);
    if (!otra.ok) expect(otra.reason).toContain('ya está tirada');
  });

  it('el turno siguiente arranca solo y lo abre el otro jugador', () => {
    const e = partida();
    e.execute({ type: 'TirarIniciativa' });
    const orden1 = [...e.getState().ordenIniciativa];
    for (const id of ['a1', 'b1']) {
      e.execute({ type: 'ActivarUnidad', unitId: id });
      e.execute({ type: 'TerminarActivacion', unitId: id });
    }
    expect(e.getState().fase).toBe('FinDeTurno');
    e.execute({ type: 'TerminarTurno' });

    const s = e.getState();
    expect(s.turno).toBe(2);
    // Ni fase de Iniciativa ni tirada nueva: se sigue jugando directamente.
    expect(s.fase).toBe('Activaciones');
    expect(s.jugadorActivo).not.toBeNull();
    // Lo que se alterna es quién abre: el orden rota.
    expect(s.ordenIniciativa[0]).toBe(orden1[1]);
    expect(s.jugadorActivo).toBe(orden1[1]);
    expect(e.execute({ type: 'TirarIniciativa' }).ok).toBe(false);
  });
});

describe('Puntuación por puestos controlados', () => {
  it('cada puesto controlado suma 5 al cerrar el turno', () => {
    const e = new Engine(
      estado({
        fase: 'Despliegue',
        ordenIniciativa: [],
        jugadorActivo: null,
        // A ocupa su puesto; B está lejos y no controla nada.
        units: { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 30, 25) },
        puestos: [puesto({ duenio: 'A' }), puesto({ id: 'norte', centro: vec(30, 5), duenio: 'B' })],
      }),
      [],
      { habilidades: false },
    );
    e.execute({ type: 'TirarIniciativa' });
    for (const id of ['a1', 'b1']) {
      e.execute({ type: 'ActivarUnidad', unitId: id });
      e.execute({ type: 'TerminarActivacion', unitId: id });
    }
    e.execute({ type: 'TerminarTurno' });

    // Un puesto cada uno: 5 y 5.
    expect(e.getState().puntos.A).toBe(5);
    expect(e.getState().puntos.B).toBe(5);
  });
});

describe('Reforzar un puesto que ya ocupas', () => {
  it('cabe una segunda unidad propia dentro del puesto', () => {
    const e = new Engine(
      estado({
        units: { a1: unit('a1', 'A', 10, 10.8) },
        reserva: [{ id: 'a2', profileId: 'p', owner: 'A' }],
        puestos: [puesto({ duenio: 'A' })],
      }),
      [],
      { habilidades: false },
    );
    const r = e.execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 9.2) });
    expect(r.ok).toBe(true);
  });

  it('pero no encima de la que ya está', () => {
    const e = new Engine(
      estado({
        units: { a1: unit('a1', 'A', 10, 10) },
        reserva: [{ id: 'a2', profileId: 'p', owner: 'A' }],
        puestos: [puesto({ duenio: 'A' })],
      }),
      [],
      { habilidades: false },
    );
    const r = e.execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10.3) });
    expect(r.ok).toBe(false);
  });
});

describe('Guerra Total: cómo se gana', () => {
  /** Activa por orden hasta que la fase se cierre, y pasa de turno. */
  const cerrarTurno = (e: Engine): void => {
    e.execute({ type: 'TirarIniciativa' });
    for (let paso = 0; paso < 20 && e.getState().fase === 'Activaciones'; paso += 1) {
      const s = e.getState();
      const toca = Object.values(s.units).find(
        (u) => u.owner === s.jugadorActivo && u.vidas > 0 && !u.activated,
      );
      if (!toca) break;
      e.execute({ type: 'ActivarUnidad', unitId: toca.id });
      e.execute({ type: 'TerminarActivacion', unitId: toca.id });
    }
    e.execute({ type: 'TerminarTurno' });
  };

  it('tomar el Cuartel General enemigo gana en el acto', () => {
    const e = new Engine(
      estado({
        fase: 'Despliegue', ordenIniciativa: [], jugadorActivo: null,
        // A tiene dos unidades dentro del CG de B; B no lo defiende.
        units: {
          // A ocupa el CG de B; b1 anda lejos y no defiende nada.
          a1: unit('a1', 'A', 30, 30), b1: unit('b1', 'B', 20, 20),
        },
        puestos: [
          puesto({ id: 'cg-a', centro: vec(5, 5), duenio: 'A' }),
          puesto({ id: 'cg-b', centro: vec(30, 30), duenio: 'B' }),
        ],
      }),
      [], { habilidades: false },
    );
    cerrarTurno(e);
    const fin = e.getLog().find((ev) => ev.type === 'PartidaTerminada');
    expect(fin).toBeDefined();
    if (fin?.type === 'PartidaTerminada') expect(fin.ganador).toBe('A');
  });

  it('al agotarse los turnos gana quien más puntos lleva', () => {
    const e = new Engine(
      estado({
        fase: 'Despliegue', ordenIniciativa: [], jugadorActivo: null,
        turnosTotales: 1,
        units: { a1: unit('a1', 'A', 5, 5), b1: unit('b1', 'B', 30, 30) },
        // A controla dos puestos y B solo el suyo: 10 a 5.
        puestos: [
          puesto({ id: 'cg-a', centro: vec(5, 5), duenio: 'A' }),
          puesto({ id: 'cg-b', centro: vec(30, 30), duenio: 'B' }),
          puesto({ id: 'norte', centro: vec(5, 20), esCuartelGeneral: false, duenio: 'A' }),
        ],
      }),
      [], { habilidades: false },
    );
    cerrarTurno(e);
    expect(e.getState().puntos.A).toBe(10);
    expect(e.getState().puntos.B).toBe(5);
    const fin = e.getLog().find((ev) => ev.type === 'PartidaTerminada');
    if (fin?.type === 'PartidaTerminada') expect(fin.ganador).toBe('A');
  });
});

describe('El Héroe despliega el primero', () => {
  const conHeroe = () =>
    new Engine(
      estado({
        profiles: { p: perfil(), h: perfil({ id: 'h', clase: 'Heroe', valor: 15 }) },
        reserva: [
          { id: 'a1', profileId: 'p', owner: 'A' },
          { id: 'a2', profileId: 'h', owner: 'A' },
        ],
      }),
      [],
      { habilidades: false },
    );

  it('mientras el Héroe esté en reserva no sale nadie más', () => {
    const r = conHeroe().execute({ type: 'Desplegar', unitId: 'a1', puestoId: 'cg-a', posicion: vec(10, 10) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Héroe');
  });

  it('el Héroe sí puede salir', () => {
    const r = conHeroe().execute({ type: 'Desplegar', unitId: 'a2', puestoId: 'cg-a', posicion: vec(10, 10) });
    expect(r.ok).toBe(true);
  });

  it('un ejército sin Héroe en reserva despliega en cualquier orden', () => {
    const e = new Engine(
      estado({ reserva: [{ id: 'a1', profileId: 'p', owner: 'A' }] }),
      [], { habilidades: false },
    );
    expect(e.execute({ type: 'Desplegar', unitId: 'a1', puestoId: 'cg-a', posicion: vec(10, 10) }).ok).toBe(true);
  });
});
