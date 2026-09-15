import { describe, expect, it } from 'vitest';
import { baseDistance, inBaseContact, segmentIntersectsRect, vec } from '@zerolore/core';

describe('Geometría de peanas', () => {
  it('mide de borde a borde, no de centro a centro', () => {
    // Centros a 10", peanas de 1" de radio cada una: 8" de borde a borde.
    expect(baseDistance(vec(0, 0), 1, vec(10, 0), 1)).toBeCloseTo(8);
  });

  it('el contacto de peana es distancia cero', () => {
    expect(inBaseContact(vec(0, 0), 1, vec(2, 0), 1)).toBe(true);
    expect(inBaseContact(vec(0, 0), 1, vec(2.5, 0), 1)).toBe(false);
  });

  it('nunca devuelve distancia negativa al solaparse', () => {
    expect(baseDistance(vec(0, 0), 2, vec(1, 0), 2)).toBe(0);
  });

  it('detecta que un muro corta la línea de tiro', () => {
    const muro = { x: 4, y: -2, width: 1, height: 4 };
    expect(segmentIntersectsRect(vec(0, 0), vec(10, 0), muro)).toBe(true);
    expect(segmentIntersectsRect(vec(0, 5), vec(10, 5), muro)).toBe(false);
  });
});
