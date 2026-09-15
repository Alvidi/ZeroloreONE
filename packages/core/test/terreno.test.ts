import { describe, expect, it } from 'vitest';
import { Engine, coberturasDeTiro, hasCover, lineOfSight, vec } from '@zerolore/core';
import type { GameState, Terrain, TipoTerreno, Unit, UnitProfile } from '@zerolore/core';

const perfil: UnitProfile = {
  id: 'p', nombre: 'Tirador', rol: null, clase: 'Choque', set: 'Disparo',
  movimiento: 5, vidas: 8, salvacion: 4, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: 0.63,
  armas: [
    { kind: 'disparo', nombre: 'A distancia', ataques: 4, distancia: 24, precision: 4, danio: 1, danioCritico: 2, habilidades: [] },
    { kind: 'cuerpo_a_cuerpo', nombre: 'Cuerpo a cuerpo', ataques: 1, danio: 1, danioCritico: 1, habilidades: [] },
  ],
};

const unit = (id: string, owner: string, x: number, y: number): Unit => ({
  id, profileId: 'p', owner, position: vec(x, y), vidas: 8,
  activated: false, accionesRestantes: 2, accionesUsadas: [], trabadaCon: [],
  seMovio: false, corrio: false, cargo: false, destruidaEnTurno: null,
  ataqueGratuitoContra: null,
});

const estado = (terrain: Terrain[], units: Record<string, Unit>): GameState => ({
  mode: 'Escaramuza', turno: 1, fase: 'Activaciones',
  jugadores: ['A', 'B'], ordenIniciativa: ['A', 'B'], jugadorActivo: 'A',
  unidadActiva: 'a1', units, profiles: { p: perfil }, terrain, puestos: [], reserva: [], puntos: {}, refuerzoUsado: {}, turnosTotales: 6, rngState: 5,
});

const muro = (tipo: TipoTerreno): Terrain => ({
  id: 'muro', rect: { x: 8, y: 14, width: 8, height: 1 }, altura: 2, tipo,
});

describe('Terreno: línea de visión', () => {
  it('un edificio entre medias impide ver al objetivo', () => {
    const s = estado([{ id: 'ed', rect: { x: 8, y: 12, width: 6, height: 6 }, altura: 4, tipo: 'bloqueo' as const }],
      { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 24) });
    expect(lineOfSight(s, s.units.a1!, perfil, s.units.b1!, perfil).visible).toBe(false);
  });

  it('si el edificio queda a un lado, sí se ve', () => {
    const s = estado([{ id: 'ed', rect: { x: 20, y: 12, width: 6, height: 6 }, altura: 4, tipo: 'bloqueo' as const }],
      { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 24) });
    expect(lineOfSight(s, s.units.a1!, perfil, s.units.b1!, perfil).visible).toBe(true);
  });

  it('el motor rechaza el disparo sin línea de visión', () => {
    const e = new Engine(
      estado([{ id: 'ed', rect: { x: 8, y: 12, width: 6, height: 6 }, altura: 4, tipo: 'bloqueo' as const }],
        { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 24) }),
      [], { habilidades: false },
    );
    const r = e.execute({ type: 'Disparar', unitId: 'a1', targetId: 'b1', armaNombre: 'A distancia' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('línea de visión');
  });
});

describe('Terreno: coberturas', () => {
  /** Pegada al murete, con el tirador al otro lado. */
  const pegada = () =>
    estado([muro('cobertura')], {
      a1: unit('a1', 'A', 11, 6),
      // El borde de la peana toca el borde inferior del murete (y = 15).
      b1: unit('b1', 'B', 11, 15.63),
    });

  it('en contacto con el murete y con el tiro atravesándolo, hay cobertura', () => {
    const s = pegada();
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(true);
  });

  it('la cobertura mejora en 1 la Salvación del defensor', () => {
    const e = new Engine(pegada(), [], { habilidades: false });
    const r = e.execute({ type: 'Disparar', unitId: 'a1', targetId: 'b1', armaNombre: 'A distancia' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ev = r.events.find((x) => x.type === 'DisparoResuelto');
      // Salvación impresa 4+, en cobertura pasa a 3+.
      expect(ev?.type === 'DisparoResuelto' && ev.resultado.umbralSalvacion).toBe(3);
    }
  });

  it('sin contacto de peana no hay cobertura, por cerca que esté', () => {
    const s = estado([muro('cobertura')], {
      a1: unit('a1', 'A', 11, 6),
      // A 0.5" del murete: cerca, pero sin tocarlo.
      b1: unit('b1', 'B', 11, 16.2),
    });
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(false);
  });

  it('un elemento demasiado bajo no da cobertura', () => {
    const bajo: Terrain = { id: 'bordillo', rect: { x: 8, y: 14, width: 8, height: 1 }, altura: 0.4, tipo: 'cobertura' };
    const s = estado([bajo], { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 15.63) });
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(false);
  });

  it('Vehículos y Monstruos nunca se benefician de cobertura', () => {
    const vehiculo: UnitProfile = { ...perfil, id: 'v', clase: 'Vehiculo' };
    const s: GameState = {
      ...pegada(),
      profiles: { p: perfil, v: vehiculo },
      units: {
        a1: unit('a1', 'A', 11, 6),
        b1: { ...unit('b1', 'B', 11, 15.63), profileId: 'v' },
      },
    };
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, vehiculo)).toBe(false);
  });
});

