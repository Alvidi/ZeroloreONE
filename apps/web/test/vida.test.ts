import { describe, expect, it } from 'vitest';
import { VIDA_AMARILLO, VIDA_ROJO, VIDA_VERDE, colorVida } from '../src/vida.ts';

describe('Barra de vida', () => {
  it('verde por encima de la mitad', () => {
    expect(colorVida(4, 4)).toBe(VIDA_VERDE);
    expect(colorVida(3, 4)).toBe(VIDA_VERDE);
    expect(colorVida(7, 10)).toBe(VIDA_VERDE);
  });

  it('amarillo justo en la mitad y hasta un cuarto', () => {
    expect(colorVida(2, 4)).toBe(VIDA_AMARILLO);   // exactamente la mitad
    expect(colorVida(5, 10)).toBe(VIDA_AMARILLO);
    expect(colorVida(3, 10)).toBe(VIDA_AMARILLO);
  });

  it('rojo por debajo de un cuarto', () => {
    expect(colorVida(1, 4)).toBe(VIDA_ROJO);       // un cuarto exacto
    expect(colorVida(2, 10)).toBe(VIDA_ROJO);
    expect(colorVida(1, 14)).toBe(VIDA_ROJO);
  });

  it('sin vidas es rojo, y un máximo de 0 no rompe', () => {
    expect(colorVida(0, 4)).toBe(VIDA_ROJO);
    expect(colorVida(0, 0)).toBe(VIDA_ROJO);
  });
});
