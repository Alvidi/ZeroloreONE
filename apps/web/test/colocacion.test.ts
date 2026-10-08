import { describe, expect, it } from 'vitest';
import { baseSolapaRect, vec } from '@zerolore/core';
import type { Terrain } from '@zerolore/core';
import { destinoDeMovimiento } from '../src/colocacion.ts';

const R = 0.63;
const MESA = { ancho: 44, alto: 30 };
/** La ruina central del mapa de pruebas. */
const ruina: Terrain = {
  id: 'ruina', rect: { x: 19, y: 12, width: 6, height: 6 }, altura: 4, tipo: 'bloqueo',
};

const mover = (origen: ReturnType<typeof vec>, cursor: ReturnType<typeof vec>, over = {}) =>
  destinoDeMovimiento({
    origen, radio: R, cursor, tope: 5, minimo: null,
    mesa: MESA, terreno: [ruina], puestos: [], unidades: [], iman: 0.9, ...over,
  });

describe('Colocación con la peana pegada a la ruina', () => {
  /** Pegada al lado izquierdo de la ruina, a media altura. */
  const pegada = vec(19 - R, 15);

  it('nunca devuelve un punto dentro de la escenografía', () => {
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      const cursor = vec(pegada.x + Math.cos(rad) * 8, pegada.y + Math.sin(rad) * 8);
      const p = mover(pegada, cursor);
      expect(baseSolapaRect(p, R, ruina.rect)).toBe(false);
    }
  });

  it('nunca se pasa del tope de movimiento', () => {
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      const cursor = vec(pegada.x + Math.cos(rad) * 30, pegada.y + Math.sin(rad) * 30);
      const p = mover(pegada, cursor);
      expect(Math.hypot(p.x - pegada.x, p.y - pegada.y)).toBeLessThanOrEqual(5 + 1e-6);
    }
  });

  it('apuntando al otro lado de la ruina se queda en este lado', () => {
    // Cursor al este, cruzando la ruina entera.
    const p = mover(pegada, vec(30, 15));
    expect(p.x).toBeLessThanOrEqual(19 - R + 1e-6);
  });

  it('se puede deslizar a lo largo del muro', () => {
    // Hacia arriba pegada a la cara oeste: camino limpio.
    const p = mover(pegada, vec(19 - R, 11));
    expect(p.y).toBeCloseTo(11, 1);
    expect(baseSolapaRect(p, R, ruina.rect)).toBe(false);
  });

  it('rodear la esquina por fuera llega', () => {
    // Desde la cara oeste hasta encima de la esquina noroeste, sin cruzar nada.
    const p = mover(vec(19 - R - 1, 15), vec(19 - R - 1, 11.5));
    expect(p.y).toBeCloseTo(11.5, 1);
  });
});

describe('Colocación al Correr (con anillo mínimo)', () => {
  const pegada = vec(19 - R, 15);
  const correr = (cursor: ReturnType<typeof vec>) =>
    mover(pegada, cursor, { tope: 7, minimo: 5 });

  it('si la dirección está cortada, se queda donde alcanza y no se va al vacío', () => {
    const p = correr(vec(30, 15)); // al otro lado de la ruina
    expect(baseSolapaRect(p, R, ruina.rect)).toBe(false);
    expect(Math.hypot(p.x - pegada.x, p.y - pegada.y)).toBeLessThanOrEqual(7 + 1e-6);
  });

  it('en dirección libre respeta el mínimo', () => {
    const p = correr(vec(19 - R, 14)); // hacia arriba, cursor a 1"
    expect(Math.hypot(p.x - pegada.x, p.y - pegada.y)).toBeGreaterThanOrEqual(5 - 1e-6);
  });
});

describe('Colocación junto a otras miniaturas', () => {
  const origen = vec(5, 15);
  const destino = (unidades: { centro: ReturnType<typeof vec>; radio: number; margen: number }[]) =>
    destinoDeMovimiento({
      origen, radio: R, cursor: vec(10, 15), tope: 7, minimo: null,
      mesa: MESA, terreno: [], puestos: [], unidades, iman: 0.9,
    });

  it('se queda fuera de la zona de control de un enemigo', () => {
    const p = destino([{ centro: vec(10, 15), radio: R, margen: 1 }]);
    const separacion = Math.hypot(p.x - 10, p.y - 15) - R - R;
    expect(separacion).toBeGreaterThan(1);
  });

  it('a una aliada le basta con no pisarla', () => {
    const p = destino([{ centro: vec(10, 15), radio: R, margen: 0 }]);
    const separacion = Math.hypot(p.x - 10, p.y - 15) - R - R;
    expect(separacion).toBeGreaterThanOrEqual(-1e-6);
    expect(separacion).toBeLessThan(1);
  });
});
