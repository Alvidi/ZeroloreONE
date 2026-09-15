import { describe, expect, it } from 'vitest';
import { Rng } from '@zerolore/core';
import { formatCantidad, mediaCantidad, parseCantidad, resolverCantidad } from '../src/dados.ts';

describe('Expresiones de dados de las fichas', () => {
  it('lee los formatos que aparecen en los JSON', () => {
    expect(parseCantidad(3)).toBe(3);
    expect(parseCantidad('2')).toBe(2);
    expect(parseCantidad('1D6')).toEqual({ dados: 1, caras: 6, mas: 0 });
    expect(parseCantidad('2D6')).toEqual({ dados: 2, caras: 6, mas: 0 });
    expect(parseCantidad('D6+2')).toEqual({ dados: 1, caras: 6, mas: 2 });
    expect(parseCantidad('D3')).toEqual({ dados: 1, caras: 3, mas: 0 });
  });

  it('rechaza lo que no sabe interpretar en vez de inventarse un valor', () => {
    expect(parseCantidad('-')).toBeNull();
    expect(parseCantidad('D.Dirección + D6')).toBeNull();
    expect(parseCantidad('')).toBeNull();
    expect(parseCantidad(undefined)).toBeNull();
  });

  it('1D6 tira siempre entre 1 y 6', () => {
    const rng = new Rng(4);
    const c = parseCantidad('1D6')!;
    for (let i = 0; i < 500; i++) {
      const v = resolverCantidad(rng, c);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('2D6 tira entre 2 y 12, y D6+2 entre 3 y 8', () => {
    const rng = new Rng(9);
    const dosD6 = parseCantidad('2D6')!;
    const d6mas2 = parseCantidad('D6+2')!;
    for (let i = 0; i < 500; i++) {
      const a = resolverCantidad(rng, dosD6);
      expect(a).toBeGreaterThanOrEqual(2);
      expect(a).toBeLessThanOrEqual(12);
      const b = resolverCantidad(rng, d6mas2);
      expect(b).toBeGreaterThanOrEqual(3);
      expect(b).toBeLessThanOrEqual(8);
    }
  });

  it('se muestra como en la ficha', () => {
    expect(formatCantidad(2)).toBe('2');
    expect(formatCantidad({ dados: 1, caras: 6, mas: 0 })).toBe('D6');
    expect(formatCantidad({ dados: 2, caras: 6, mas: 0 })).toBe('2D6');
    expect(formatCantidad({ dados: 1, caras: 6, mas: 2 })).toBe('D6+2');
  });

  it('la media sirve para comparar armas sin tirar', () => {
    expect(mediaCantidad(4)).toBe(4);
    expect(mediaCantidad({ dados: 1, caras: 6, mas: 0 })).toBe(3.5);
    expect(mediaCantidad({ dados: 2, caras: 6, mas: 0 })).toBe(7);
    expect(mediaCantidad({ dados: 1, caras: 6, mas: 2 })).toBe(5.5);
  });
});
