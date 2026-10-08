import { esDado, type Cantidad } from '../dados.ts';
import type { MeleeWeapon, RangedWeapon, UnitProfile, WeaponAbility } from '../types.ts';
import { hasClassAdvantage } from './combat.ts';

/**
 * Previsión de combate: qué cabe esperar de un ataque ANTES de tirar los dados.
 *
 * No simula: calcula la distribución exacta de daño siguiendo la misma
 * secuencia que `resolveRangedAttack` / `resolveMeleeAttack`. Si las dos se
 * separan, la previsión miente, así que cualquier cambio en la resolución tiene
 * que bajar también aquí.
 */
export interface Prevision {
  /** Dados de ataque: fijos, o el rango de la expresión ("1D3" → 1..3). */
  readonly ataques: { readonly min: number; readonly max: number; readonly medio: number };
  /** Umbral de Precisión. `null` cuando no hay tirada fija: Directo o Errática. */
  readonly umbralImpacto: number | null;
  /** Impacta sin tirar. */
  readonly directo: boolean;
  /** La Precisión de cada ataque sale de 1D6: la previsión promedia los seis. */
  readonly erratica: boolean;
  readonly umbralCritico: number;
  readonly salvacionBase: number;
  /** Salvación del objetivo ya con cobertura y Perforante aplicadas. */
  readonly umbralSalvacion: number;
  readonly enCobertura: boolean;
  /** Probabilidad de que un dado de ataque impacte. */
  readonly pImpacto: number;
  /** Probabilidad de que el objetivo salve un impacto. */
  readonly pSalvacion: number;
  readonly danioMedio: number;
  /** Probabilidad de hacer al menos 1 de daño. */
  readonly pTocar: number;
  /** Probabilidad de tumbarla con este ataque. */
  readonly pMatar: number;
  readonly ventajaClase: boolean;
  readonly anti: boolean;
  readonly vidasObjetivo: number;
}

const CRIT_BASE = 6;
const MELEE_HIT = 3;
const MELEE_HIT_COVER = 4;
const cap = (v: number): number => Math.min(6, Math.max(1, v));
const tiene = (ab: readonly WeaponAbility[], n: string): boolean => ab.some((a) => a.nombre === n);

/** Distribución discreta: valor → probabilidad. */
type Dist = Map<number, number>;

/** Rango posible de una cantidad de la ficha. */
function rangoCantidad(c: Cantidad): { min: number; max: number; medio: number } {
  if (!esDado(c)) return { min: c, max: c, medio: c };
  return {
    min: Math.max(0, c.dados + c.mas),
    max: Math.max(0, c.dados * c.caras + c.mas),
    medio: c.dados * ((c.caras + 1) / 2) + c.mas,
  };
}

/** Probabilidades del número de dados de ataque. */
function distAtaques(c: Cantidad): Dist {
  if (!esDado(c)) return new Map([[Math.max(0, c), 1]]);
  let d: Dist = new Map([[c.mas, 1]]);
  for (let i = 0; i < c.dados; i++) {
    const siguiente: Dist = new Map();
    for (const [v, p] of d) {
      for (let cara = 1; cara <= c.caras; cara++) {
        const k = v + cara;
        siguiente.set(k, (siguiente.get(k) ?? 0) + p / c.caras);
      }
    }
    d = siguiente;
  }
  const limpia: Dist = new Map();
  for (const [v, p] of d) {
    const k = Math.max(0, v);
    limpia.set(k, (limpia.get(k) ?? 0) + p);
  }
  return limpia;
}

/** Convolución: daño de `n` dados iguales, partiendo del daño de uno. */
function repetir(dado: Dist, n: number): Dist {
  let total: Dist = new Map([[0, 1]]);
  for (let i = 0; i < n; i++) {
    const siguiente: Dist = new Map();
    for (const [a, pa] of total) {
      for (const [b, pb] of dado) {
        const k = a + b;
        siguiente.set(k, (siguiente.get(k) ?? 0) + pa * pb);
      }
    }
    total = siguiente;
  }
  return total;
}

function mezclar(destino: Dist, origen: Dist, peso: number): void {
  for (const [v, p] of origen) destino.set(v, (destino.get(v) ?? 0) + p * peso);
}

export interface PrevisionCtx {
  readonly enCobertura: boolean;
  /** Vidas que le quedan al objetivo ahora mismo, no las de su perfil. */
  readonly vidasObjetivo: number;
  /** Con las habilidades de arma apagadas, la previsión también las ignora. */
  readonly habilidadesArma?: boolean;
}

