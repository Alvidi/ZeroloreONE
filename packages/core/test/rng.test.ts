import { describe, expect, it } from 'vitest';
import { Rng } from '@zerolore/core';

describe('Rng determinista', () => {
  it('la misma semilla produce la misma secuencia', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    expect(a.roll(20)).toEqual(b.roll(20));
  });

  it('semillas distintas divergen', () => {
    expect(new Rng(1).roll(20)).not.toEqual(new Rng(2).roll(20));
  });

  it('el D6 siempre cae en [1,6]', () => {
    const r = new Rng(7);
    for (let i = 0; i < 5000; i++) {
      const v = r.d6();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('el reparto del D6 es razonablemente uniforme', () => {
    const r = new Rng(99);
    const counts = new Array(7).fill(0) as number[];
    const N = 60000;
    for (let i = 0; i < N; i++) counts[r.d6()]!++;
    for (let cara = 1; cara <= 6; cara++) {
      // Cada cara debe salir en torno al 16.7%; margen amplio para no ser frágil.
      expect(counts[cara]! / N).toBeGreaterThan(0.15);
      expect(counts[cara]! / N).toBeLessThan(0.185);
    }
  });

  it('se puede serializar y continuar la secuencia', () => {
    const a = new Rng(42);
    a.roll(10);
    const restored = Rng.restore(a.snapshot());
    expect(restored.roll(10)).toEqual(Rng.restore(a.snapshot()).roll(10));
  });
});
