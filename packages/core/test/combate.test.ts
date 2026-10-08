import { describe, expect, it } from 'vitest';
import { Rng, parametrosAtaque, preverParte, resolverAtaque, type Situacion } from '@zerolore/core';
import { TIPOS } from './ayuda.ts';

/**
 * Media empírica de la tirada real y su error típico. La tolerancia se fija en
 * cuatro errores típicos: con menos, una racha de dados mala parece un fallo
 * (con 8.000 tiradas el Choque daba 12,87 para un 13,00 exacto).
 */
function mediaReal(s: Situacion, tiradas = 40000): { media: number; error: number } {
  const p = parametrosAtaque(s);
  const rng = new Rng(12345);
  let suma = 0;
  let cuadrados = 0;
  for (let i = 0; i < tiradas; i++) {
    const t = resolverAtaque(rng, p).total;
    suma += t;
    cuadrados += t * t;
  }
  const media = suma / tiradas;
  const desviacion = Math.sqrt(Math.max(0, cuadrados / tiradas - media * media));
  return { media, error: desviacion / Math.sqrt(tiradas) };
}

const T = (id: string) => TIPOS[id]!;

/**
 * Cada caso combina habilidades distintas. Si la previsión y la tirada se
 * separan en cualquiera de ellos, la previsión miente al jugador.
 */
const casos: [string, Situacion][] = [
  ['5 Tiradores contra Milicia', {
    arma: T('tirador').disparo!, minis: 5, defensor: T('milicia'),
    tipoAtacante: T('tirador'), tipoObjetivo: T('milicia'), enCobertura: false,
  }],
  ['Tiradores a media distancia (Disparo certero) y en cobertura', {
    arma: T('tirador').disparo!, minis: 3, defensor: T('choque'),
    tipoAtacante: T('tirador'), tipoObjetivo: T('choque'), enCobertura: true, aMitadDeAlcance: true,
  }],
  ['Choque con Implacable en cuerpo a cuerpo', {
    arma: T('choque').cac!, minis: 4, defensor: T('tirador'),
    tipoAtacante: T('choque'), tipoObjetivo: T('tirador'), enCobertura: false, cargaBrutal: true,
  }],
  ['Exterminador: Implacable y Brutal, contra Choque (ventaja +1)', {
    arma: T('exterminador').cac!, minis: 1, defensor: T('choque'),
    tipoAtacante: T('exterminador'), tipoObjetivo: T('choque'), enCobertura: false,
  }],
  ['Juggernaut Perforante contra Choque (ventaja +2) en cobertura', {
    arma: T('juggernaut').disparo!, minis: 1, defensor: T('choque'),
    tipoAtacante: T('juggernaut'), tipoObjetivo: T('choque'), enCobertura: true,
  }],
  ['Asaltante con Golpe crítico', {
    arma: T('asaltante').cac!, minis: 3, defensor: T('juggernaut'),
    tipoAtacante: T('asaltante'), tipoObjetivo: T('juggernaut'), enCobertura: false,
  }],
  ['Psíquico Directo con 1D3 ataques', {
    arma: T('psiquico').disparo!, minis: 2, defensor: T('juggernaut'),
    tipoAtacante: T('psiquico'), tipoObjetivo: T('juggernaut'), enCobertura: false,
  }],
  ['Comandante contra Berserker', {
    arma: T('comandante-cac').cac!, minis: 1, defensor: T('exterminador'),
    tipoAtacante: null, tipoObjetivo: T('exterminador'), enCobertura: false, objetivoBerserker: true,
  }],
];

describe('la previsión cuadra con la tirada real', () => {
  for (const [nombre, s] of casos) {
    it(nombre, () => {
      const previsto = preverParte(parametrosAtaque(s)).danioMedio;
      const { media, error } = mediaReal(s);
      expect(Math.abs(previsto - media)).toBeLessThan(Math.max(0.02, 4 * error));
    });
  }
});

describe('los modificadores', () => {
  const base: Situacion = {
    arma: T('tirador').disparo!, minis: 1, defensor: T('choque'),
    tipoAtacante: T('tirador'), tipoObjetivo: T('choque'), enCobertura: false,
  };

  it('la cobertura mejora la salvación contra disparos', () => {
    expect(parametrosAtaque({ ...base, enCobertura: true }).salvacion).toBe(3);
    expect(parametrosAtaque(base).salvacion).toBe(4);
  });

  it('en cuerpo a cuerpo la cobertura hace fallar el 3, sin tocar la salvación', () => {
    const cac: Situacion = { ...base, arma: T('choque').cac! };
    expect(parametrosAtaque(cac).umbralImpacto).toBe(3);
    const cubierto = parametrosAtaque({ ...cac, enCobertura: true });
    expect(cubierto.umbralImpacto).toBe(4);
    expect(cubierto.salvacion).toBe(4);
  });

  it('Atrincherado mejora la Precisión del Tirador', () => {
    expect(parametrosAtaque({ ...base, atrincherado: true }).umbralImpacto).toBe(3);
  });

  it('Disparo certero suma un dado solo a media distancia', () => {
    expect(parametrosAtaque(base).cantidades).toHaveLength(1);
    expect(parametrosAtaque({ ...base, aMitadDeAlcance: true }).cantidades).toHaveLength(2);
  });

  it('Brutal adelanta el crítico al 5', () => {
    expect(parametrosAtaque({ ...base, arma: T('exterminador').cac! }).umbralCritico).toBe(5);
  });

  it('el Comandante no tiene ventaja y nadie la tiene contra él', () => {
    const contraComandante = parametrosAtaque({
      ...base, arma: T('juggernaut').disparo!, tipoAtacante: T('juggernaut'), tipoObjetivo: null,
    });
    expect(contraComandante.ventaja).toBe(0);
  });

  it('ningún umbral pasa de 6+ ni baja de 2+', () => {
    const perforado = parametrosAtaque({ ...base, arma: T('juggernaut').disparo!, defensor: T('milicia') });
    expect(perforado.salvacion).toBe(6);
    const cubierto = parametrosAtaque({ ...base, defensor: T('juggernaut'), enCobertura: true });
    expect(cubierto.salvacion).toBe(2);
  });

  it('la ventaja solo suma si el ataque hace daño', () => {
    const p = parametrosAtaque({
      ...base, arma: T('juggernaut').disparo!, tipoAtacante: T('juggernaut'), tipoObjetivo: T('choque'),
    });
    expect(p.ventaja).toBe(2);
    for (let s = 1; s < 300; s++) {
      const t = resolverAtaque(new Rng(s), p);
      if (t.danioBase + t.danioCritico === 0) expect(t.total).toBe(0);
      else expect(t.total).toBe(t.danioBase + t.danioCritico + 2);
    }
  });
});
