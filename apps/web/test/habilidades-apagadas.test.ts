import { describe, expect, it } from 'vitest';
import { Engine, Rng, resolveRangedAttack, vec } from '@zerolore/core';
import type { GameState, RangedWeapon, Unit, UnitProfile } from '@zerolore/core';

/**
 * El interruptor de habilidades no borra nada: apaga los modificadores y deja
 * en pie lo estructural. Estas pruebas fijan ese contrato para que encenderlas
 * de nuevo sea seguro.
 */
const perfil = (over: Partial<UnitProfile> = {}): UnitProfile => ({
  id: 'p', nombre: 'Test', rol: null, clase: 'Choque', set: 'Equilibrado',
  movimiento: 5, vidas: 6, salvacion: 4, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: 0.63,
  armas: [], ...over,
});

const arma = (over: Partial<RangedWeapon> = {}): RangedWeapon => ({
  kind: 'disparo', nombre: 'A distancia', ataques: 6, distancia: 18,
  precision: 4, danio: 1, danioCritico: 2, habilidades: [], ...over,
});

const ctx = { distancia: 10, enCobertura: false };

describe('Habilidades apagadas', () => {
  it('Perforante deja de empeorar la salvación', () => {
    const w = arma({ habilidades: [{ nombre: 'Perforante' }] });
    const on = resolveRangedAttack(new Rng(4), w, perfil(), perfil({ salvacion: 4 }), ctx);
    const off = resolveRangedAttack(new Rng(4), w, perfil(), perfil({ salvacion: 4 }), {
      ...ctx, habilidadesArma: false,
    });
    expect(on.umbralSalvacion).toBe(5);
    expect(off.umbralSalvacion).toBe(4);
  });

  it('Brutal X+ deja de rebajar el crítico', () => {
    const w = arma({ habilidades: [{ nombre: 'Brutal X+', x: 5 }] });
    const off = resolveRangedAttack(new Rng(4), w, perfil(), perfil(), {
      ...ctx, habilidadesArma: false,
    });
    expect(off.umbralCritico).toBe(6);
  });

  it('Anti-X deja de sumar daño', () => {
    const w = arma({ ataques: 8, precision: 2, habilidades: [{ nombre: 'Anti-X', objetivo: 'Choque' }] });
    const off = resolveRangedAttack(new Rng(9), w, perfil(), perfil({ salvacion: 6 }), {
      ...ctx, habilidadesArma: false,
    });
    expect(off.bonusAntiX).toBe(0);
  });

  it('Directo sigue funcionando: es estructural, no un modificador', () => {
    const w = arma({ ataques: 3, precision: null, habilidades: [{ nombre: 'Directo' }] });
    const off = resolveRangedAttack(new Rng(4), w, perfil(), perfil({ salvacion: 6 }), {
      ...ctx, habilidadesArma: false,
    });
    expect(off.umbralImpacto).toBeNull();
    expect(off.impactos + off.criticos).toBe(3);
  });

  it('la ventaja de clase no es una habilidad: sigue aplicándose', () => {
    const w = arma({ ataques: 8, precision: 2 });
    const off = resolveRangedAttack(
      new Rng(9), w, perfil({ clase: 'Choque' }), perfil({ clase: 'Especialista', salvacion: 6 }),
      { ...ctx, habilidadesArma: false },
    );
    if (off.danioBase + off.danioCritico > 0) expect(off.bonusVentajaClase).toBe(1);
  });
});

describe('Habilidades de unidad apagadas', () => {
  const conCertero = perfil({
    id: 'c', habilidad: { nombre: 'Certero', descripcion: '' },
    armas: [arma(), { kind: 'cuerpo_a_cuerpo', nombre: 'Cuerpo a cuerpo', ataques: 2, danio: 1, danioCritico: 1, habilidades: [] }],
  });

  const unit = (id: string, owner: string, x: number, y: number): Unit => ({
    id, profileId: 'c', owner, position: vec(x, y), vidas: 6,
    activated: false, accionesRestantes: 0, accionesUsadas: [], trabadaCon: [],
    seMovio: false, corrio: false, cargo: false, destruidaEnTurno: null,
    ataqueGratuitoContra: null,
  });

  const estado = (): GameState => ({
    mode: 'Escaramuza', turno: 1, fase: 'Iniciativa',
    jugadores: ['A', 'B'], ordenIniciativa: [], jugadorActivo: null, unidadActiva: null,
    units: { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 20) },
    profiles: { c: conCertero }, terrain: [], puestos: [], reserva: [], puntos: {}, refuerzoUsado: {}, turnosTotales: 6, rngState: 3,
  });

  const dispara = (habilidades: boolean): number | null => {
    const e = new Engine(estado(), [], { habilidades });
    e.execute({ type: 'TirarIniciativa' });
    e.execute({ type: 'ComenzarActivaciones' });
    const s = e.getState();
    const atacante = Object.values(s.units).find((u) => u.owner === s.jugadorActivo)!;
    const objetivo = atacante.id === 'a1' ? 'b1' : 'a1';
    e.execute({ type: 'ActivarUnidad', unitId: atacante.id });
    const r = e.execute({
      type: 'Disparar', unitId: atacante.id, targetId: objetivo, armaNombre: 'A distancia',
    });
    if (!r.ok) return null;
    const ev = r.events.find((x) => x.type === 'DisparoResuelto');
    return ev?.type === 'DisparoResuelto' ? ev.resultado.umbralImpacto : null;
  };

  it('Certero mejora la Precisión encendido y no la toca apagado', () => {
    expect(dispara(true)).toBe(3);   // 4+ mejorado en 1
    expect(dispara(false)).toBe(4);  // el valor impreso del arma
  });
});
