import type { Rng } from './rng.ts';

/**
 * Una cantidad de la ficha puede ser un número fijo ("2 ataques") o una
 * expresión de dados ("1D6 ataques", "D6+2 de daño"). Las fichas de ZeroLore
 * usan ambas, así que el motor tiene que saber resolver las dos.
 */
export type Cantidad = number | DadoExpr;

export interface DadoExpr {
  readonly dados: number;
  readonly caras: number;
  /** Modificador fijo que se suma tras la tirada. */
  readonly mas: number;
}

export const esDado = (c: Cantidad): c is DadoExpr => typeof c !== 'number';

/**
 * Interpreta "1D6", "2D6", "D6+2", "D3", "3". Devuelve null si no encaja,
 * para que quien llame decida si es un dato erróneo o un caso sin soportar.
 */
export function parseCantidad(raw: unknown): Cantidad | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const texto = raw.trim().replace(/\s+/g, '');
  if (texto === '' || texto === '-') return null;

  const soloNumero = /^[+-]?\d+$/.exec(texto);
  if (soloNumero) return Number(texto);

  const dado = /^(\d*)[Dd](\d+)([+-]\d+)?$/.exec(texto);
  if (!dado) return null;

  return {
    dados: dado[1] === '' || dado[1] === undefined ? 1 : Number(dado[1]),
    caras: Number(dado[2]),
    mas: dado[3] === undefined ? 0 : Number(dado[3]),
  };
}

/** Tira la cantidad si es una expresión de dados; si es fija, la devuelve. */
export function resolverCantidad(rng: Rng, c: Cantidad): number {
  if (!esDado(c)) return c;
  let total = c.mas;
  for (let i = 0; i < c.dados; i++) total += rng.die(c.caras);
  return Math.max(0, total);
}

/** Texto para la interfaz: 2, "1D6", "D6+2". */
export function formatCantidad(c: Cantidad): string {
  if (!esDado(c)) return String(c);
  const prefijo = c.dados === 1 ? 'D' : `${c.dados}D`;
  const sufijo = c.mas === 0 ? '' : c.mas > 0 ? `+${c.mas}` : String(c.mas);
  return `${prefijo}${c.caras}${sufijo}`;
}

/** Valor medio, para ordenar o para que la IA compare armas sin tirar dados. */
export function mediaCantidad(c: Cantidad): number {
  if (!esDado(c)) return c;
  return c.dados * ((c.caras + 1) / 2) + c.mas;
}
