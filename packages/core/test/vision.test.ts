import { describe, expect, it } from 'vitest';
import { poligonoDeVision, puntoEnPoligono, vec } from '@zerolore/core';
import type { Rect } from '@zerolore/core';

const origen = vec(10, 10);
const R = 12;
/** Un pilar justo al norte del observador. */
const pilar: Rect = { x: 9, y: 5, width: 2, height: 2 };

describe('Polígono de visión', () => {
  it('sin obstáculos es el círculo entero', () => {
    const poli = poligonoDeVision(origen, R, []);
    for (const p of poli) {
      expect(Math.hypot(p.x - origen.x, p.y - origen.y)).toBeCloseTo(R, 6);
    }
  });

  it('un pilar recorta la visión justo delante de él', () => {
    const poli = poligonoDeVision(origen, R, [pilar]);
    // Al norte, el rayo se para en la cara sur del pilar (y = 7).
    const alNorte = poli.filter((p) => Math.abs(p.x - origen.x) < 0.2 && p.y < origen.y);
    expect(Math.min(...alNorte.map((p) => origen.y - p.y))).toBeCloseTo(3, 1);
  });

  it('lo que queda detrás del pilar no se ve', () => {
    const poli = poligonoDeVision(origen, R, [pilar]);
    expect(puntoEnPoligono(vec(10, 2), poli)).toBe(false);
  });

  it('lo que queda al lado del pilar sí se ve', () => {
    const poli = poligonoDeVision(origen, R, [pilar]);
    expect(puntoEnPoligono(vec(15, 4), poli)).toBe(true);
    expect(puntoEnPoligono(vec(5, 4), poli)).toBe(true);
  });

  it('fuera del alcance no se ve aunque no haya nada en medio', () => {
    const poli = poligonoDeVision(origen, R, []);
    expect(puntoEnPoligono(vec(10, 10 - R - 1), poli)).toBe(false);
    expect(puntoEnPoligono(vec(10, 10 - R + 1), poli)).toBe(true);
  });

  it('un obstáculo fuera de alcance no proyecta sombra', () => {
    const lejos: Rect = { x: 9, y: -20, width: 2, height: 2 };
    const poli = poligonoDeVision(origen, R, [lejos]);
    for (const p of poli) {
      expect(Math.hypot(p.x - origen.x, p.y - origen.y)).toBeCloseTo(R, 6);
    }
  });
});
