import { describe, expect, it } from 'vitest';
import { preverAtaque, resolveMeleeAttack, resolveRangedAttack, Rng } from '../src/index.ts';
import type { MeleeWeapon, RangedWeapon, UnitProfile } from '../src/types.ts';

function perfil(over: Partial<UnitProfile> = {}): UnitProfile {
  return {
    id: 'p', nombre: 'Prueba', rol: '', clase: 'Choque', set: '',
    movimiento: 5, velocidad: 3, salvacion: 4, vidas: 6, valor: 10,
    escuadraMin: 1, escuadraMax: 1, radioPeana: 0.5, altura: 2,
    armas: [], habilidades: [],
    ...over,
  } as UnitProfile;
}

const disparo = (over: Partial<RangedWeapon> = {}): RangedWeapon => ({
  kind: 'disparo', nombre: 'rifle', ataques: 2, distancia: 24,
  precision: 4, danio: 2, danioCritico: 3, habilidades: [],
  ...over,
});

const cac = (over: Partial<MeleeWeapon> = {}): MeleeWeapon => ({
  kind: 'cuerpo_a_cuerpo', nombre: 'espada', ataques: 2,
  danio: 2, danioCritico: 3, habilidades: [],
  ...over,
});

/** Media empírica de la resolución real, para contrastarla con la previsión. */
function mediaReal(tiradas: number, resolver: (rng: Rng) => number): number {
  let total = 0;
  for (let s = 0; s < tiradas; s++) total += resolver(new Rng(s + 1));
  return total / tiradas;
}

describe('previsión de combate', () => {
  it('el daño medio previsto coincide con el de la resolución real (disparo)', () => {
    const arma = disparo();
    const atacante = perfil();
    const objetivo = perfil({ clase: 'Elite' });

    const p = preverAtaque(arma, atacante, objetivo, { enCobertura: false, vidasObjetivo: 6 });
    const real = mediaReal(6000, (rng) =>
      resolveRangedAttack(rng, arma, atacante, objetivo, {
        distancia: 10, enCobertura: false, habilidadesArma: true,
      }).danioTotal);

    expect(p.danioMedio).toBeCloseTo(real, 1);
  });

  it('la cobertura baja el daño previsto y la real lo confirma', () => {
    const arma = disparo();
    const atacante = perfil();
    const objetivo = perfil({ clase: 'Elite' });

    const limpio = preverAtaque(arma, atacante, objetivo, { enCobertura: false, vidasObjetivo: 6 });
    const cubierto = preverAtaque(arma, atacante, objetivo, { enCobertura: true, vidasObjetivo: 6 });
    expect(cubierto.danioMedio).toBeLessThan(limpio.danioMedio);
    expect(cubierto.umbralSalvacion).toBe(limpio.umbralSalvacion - 1);

    const real = mediaReal(6000, (rng) =>
      resolveRangedAttack(rng, arma, atacante, objetivo, {
        distancia: 10, enCobertura: true, habilidadesArma: true,
      }).danioTotal);
    expect(cubierto.danioMedio).toBeCloseTo(real, 1);
  });

  it('en cuerpo a cuerpo la cobertura estorba al atacante, no mejora la salvación', () => {
    const arma = cac();
    const atacante = perfil();
    const objetivo = perfil({ clase: 'Elite' });

    const limpio = preverAtaque(arma, atacante, objetivo, { enCobertura: false, vidasObjetivo: 6 });
    const cubierto = preverAtaque(arma, atacante, objetivo, { enCobertura: true, vidasObjetivo: 6 });

    expect(limpio.umbralImpacto).toBe(3);
    expect(cubierto.umbralImpacto).toBe(4);
    expect(cubierto.umbralSalvacion).toBe(limpio.umbralSalvacion);

    const real = mediaReal(6000, (rng) =>
      resolveMeleeAttack(rng, arma, atacante, objetivo, {
        distancia: 0, enCobertura: true, habilidadesArma: true,
      }).danioTotal);
    expect(cubierto.danioMedio).toBeCloseTo(real, 1);
  });

  it('Directo impacta siempre y no saca críticos', () => {
    const arma = disparo({ habilidades: [{ nombre: 'Directo' }] });
    const p = preverAtaque(arma, perfil(), perfil(), { enCobertura: false, vidasObjetivo: 6 });
    expect(p.directo).toBe(true);
    expect(p.pImpacto).toBe(1);
    // 2 ataques × 2 de daño × 50% de fallar la salvación de 4+.
    expect(p.danioMedio).toBeCloseTo(2, 5);
  });

  it('Errática promedia los seis umbrales posibles', () => {
    const arma = disparo({ habilidades: [{ nombre: 'Errática' }] });
    const atacante = perfil();
    const objetivo = perfil({ clase: 'Elite' });
    const p = preverAtaque(arma, atacante, objetivo, { enCobertura: false, vidasObjetivo: 6 });

    expect(p.erratica).toBe(true);
    const real = mediaReal(6000, (rng) =>
      resolveRangedAttack(rng, arma, atacante, objetivo, {
        distancia: 10, enCobertura: false, habilidadesArma: true,
      }).danioTotal);
    expect(p.danioMedio).toBeCloseTo(real, 1);
  });

  it('la probabilidad de tumbarla mira las vidas que le quedan, no las del perfil', () => {
    const arma = disparo();
    const sano = preverAtaque(arma, perfil(), perfil(), { enCobertura: false, vidasObjetivo: 6 });
    const tocado = preverAtaque(arma, perfil(), perfil(), { enCobertura: false, vidasObjetivo: 2 });
    expect(tocado.pMatar).toBeGreaterThan(sano.pMatar);
    expect(tocado.pMatar).toBeGreaterThan(0);
    expect(tocado.pMatar).toBeLessThanOrEqual(1);
  });

  it('con ataques variables reparte entre todos los números de dados posibles', () => {
    const arma = disparo({ ataques: { dados: 1, caras: 3, mas: 0 } });
    const p = preverAtaque(arma, perfil(), perfil(), { enCobertura: false, vidasObjetivo: 6 });
    expect(p.ataques).toEqual({ min: 1, max: 3, medio: 2 });
  });
});
