/** Colores de la barra de vida. */
export const VIDA_VERDE = '#22c55e';
export const VIDA_AMARILLO = '#eab308';
export const VIDA_ROJO = '#ef4444';

/**
 * Color de la barra de vida según la fracción de Vidas restantes:
 *  - por encima de la mitad  -> verde
 *  - de la mitad a un cuarto -> amarillo
 *  - por debajo de un cuarto -> rojo
 */
export function colorVida(vidas: number, maximo: number): string {
  const fraccion = maximo > 0 ? vidas / maximo : 0;
  if (fraccion > 0.5) return VIDA_VERDE;
  if (fraccion > 0.25) return VIDA_AMARILLO;
  return VIDA_ROJO;
}
