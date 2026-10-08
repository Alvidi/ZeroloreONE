import type { Rng } from './rng.ts';

/**
 * Una cantidad de la ficha puede ser un número fijo de dados ("2D" son dos
 * dados) o una expresión que se tira ("1D6" dados, "1D3+1" dados). Las fichas
 * de ZeroLore usan las dos, así que el motor tiene que saber resolverlas.
 *
 * Ojo con la notación: "2D" NO es 2D6. Es "dos dados", un número fijo.
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
 * Interpreta "2D", "1D6", "1D3+1", "D6", "3". Devuelve null si no encaja,
 * para que quien llame decida si es un dato erróneo o un caso sin soportar.
 */
export function parseCantidad(raw: unknown): Cantidad | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const texto = raw.trim().replace(/\s+/g, '').toUpperCase();
  if (texto === '' || texto === '-' || texto === '—') return null;

  if (/^[+-]?\d+$/.test(texto)) return Number(texto);

  // "2D": dos dados, sin caras detrás. Es un número fijo.
  const fijos = /^(\d+)D$/.exec(texto);
  if (fijos) return Number(fijos[1]);

  const dado = /^(\d*)D(\d+)([+-]\d+)?$/.exec(texto);
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

/** Texto para la interfaz, con la misma notación que la ficha: "2D", "1D6+2". */
export function formatCantidad(c: Cantidad): string {
  if (!esDado(c)) return `${c}D`;
  const sufijo = c.mas === 0 ? '' : c.mas > 0 ? `+${c.mas}` : String(c.mas);
  return `${c.dados}D${c.caras}${sufijo}`;
}

/** Valor medio, para ordenar o para que la IA compare sin tirar dados. */
export function mediaCantidad(c: Cantidad): number {
  if (!esDado(c)) return c;
  return c.dados * ((c.caras + 1) / 2) + c.mas;
}

/** Probabilidad exacta de cada valor posible de la cantidad. */
export function distribucionCantidad(c: Cantidad): ReadonlyMap<number, number> {
  if (!esDado(c)) return new Map([[Math.max(0, c), 1]]);
  let d = new Map<number, number>([[c.mas, 1]]);
  for (let i = 0; i < c.dados; i++) {
    const siguiente = new Map<number, number>();
    for (const [v, p] of d) {
      for (let cara = 1; cara <= c.caras; cara++) {
        siguiente.set(v + cara, (siguiente.get(v + cara) ?? 0) + p / c.caras);
      }
    }
    d = siguiente;
  }
  const limpia = new Map<number, number>();
  for (const [v, p] of d) {
    const k = Math.max(0, v);
    limpia.set(k, (limpia.get(k) ?? 0) + p);
  }
  return limpia;
}