export function preverAtaque(
  arma: RangedWeapon | MeleeWeapon,
  atacante: UnitProfile,
  objetivo: UnitProfile,
  ctx: PrevisionCtx,
): Prevision {
  const ab: readonly WeaponAbility[] = (ctx.habilidadesArma ?? true) ? arma.habilidades : [];

  // --- Umbral de impacto ---
  let umbralImpacto: number | null;
  if (arma.kind === 'disparo') {
    if (tiene(ab, 'Directo')) umbralImpacto = null;
    else if (tiene(ab, 'Errática')) umbralImpacto = -1; // lo marca la mezcla de abajo
    else umbralImpacto = arma.precision === null ? null : cap(arma.precision);
  } else {
    umbralImpacto = ctx.enCobertura ? MELEE_HIT_COVER : MELEE_HIT;
  }

  const brutal = ab.find((a) => a.nombre === 'Brutal X+');
  const umbralCritico = brutal?.x !== undefined ? cap(brutal.x) : CRIT_BASE;

  // --- Salvación ---
  // Disparando, la cobertura mejora la salvación; en cuerpo a cuerpo estorba al
  // atacante y ya se ha cobrado arriba, en el umbral de impacto.
  let salvacion = objetivo.salvacion;
  if (arma.kind === 'disparo' && ctx.enCobertura) salvacion -= 1;
  if (tiene(ab, 'Perforante')) salvacion += 1;
  salvacion = cap(salvacion);
  // Un 1 natural siempre falla la salvación.
  const pSalvacion = Math.max(0, 7 - Math.max(2, salvacion)) / 6;

  /** Daño de UN dado de ataque con un umbral de impacto concreto. */
  const dadoConUmbral = (umbral: number | null): Dist => {
    const d: Dist = new Map();
    const suma = (v: number, p: number): void => { if (p > 0) d.set(v, (d.get(v) ?? 0) + p); };
    if (umbral === null) {
      // Directo: impacta siempre y sin dado natural no hay crítico.
      suma(arma.danio, 1 - pSalvacion);
      suma(0, pSalvacion);
      return d;
    }
    const pCrit = Math.max(0, 7 - Math.max(umbral, umbralCritico)) / 6;
    const pNormal = Math.max(0, Math.min(7, umbralCritico) - umbral) / 6;
    suma(arma.danioCritico, pCrit * (1 - pSalvacion));
    suma(arma.danio, pNormal * (1 - pSalvacion));
    suma(0, 1 - (pCrit + pNormal) * (1 - pSalvacion));
    return d;
  };

  /*
    Errática tira la Precisión de este ataque con 1D6, así que la previsión
    promedia los seis umbrales posibles en vez de fingir uno.
  */
  const umbrales: Array<{ umbral: number | null; peso: number }> =
    umbralImpacto === -1
      ? [1, 2, 3, 4, 5, 6].map((u) => ({ umbral: cap(u), peso: 1 / 6 }))
      : [{ umbral: umbralImpacto, peso: 1 }];

  const porDado: Dist = new Map();
  let pImpacto = 0;
  for (const { umbral, peso } of umbrales) {
    mezclar(porDado, dadoConUmbral(umbral), peso);
    pImpacto += peso * (umbral === null ? 1 : Math.max(0, 7 - umbral) / 6);
  }

  // --- Daño bruto sobre todos los dados de ataque ---
  const ataquesDist = distAtaques(arma.ataques);
  const bruto: Dist = new Map();
  for (const [n, p] of ataquesDist) mezclar(bruto, repetir(porDado, n), p);

  // --- Extras que solo entran si el ataque ha hecho algo ---
  const ventajaClase = hasClassAdvantage(atacante.clase, objetivo.clase);
  const anti = ab.some((a) => a.nombre === 'Anti-X' && a.objetivo === objetivo.clase);
  const total: Dist = new Map();
  for (const [v, p] of bruto) {
    if (v <= 0) { total.set(0, (total.get(0) ?? 0) + p); continue; }
    const base = v + (ventajaClase ? 1 : 0);
    if (anti) {
      for (const extra of [1, 2, 3]) {
        total.set(base + extra, (total.get(base + extra) ?? 0) + p / 3);
      }
    } else {
      total.set(base, (total.get(base) ?? 0) + p);
    }
  }

  let danioMedio = 0;
  let pTocar = 0;
  let pMatar = 0;
  for (const [v, p] of total) {
    danioMedio += v * p;
    if (v > 0) pTocar += p;
    if (v >= ctx.vidasObjetivo) pMatar += p;
  }

  return {
    ataques: rangoCantidad(arma.ataques),
    umbralImpacto: umbralImpacto === -1 ? null : umbralImpacto,
    directo: umbralImpacto === null,
    erratica: umbralImpacto === -1,
    umbralCritico,
    salvacionBase: objetivo.salvacion,
    umbralSalvacion: salvacion,
    enCobertura: ctx.enCobertura,
    pImpacto,
    pSalvacion,
    danioMedio,
    pTocar,
    pMatar: ctx.vidasObjetivo <= 0 ? 0 : pMatar,
    ventajaClase,
    anti,
    vidasObjetivo: ctx.vidasObjetivo,
  };
}
