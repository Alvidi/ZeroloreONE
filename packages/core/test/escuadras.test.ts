import { describe, expect, it } from 'vitest';
import { esCoherente, formar, repartirDanio, restriccionesPara, vec } from '@zerolore/core';
import { TIPOS, enMesa, escuadra, unidad } from './ayuda.ts';

describe('el daño en una escuadra', () => {
  const u = unidad(escuadra('A1', 'A', 'comandante-disparo', 'tirador', 3, 10, 10));

  it('se acumula y cae miniatura a miniatura, con el Comandante el último', () => {
    // Tiradores de 5 vidas: 12 de daño tumban dos y dejan la tercera con 3.
    const r = repartirDanio(u, 12, null);
    expect(r.muertas).toHaveLength(2);
    expect(r.muertas.every((m) => !m.esComandante)).toBe(true);
    expect(r.vivas.find((m) => m.esComandante)!.vidas).toBe(TIPOS['comandante-disparo']!.vidas);
    expect(r.vivas.filter((m) => !m.esComandante).map((m) => m.vidas)).toEqual([3]);
  });

  it('el Comandante solo recibe daño cuando no queda tropa', () => {
    const r = repartirDanio(u, 15 + 2, null);
    expect(r.muertas).toHaveLength(3);
    expect(r.vivas).toHaveLength(1);
    expect(r.vivas[0]!.vidas).toBe(TIPOS['comandante-disparo']!.vidas - 2);
  });

  it('primero se remata a la herida, no se reparten heridas', () => {
    const tocada = { ...u, minis: u.minis.map((m, i) => (i === 3 ? { ...m, vidas: 1 } : m)) };
    const r = repartirDanio(tocada, 1, null);
    expect(r.muertas.map((m) => m.id)).toEqual([u.minis[3]!.id]);
  });
});

describe('la coherencia', () => {
  it('vale cualquier forma mientras la cadena no se rompa', () => {
    const fila = [0, 1.5, 3, 4.5].map((x) => ({ centro: vec(x, 0), radio: 0.55 }));
    expect(esCoherente(fila)).toBe(true);
  });

  it('una miniatura a más de 1" del resto la rompe', () => {
    const rota = [{ centro: vec(0, 0), radio: 0.55 }, { centro: vec(3, 0), radio: 0.55 }];
    expect(esCoherente(rota)).toBe(false);
  });
});

describe('mover una escuadra desde el Comandante', () => {
  const def = escuadra('A1', 'A', 'comandante-disparo', 'tirador', 3, 10, 10);
  const u = unidad(def);
  const piezas = u.minis.map((m, i) => ({
    id: m.id, radio: TIPOS[m.tipoId]!.radioPeana, desde: m.posicion, esAncla: i === 0,
  }));

  it('con el camino libre, la escuadra se desplaza en bloque', () => {
    const state = enMesa({ unidades: [def] });
    const R = restriccionesPara(state, 'A', 'A1', 1);
    const pos = formar(piezas, vec(14, 10), R, 5)!;
    expect(pos).not.toBeNull();
    for (const m of u.minis) {
      expect(pos[m.id]!.x).toBeCloseTo(m.posicion.x + 4);
      expect(pos[m.id]!.y).toBeCloseTo(m.posicion.y);
    }
  });

  it('si una miniatura no cabe en su sitio, busca hueco sin romper la coherencia', () => {
    const muro = { id: 'muro', rect: { x: 16.2, y: 8, width: 1, height: 4 }, altura: 3, tipo: 'bloqueo' as const };
    const state = enMesa({ unidades: [def], terreno: [muro] });
    const R = restriccionesPara(state, 'A', 'A1', 1);
    const pos = formar(piezas, vec(13, 10), R, 5)!;
    expect(pos).not.toBeNull();
    const colocadas = u.minis.map((m) => ({ centro: pos[m.id]!, radio: TIPOS[m.tipoId]!.radioPeana }));
    expect(esCoherente(colocadas)).toBe(true);
    for (const c of colocadas) {
      const dentro = c.centro.x + c.radio > 16.2 && c.centro.x - c.radio < 17.2 &&
        c.centro.y + c.radio > 8 && c.centro.y - c.radio < 12;
      expect(dentro).toBe(false);
    }
  });

  it('respeta la pulgada con el enemigo', () => {
    const enemigo = { id: 'B1', owner: 'B', minis: [{ tipo: 'juggernaut', x: 20, y: 10 }] };
    const state = enMesa({ unidades: [def, enemigo] });
    const R = restriccionesPara(state, 'A', 'A1', 1);
    const pos = formar(piezas, vec(14.5, 10), R, 5);
    if (pos) {
      const rJ = TIPOS.juggernaut!.radioPeana;
      for (const m of u.minis) {
        const d = Math.hypot(pos[m.id]!.x - 20, pos[m.id]!.y - 10) - rJ - TIPOS[m.tipoId]!.radioPeana;
        expect(d).toBeGreaterThanOrEqual(1 - 1e-6);
      }
    }
  });
});
