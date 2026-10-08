import { describe, expect, it } from 'vitest';
import { formatCantidad, parseCantidad } from '@zerolore/core';
import { TIPOS } from './ayuda.ts';

describe('la notación de dados de las fichas', () => {
  it('"2D" son dos dados fijos, no 2D6', () => {
    expect(parseCantidad('2D')).toBe(2);
    expect(parseCantidad('1D')).toBe(1);
  });

  it('las expresiones se tiran', () => {
    expect(parseCantidad('1D6')).toEqual({ dados: 1, caras: 6, mas: 0 });
    expect(parseCantidad('1D3+1')).toEqual({ dados: 1, caras: 3, mas: 1 });
    expect(parseCantidad('1D6+2')).toEqual({ dados: 1, caras: 6, mas: 2 });
  });

  it('se escribe igual que en la ficha', () => {
    expect(formatCantidad(2)).toBe('2D');
    expect(formatCantidad({ dados: 1, caras: 6, mas: 2 })).toBe('1D6+2');
  });
});

describe('el catálogo de la web', () => {
  it('trae los 15 tipos y los 4 Comandantes', () => {
    expect(Object.keys(TIPOS)).toHaveLength(19);
    expect(Object.values(TIPOS).filter((t) => t.esComandante)).toHaveLength(4);
  });

  it('lee el perfil del Tirador con sus números', () => {
    const t = TIPOS.tirador!;
    expect(t).toMatchObject({ movimiento: 5, velocidad: 2, vidas: 5, salvacion: 4, escuadra: 5, valor: 5 });
    expect(t.habilidad).toBe('Atrincherado');
    expect(t.disparo).toMatchObject({ ataques: 2, distancia: 24, precision: 4, danio: 1, danioCritico: 2 });
    expect(t.disparo!.habilidades).toEqual(['Disparo certero']);
  });

  it('el Choque no tiene arma a distancia', () => {
    expect(TIPOS.choque!.disparo).toBeNull();
    expect(TIPOS.choque!.cac).toMatchObject({ ataques: 3, danio: 2, danioCritico: 3, habilidades: ['Implacable'] });
  });

  it('el Psíquico no tira Precisión: es Directo', () => {
    const d = TIPOS.psiquico!.disparo!;
    expect(d.precision).toBeNull();
    expect(d.habilidades).toContain('Directo');
    expect(d.ataques).toEqual({ dados: 1, caras: 3, mas: 0 });
  });

  it('traduce las ventajas de nombre a id, con su bonus', () => {
    expect(TIPOS.juggernaut!.ventajas).toEqual([
      { tipoId: 'tirador', bonus: 1 },
      { tipoId: 'choque', bonus: 2 },
    ]);
    expect(TIPOS['armas-pesadas']!.ventajas).toContainEqual({ tipoId: 'vehiculo-ligero', bonus: 2 });
  });

  it('la Artillería no se mueve y los sueltos no forman escuadra', () => {
    expect(TIPOS.artilleria!.movimiento).toBeNull();
    expect(TIPOS.explorador!.escuadra).toBeNull();
    expect(TIPOS.milicia!.escuadra).toBe(12);
  });

  it('las peanas crecen con el tamaño de la unidad', () => {
    expect(TIPOS.milicia!.radioPeana).toBeLessThan(TIPOS['comandante-cac']!.radioPeana);
    expect(TIPOS['comandante-cac']!.radioPeana).toBeLessThan(TIPOS.juggernaut!.radioPeana);
    expect(TIPOS.juggernaut!.radioPeana).toBeLessThan(TIPOS.titan!.radioPeana);
  });
});