describe('Terreno: la cobertura depende de la trayectoria', () => {
  /*
    Murete en y = 14..15. La peana del defensor (r = 0.63) lo toca por abajo.
    El atacante del norte dispara a través del murete; el del sur lo tiene
    detrás del defensor y no le tapa nada.
  */
  const conTirador = (y: number) =>
    estado([muro('cobertura')], { a1: unit('a1', 'A', 11, y), b1: unit('b1', 'B', 11, 15.63) });

  it('disparando desde el lado del murete, hay cobertura', () => {
    const s = conTirador(6);
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(true);
  });

  it('con el murete al otro lado del defensor, NO hay cobertura', () => {
    const s = conTirador(24);
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(false);
  });

  it('un murete pegado de lado, fuera de la trayectoria, no da cobertura', () => {
    const lateral: Terrain = {
      id: 'lateral', rect: { x: 11.63, y: 15, width: 4, height: 1.2 }, altura: 2, tipo: 'cobertura' as const,
    };
    const s = estado([lateral], { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 15.63) });
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(false);
  });

  it('ese mismo murete lateral sí cubre a quien dispara desde el este', () => {
    const lateral: Terrain = {
      id: 'lateral', rect: { x: 11.63, y: 15, width: 4, height: 1.2 }, altura: 2, tipo: 'cobertura' as const,
    };
    const s = estado([lateral], { a1: unit('a1', 'A', 20, 15.6), b1: unit('b1', 'B', 11, 15.63) });
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(true);
  });

  it('coberturasDeTiro nombra el elemento que se aplica', () => {
    const s = conTirador(6);
    expect(coberturasDeTiro(s, s.units.a1!, s.units.b1!, perfil)).toEqual(['muro']);
    const detras = conTirador(24);
    expect(coberturasDeTiro(detras, detras.units.a1!, detras.units.b1!, perfil)).toEqual([]);
  });
});

describe('Terreno: tipos de escenografía', () => {
  const pegadoA = (tipo: TipoTerreno) =>
    estado([muro(tipo)], { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 15.63) });

  it('pegarse a un bloqueo no da cobertura: por ese lado no te ven', () => {
    const s = pegadoA('bloqueo');
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(false);
  });

  it('pegarse a un obstáculo tampoco: el agua no tapa', () => {
    const s = pegadoA('obstaculo');
    expect(hasCover(s, s.units.a1!, perfil, s.units.b1!, perfil)).toBe(false);
  });

  it('un obstáculo en medio no impide disparar', () => {
    const charca: Terrain = {
      id: 'charca', rect: { x: 8, y: 12, width: 8, height: 6 }, altura: 0, tipo: 'obstaculo',
    };
    const s = estado([charca], { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 24) });
    expect(lineOfSight(s, s.units.a1!, perfil, s.units.b1!, perfil).visible).toBe(true);
  });

  it('un bloqueo en medio sí lo impide', () => {
    const s = estado([{ id: 'ed', rect: { x: 8, y: 12, width: 8, height: 6 }, altura: 4, tipo: 'bloqueo' }],
      { a1: unit('a1', 'A', 11, 6), b1: unit('b1', 'B', 11, 24) });
    expect(lineOfSight(s, s.units.a1!, perfil, s.units.b1!, perfil).visible).toBe(false);
  });
});

