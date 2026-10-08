import { describe, expect, it } from 'vitest';
import { vec, type GameState, type Unit, type UnitProfile } from '@zerolore/core';
import { accionesDisponibles } from '../src/acciones.ts';

const perfil = (over: Partial<UnitProfile> = {}): UnitProfile => ({
  id: 'p',
  nombre: 'Choque Disparo', rol: null,
  clase: 'Choque',
  set: 'Disparo',
  movimiento: 5,
  vidas: 4,
  salvacion: 5,
  velocidad: 2,
  escuadraMin: 5,
  escuadraMax: 10,
  valor: 2,
  habilidad: null,
  radioPeana: 0.63,
  armas: [
    { kind: 'disparo', nombre: 'Fusil', ataques: 2, distancia: 18, precision: 4, danio: 2, danioCritico: 2, habilidades: [] },
    { kind: 'cuerpo_a_cuerpo', nombre: 'Culatazo', ataques: 1, danio: 1, danioCritico: 1, habilidades: [] },
  ],
  ...over,
});

const unit = (id: string, owner: string, x: number, y: number, over: Partial<Unit> = {}): Unit => ({
  id, profileId: 'p', owner, position: vec(x, y),
  vidas: 4, activated: false, accionesRestantes: 2, accionesUsadas: [],
  trabadaCon: [], seMovio: false, corrio: false, cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null, ...over,
});

const estado = (units: Record<string, Unit>, over: Partial<GameState> = {}): GameState => ({
  mode: 'Escaramuza', turno: 1, fase: 'Activaciones',
  jugadores: ['A', 'B'], ordenIniciativa: ['A', 'B'], jugadorActivo: 'A',
  unidadActiva: 'a1', units, profiles: { p: perfil() }, terrain: [], puestos: [], reserva: [], puntos: {}, refuerzosUsados: {}, desplieguePasado: {}, turnosTotales: 6, rngState: 1, ...over,
});

const buscar = (l: ReturnType<typeof accionesDisponibles>, k: string) => l.find((a) => a.kind === k)!;

describe('Ataque suelto', () => {
  /*
    Peanas de 0,63": entre centros hay que sumar 1,26" a la separación real que
    se quiera entre las dos peanas.
  */
  const aSeparacion = (sep: number): GameState =>
    estado({ a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 10 + sep + 1.26) });

  it('se enciende con un enemigo a 1", sin estar trabada', () => {
    const s = aSeparacion(1);
    expect(buscar(accionesDisponibles(s, s.units.a1, perfil()), 'AtacarCaC').disponible).toBe(true);
  });

  it('sigue apagada con el enemigo a 2"', () => {
    const s = aSeparacion(2);
    const a = buscar(accionesDisponibles(s, s.units.a1, perfil()), 'AtacarCaC');
    expect(a.disponible).toBe(false);
    expect(a.motivo).toContain('1"');
  });

  it('a 1" no obliga a cargar: Mover y Disparar siguen disponibles', () => {
    // El ataque suelto no traba, así que la unidad conserva sus opciones.
    const s = aSeparacion(1);
    const l = accionesDisponibles(s, s.units.a1, perfil());
    expect(buscar(l, 'Mover').disponible).toBe(true);
    expect(buscar(l, 'Disparar').disponible).toBe(true);
  });
});

