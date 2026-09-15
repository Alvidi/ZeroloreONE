import { describe, expect, it } from 'vitest';
import { vec, type Unit, type UnitProfile } from '@zerolore/core';
import { opcionesMovimiento } from '../src/movimiento.ts';

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

const unidad = (over: Partial<Unit> = {}): Unit => ({
  id: 'A1',
  profileId: 'choque_asalto',
  owner: 'A',
  position: vec(10, 10),
  vidas: 4,
  activated: false,
  accionesRestantes: 2,
  accionesUsadas: [],
  trabadaCon: [],
  seMovio: false,
  corrio: false,
  cargo: false, destruidaEnTurno: null, ataqueGratuitoContra: null,
  ...over,
});

describe('Tope de arrastre', () => {
  it('con las 2 acciones intactas el tope es Movimiento + Velocidad', () => {
    const o = opcionesMovimiento(unidad(), perfil, 'A1');
    expect(o.puedeMover).toBe(true);
    expect(o.puedeCorrer).toBe(true);
    expect(o.tope).toBe(7);
  });

  it('tras disparar solo queda 1 acción: el tope baja al Movimiento', () => {
    const o = opcionesMovimiento(
      unidad({ accionesRestantes: 1, accionesUsadas: ['Disparar'] }),
      perfil,
      'A1',
    );
    expect(o.puedeMover).toBe(true);
    expect(o.puedeCorrer).toBe(false);
    expect(o.tope).toBe(5);
  });

  it('si ya se movió no puede volver a moverse: sin arrastre', () => {
    const o = opcionesMovimiento(
      unidad({ accionesRestantes: 1, accionesUsadas: ['Mover'] }),
      perfil,
      'A1',
    );
    expect(o.puedeMover).toBe(false);
    expect(o.tope).toBeNull();
  });

  it('tras Correr no queda nada', () => {
    const o = opcionesMovimiento(
      unidad({ accionesRestantes: 0, accionesUsadas: ['Correr'] }),
      perfil,
      'A1',
    );
    expect(o.tope).toBeNull();
  });

  it('una unidad trabada no se arrastra', () => {
    const o = opcionesMovimiento(unidad({ trabadaCon: ['B1'] }), perfil, 'A1');
    expect(o.puedeMover).toBe(false);
    expect(o.puedeCorrer).toBe(false);
    expect(o.tope).toBeNull();
  });

  it('una unidad seleccionada pero no activa no se arrastra', () => {
    const o = opcionesMovimiento(unidad(), perfil, null);
    expect(o.tope).toBeNull();
  });
});
