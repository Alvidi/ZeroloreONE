import { describe, expect, it } from 'vitest';
import { baseSolapaRect, caminoMasCorto, centerDistance, recortarCamino, vec } from '@zerolore/core';
import type { Rect } from '@zerolore/core';

const R = 0.63;
/** La ruina central del mapa de pruebas. */
const ruina: Rect = { x: 19, y: 12, width: 6, height: 6 };

describe('Camino rodeando obstáculos', () => {
  it('sin nada en medio, va recto', () => {
    const c = caminoMasCorto(vec(5, 5), vec(10, 5), R, [ruina])!;
    expect(c.puntos).toHaveLength(2);
    expect(c.longitud).toBeCloseTo(5, 6);
  });

  it('con la ruina delante, dobla por la esquina', () => {
    // De la cara oeste a la cara este: recto sería 8", rodeando es más.
    const c = caminoMasCorto(vec(19 - R, 15), vec(25 + R, 15), R, [ruina])!;
    expect(c.puntos.length).toBeGreaterThan(2);
    expect(c.longitud).toBeGreaterThan(centerDistance(vec(19 - R, 15), vec(25 + R, 15)));
    // Y ningún tramo pasa por dentro de la ruina.
    for (const p of c.puntos) expect(baseSolapaRect(p, R, ruina)).toBe(false);
  });

  it('pegado a la esquina, se puede girar y seguir', () => {
    // Pegada a la cara oeste, justo bajo la esquina noroeste; destino al norte
    // pasando por encima de la ruina.
    const c = caminoMasCorto(vec(19 - R, 12.5), vec(22, 12 - R - 0.5), R, [ruina])!;
    expect(c).not.toBeNull();
    expect(c.puntos.length).toBeGreaterThan(2);
  });

  it('un destino dentro del obstáculo no tiene camino', () => {
    expect(caminoMasCorto(vec(10, 15), vec(22, 15), R, [ruina])).toBeNull();
  });

  it('recortar deja el recorrido en el tope pedido', () => {
    const c = caminoMasCorto(vec(19 - R, 15), vec(25 + R, 15), R, [ruina])!;
    const corto = recortarCamino(c, 4);
    expect(corto.longitud).toBeCloseTo(4, 6);
    // Sigue empezando donde empezaba.
    expect(corto.puntos[0]).toEqual(c.puntos[0]);
    for (const p of corto.puntos) expect(baseSolapaRect(p, R, ruina)).toBe(false);
  });

  it('si el camino cabe entero, recortar no lo toca', () => {
    const c = caminoMasCorto(vec(5, 5), vec(10, 5), R, [ruina])!;
    expect(recortarCamino(c, 99)).toBe(c);
  });
});