describe('Acciones disponibles', () => {
  it('devuelve siempre las seis acciones del reglamento', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 30) });
    expect(accionesDisponibles(s, s.units.a1, perfil())).toHaveLength(6);
  });

  it('con enemigo lejos: puede mover y correr, no disparar ni cargar', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 40) });
    const l = accionesDisponibles(s, s.units.a1, perfil());
    expect(buscar(l, 'Mover').disponible).toBe(true);
    expect(buscar(l, 'Correr').disponible).toBe(true);
    expect(buscar(l, 'Disparar').disponible).toBe(false);
    expect(buscar(l, 'Disparar').motivo).toContain('tiro');
    expect(buscar(l, 'Cargar').disponible).toBe(false);
    expect(buscar(l, 'Cargar').motivo).toContain('7"');
  });

  it('con enemigo a tiro puede disparar', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 22) });
    expect(buscar(accionesDisponibles(s, s.units.a1, perfil()), 'Disparar').disponible).toBe(true);
  });

  it('con enemigo dentro del alcance de carga puede cargar', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 15) });
    expect(buscar(accionesDisponibles(s, s.units.a1, perfil()), 'Cargar').disponible).toBe(true);
  });

  it('un muro que corta la visión impide disparar', () => {
    const s = estado(
      { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 22) },
      { terrain: [{ id: 'm', rect: { x: 5, y: 15, width: 10, height: 2 }, altura: 4, tipo: 'bloqueo' as const }] },
    );
    const d = buscar(accionesDisponibles(s, s.units.a1, perfil()), 'Disparar');
    expect(d.disponible).toBe(false);
    expect(d.motivo).toContain('línea de visión');
  });

  it('trabada: solo atacar cuerpo a cuerpo y destrabarse', () => {
    const s = estado({
      a1: unit('a1', 'A', 10, 10, { trabadaCon: ['b1'] }),
      b1: unit('b1', 'B', 11.26, 10, { trabadaCon: ['a1'] }),
    });
    const l = accionesDisponibles(s, s.units.a1, perfil());
    expect(buscar(l, 'AtacarCaC').disponible).toBe(true);
    expect(buscar(l, 'Destrabarse').disponible).toBe(true);
    expect(buscar(l, 'Mover').disponible).toBe(false);
    expect(buscar(l, 'Mover').motivo).toContain('Trabada');
    expect(buscar(l, 'Cargar').disponible).toBe(false);
  });

  it('con 1 acción restante Correr y Cargar se apagan por coste', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10, { accionesRestantes: 1, accionesUsadas: ['Disparar'] }), b1: unit('b1', 'B', 10, 14) });
    const l = accionesDisponibles(s, s.units.a1, perfil());
    expect(buscar(l, 'Mover').disponible).toBe(true);
    expect(buscar(l, 'Correr').disponible).toBe(false);
    expect(buscar(l, 'Correr').motivo).toContain('2 acciones');
    expect(buscar(l, 'Cargar').disponible).toBe(false);
  });

  it('una acción ya usada no se repite', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10, { accionesRestantes: 1, accionesUsadas: ['Mover'] }), b1: unit('b1', 'B', 10, 30) });
    const m = buscar(accionesDisponibles(s, s.units.a1, perfil()), 'Mover');
    expect(m.disponible).toBe(false);
    expect(m.motivo).toContain('Ya usada');
  });

  it('la Artillería no puede moverse ni correr', () => {
    const art = perfil({ clase: 'Artilleria', movimiento: 0, velocidad: 0 });
    const s = estado({ a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 30) }, { profiles: { p: art } });
    const l = accionesDisponibles(s, s.units.a1, art);
    expect(buscar(l, 'Mover').disponible).toBe(false);
    expect(buscar(l, 'Mover').motivo).toContain('Artillería');
  });

  /*
    Ya no hace falta activar a mano: si la unidad PUEDE empezar a jugar, sus
    acciones salen normales y la activación la dispara la primera que ejecutes.
    Lo que se sigue respetando es de quién es el turno y que cada unidad juega
    una sola vez.
  */
  it('una unidad que puede empezar a jugar ya tiene sus acciones', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10) }, { unidadActiva: null });
    expect(buscar(accionesDisponibles(s, s.units.a1, perfil()), 'Mover').disponible).toBe(true);
  });

  it('si le toca al rival, todo apagado y se dice de quién es el turno', () => {
    const s = estado({ a1: unit('a1', 'A', 10, 10) }, { unidadActiva: null, jugadorActivo: 'B' });
    const l = accionesDisponibles(s, s.units.a1, perfil());
    expect(l.every((a) => !a.disponible)).toBe(true);
    expect(l[0]!.motivo).toContain('ROJO');
  });

  it('una unidad que ya jugó este turno no puede volver', () => {
    const s = estado(
      { a1: unit('a1', 'A', 10, 10, { activated: true }) },
      { unidadActiva: null },
    );
    const l = accionesDisponibles(s, s.units.a1, perfil());
    expect(l.every((a) => !a.disponible)).toBe(true);
    expect(l[0]!.motivo).toContain('Ya ha jugado');
  });

  it('con otra unidad a media activación, esta espera', () => {
    const s = estado(
      { a1: unit('a1', 'A', 10, 10), a2: unit('a2', 'A', 14, 10) },
      { unidadActiva: 'a2' },
    );
    expect(accionesDisponibles(s, s.units.a1, perfil()).every((a) => !a.disponible)).toBe(true);
  });

  it('no se puede disparar a una unidad trabada desde fuera del combate', () => {
    const s = estado({
      a1: unit('a1', 'A', 10, 10),
      b1: unit('b1', 'B', 10, 22, { trabadaCon: ['a2'] }),
      a2: unit('a2', 'A', 11.26, 22, { trabadaCon: ['b1'] }),
    });
    expect(buscar(accionesDisponibles(s, s.units.a1, perfil()), 'Disparar').disponible).toBe(false);
  });
});
