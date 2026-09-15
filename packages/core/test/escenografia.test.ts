import { describe, expect, it } from 'vitest';
import {
  baseSolapaRect,
  baseToRectDistance,
  expulsarDeRect,
  imantarARect,
  recortarPorObstaculos,
  vec,
} from '@zerolore/core';
import type { Rect } from '@zerolore/core';

const muro = { x: 10, y: 10, width: 6, height: 2 };
const R = 0.63;

describe('Solape con la escenografía', () => {
  it('el centro dentro del rectángulo es solape', () => {
    expect(baseSolapaRect(vec(13, 11), R, muro)).toBe(true);
  });

  it('la peana pisando el borde es solape', () => {
    // Centro a 0.3" del borde inferior: menos que el radio, luego pisa.
    expect(baseSolapaRect(vec(13, 12.3), R, muro)).toBe(true);
  });

  it('en contacto exacto NO es solape: tocar está permitido', () => {
    expect(baseSolapaRect(vec(13, 12 + R), R, muro)).toBe(false);
  });

  it('separada del muro tampoco', () => {
    expect(baseSolapaRect(vec(13, 15), R, muro)).toBe(false);
  });
});

describe('Imán a la escenografía', () => {
  it('dentro del umbral pega la peana al borde, sin solaparla', () => {
    const p = imantarARect(vec(13, 13), R, muro, 0.9);
    expect(p).not.toBeNull();
    expect(baseToRectDistance(p!, R, muro)).toBeCloseTo(0, 6);
    expect(baseSolapaRect(p!, R, muro)).toBe(false);
  });

  it('fuera del umbral no atrae', () => {
    expect(imantarARect(vec(13, 16), R, muro, 0.9)).toBeNull();
  });

  it('no atrae si la peana ya se solapa: eso lo rechaza el movimiento', () => {
    expect(imantarARect(vec(13, 11), R, muro, 0.9)).toBeNull();
  });

  it('respeta el lado por el que se acerca', () => {
    const porArriba = imantarARect(vec(13, 9.2), R, muro, 0.9);
    const porDebajo = imantarARect(vec(13, 12.8), R, muro, 0.9);
    expect(porArriba!.y).toBeLessThan(10);
    expect(porDebajo!.y).toBeGreaterThan(12);
  });
});

describe('Expulsión de la escenografía', () => {
  const R2 = 0.63;
  const muro2 = { x: 10, y: 10, width: 6, height: 2 };

  it('con el centro dentro, sale por el lado más cercano y queda en contacto', () => {
    // Centro en (13, 11.7): el borde inferior (y=12) es el más cercano.
    const p = expulsarDeRect(vec(13, 11.7), R2, muro2)!;
    expect(p).not.toBeNull();
    expect(p.y).toBeCloseTo(12 + R2, 6);
    expect(baseSolapaRect(p, R2, muro2)).toBe(false);
    expect(baseToRectDistance(p, R2, muro2)).toBeCloseTo(0, 6);
  });

  it('con la peana pisando el borde, la aparta lo justo', () => {
    const p = expulsarDeRect(vec(13, 12.3), R2, muro2)!;
    expect(p.y).toBeCloseTo(12 + R2, 6);
  });

  it('sin solape no toca la posición', () => {
    expect(expulsarDeRect(vec(13, 15), R2, muro2)).toBeNull();
  });

  it('sale por el lateral si es el lado más próximo', () => {
    // Centro pegado al borde izquierdo.
    const p = expulsarDeRect(vec(10.3, 11), R2, muro2)!;
    expect(p.x).toBeCloseTo(10 - R2, 6);
    expect(p.y).toBeCloseTo(11, 6);
  });
});

describe('Recortar el movimiento por escenografía intransitable', () => {
  const tapia: Rect = { x: 10, y: 14, width: 8, height: 2 };

  it('el camino limpio llega al destino', () => {
    const fin = recortarPorObstaculos(vec(14, 10), vec(14, 13), 0.63, [tapia]);
    expect(fin.y).toBeCloseTo(13, 6);
  });

  it('no se atraviesa: el movimiento se para pegado al muro', () => {
    const fin = recortarPorObstaculos(vec(14, 10), vec(14, 20), 0.63, [tapia]);
    // El borde superior del muro está en y = 14; la peana para a un radio.
    expect(fin.y).toBeCloseTo(13.37, 2);
  });

  it('sin obstáculos que bloqueen, devuelve el destino tal cual', () => {
    const fin = recortarPorObstaculos(vec(14, 10), vec(14, 20), 0.63, []);
    expect(fin.y).toBeCloseTo(20, 6);
  });

  it('rodear por un lado sí llega', () => {
    const fin = recortarPorObstaculos(vec(5, 10), vec(5, 20), 0.63, [tapia]);
    expect(fin.y).toBeCloseTo(20, 6);
  });
});