describe('Terreno: qué se puede atravesar', () => {
  const conElemento = (t: Terrain) =>
    new Engine(estado([t], { a1: unit('a1', 'A', 11, 10), b1: unit('b1', 'B', 40, 28) }), [], {
      habilidades: false,
    });

  const edificio: Terrain = {
    id: 'edificio', rect: { x: 8, y: 12, width: 8, height: 2 }, altura: 4, tipo: 'bloqueo',
  };
  const charca: Terrain = {
    id: 'charca', rect: { x: 8, y: 12, width: 8, height: 2 }, altura: 0, tipo: 'obstaculo',
  };
  const murete: Terrain = {
    id: 'murete', rect: { x: 8, y: 12, width: 8, height: 1 }, altura: 1.6, tipo: 'cobertura',
  };

  it('un bloqueo no se atraviesa: hay que rodearlo, y eso cuesta', () => {
    const r = conElemento(edificio).execute({ type: 'Mover', unitId: 'a1', destino: vec(11, 15) });
    expect(r.ok).toBe(false);
    // Rodear el edificio son casi 11": no le llega el Movimiento.
    if (!r.ok) expect(r.reason).toContain('Movimiento excedido');
  });

  it('si le sobra movimiento, rodea la esquina y llega', () => {
    // Misma pared, pero pegada a su esquina este: rodear cuesta poco.
    const e = new Engine(
      estado([edificio], { a1: unit('a1', 'A', 16.9, 11), b1: unit('b1', 'B', 40, 28) }),
      [], { habilidades: false },
    );
    const r = e.execute({ type: 'Mover', unitId: 'a1', destino: vec(16.9, 15) });
    expect(r.ok).toBe(true);
  });

  it('un obstáculo también: el agua no se cruza aunque se dispare por encima', () => {
    const r = conElemento(charca).execute({ type: 'Mover', unitId: 'a1', destino: vec(11, 15) });
    expect(r.ok).toBe(false);
  });

  it('una cobertura sí se atraviesa', () => {
    const r = conElemento(murete).execute({ type: 'Mover', unitId: 'a1', destino: vec(11, 14) });
    expect(r.ok).toBe(true);
  });

  it('pero no se puede terminar el movimiento encima de ella', () => {
    const r = conElemento(murete).execute({ type: 'Mover', unitId: 'a1', destino: vec(11, 12.5) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('murete');
  });
});

describe('Nada atraviesa lo que bloquea el paso', () => {
  const conMuro = (t: Terrain, ax: number, ay: number, bx: number, by: number) =>
    new Engine(estado([t], { a1: unit('a1', 'A', ax, ay), b1: unit('b1', 'B', bx, by) }), [], {
      habilidades: false,
    });

  const muroAncho: Terrain = {
    id: 'muro', rect: { x: 6, y: 14, width: 12, height: 2 }, altura: 4, tipo: 'bloqueo',
  };

  it('no se puede cargar a través de un muro aunque la distancia dé', () => {
    // 4" en línea recta, pero con el muro justo en medio: rodearlo no llega.
    const e = conMuro(muroAncho, 12, 13, 12, 17);
    const r = e.execute({ type: 'Cargar', unitId: 'a1', targetId: 'b1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/camino|alcance/);
  });

  it('pero sí se puede cargar doblando la esquina si el recorrido cabe', () => {
    // Junto al extremo este del muro (acaba en x = 18): rodearlo cuesta poco.
    const e = conMuro(muroAncho, 18.8, 13.5, 18.8, 16.5);
    expect(e.execute({ type: 'Cargar', unitId: 'a1', targetId: 'b1' }).ok).toBe(true);
  });

  it('rodeando, la misma carga sí sale', () => {
    // Fuera del muro (acaba en x = 18): camino limpio.
    const e = conMuro(muroAncho, 20, 13, 20, 16);
    expect(e.execute({ type: 'Cargar', unitId: 'a1', targetId: 'b1' }).ok).toBe(true);
  });

  it('no se puede terminar el movimiento encima de otra miniatura', () => {
    const e = new Engine(
      estado([], { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 30, 10) }),
      [], { habilidades: false },
    );
    // Sobre una aliada: se coloca una tercera pegada a a1 y se intenta pisarla.
    const s = e.getState();
    const con = new Engine(
      { ...s, units: { ...s.units, a2: unit('a2', 'A', 12, 10) } },
      [], { habilidades: false },
    );
    const r = con.execute({ type: 'Mover', unitId: 'a1', destino: vec(12.2, 10) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('encima de a2');
  });
});
