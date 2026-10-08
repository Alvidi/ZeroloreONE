import { distribucionCantidad } from '../dados.ts';
import type { Vec2 } from '../geometry.ts';
import type { Unidad } from '../types.ts';
import type { Parametros } from './combat.ts';
import { bajasCon } from './danio.ts';

/**
 * Previsión de combate: qué cabe esperar de un ataque ANTES de tirar.
 *
 * No simula: calcula la distribución exacta del daño con los mismos
 * `Parametros` que luego usa la tirada real, así que no pueden contradecirse.
 * Un ataque de escuadra tiene dos partes —la tropa y el Comandante— y cada una
 * es un ataque aparte con su propia salvación y su propia ventaja.
 */

type Dist = Map<number, number>;

const sumar = (d: Dist, v: number, p: number): void => {
  if (p > 0) d.set(v, (d.get(v) ?? 0) + p);
};

function convolucion(a: Dist, b: Dist): Dist {
  const out: Dist = new Map();
  for (const [va, pa] of a) for (const [vb, pb] of b) sumar(out, va + vb, pa * pb);
  return out;
}

export interface PrevisionParte {
  readonly parametros: Parametros;
  /** Probabilidad de que un dado acabe impactando (con Implacable incluido). */
  readonly pImpacto: number;
  /** Probabilidad de que el defensor salve un impacto normal. */
  readonly pSalvacion: number;
  readonly danioMedio: number;
  readonly dados: { readonly min: number; readonly max: number };
  readonly distribucion: ReadonlyMap<number, number>;
}

export function preverParte(p: Parametros): PrevisionParte {
  // --- Un dado: fallo, impacto normal o crítico ---
  const pCara = (desde: number, hasta: number): number => Math.max(0, Math.min(6, hasta) - desde + 1) / 6;
  const umbral = p.umbralImpacto ?? 1;
  const pCritUno = pCara(Math.max(umbral, p.umbralCritico), 6);
  const pNormalUno = pCara(umbral, p.umbralCritico - 1);
  const pFalloUno = 1 - pCritUno - pNormalUno;

  // Implacable: el que falla se vuelve a tirar una vez.
  const pCrit = pCritUno + (p.implacable ? pFalloUno * pCritUno : 0);
  const pNormal = pNormalUno + (p.implacable ? pFalloUno * pNormalUno : 0);

  const pSalvacion = Math.max(0, 7 - p.salvacion) / 6;
  const pPasaNormal = 1 - pSalvacion;
  const pPasaCrit = p.golpeCritico ? 1 : 1 - pSalvacion;

  const porDado: Dist = new Map();
  sumar(porDado, p.danioCritico, pCrit * pPasaCrit);
  sumar(porDado, p.danio, pNormal * pPasaNormal);
  sumar(porDado, 0, 1 - pCrit * pPasaCrit - pNormal * pPasaNormal);

  // --- Cuántos dados: la suma de lo que aporta cada miniatura ---
  let nDados: Dist = new Map([[0, 1]]);
  for (const c of p.cantidades) nDados = convolucion(nDados, distribucionCantidad(c) as Dist);

  // --- Daño bruto: n dados iguales, ponderado por cada n posible ---
  const bruto: Dist = new Map();
  const potencias: Dist[] = [new Map([[0, 1]])];
  const maxN = Math.max(...nDados.keys());
  for (let n = 1; n <= maxN; n++) potencias.push(convolucion(potencias[n - 1]!, porDado));
  for (const [n, pn] of nDados) {
    for (const [v, pv] of potencias[n]!) sumar(bruto, v, pn * pv);
  }

  // --- La ventaja solo entra si el ataque ha hecho algo ---
  const total: Dist = new Map();
  let media = 0;
  for (const [v, pv] of bruto) {
    const final = v > 0 ? v + p.ventaja : 0;
    sumar(total, final, pv);
    media += final * pv;
  }

  const ns = [...nDados.keys()];
  return {
    parametros: p,
    pImpacto: pCrit + pNormal,
    pSalvacion,
    danioMedio: media,
    dados: { min: Math.min(...ns), max: Math.max(...ns) },
    distribucion: total,
  };
}

export interface Prevision {
  readonly partes: readonly PrevisionParte[];
  readonly danioMedio: number;
  /** Probabilidad de hacer al menos 1 de daño. */
  readonly pTocar: number;
  readonly bajasMedias: number;
  /** Probabilidad de borrar la unidad entera. */
  readonly pDestruir: number;
  readonly minisObjetivo: number;
}

/**
 * Previsión de un ataque completo contra una unidad. `resistente` aplica la
 * reducción de 1D3 al primer daño que reciba en el turno, que es lo que hace
 * la habilidad Resistente.
 */
export function prever(
  partes: readonly Parametros[],
  objetivo: Unidad,
  desde: Vec2 | null,
  resistente: boolean,
): Prevision {
  const previstas = partes.map(preverParte);

  // Daño total encadenando las partes; Resistente muerde la primera que hace daño.
  let estados: Map<string, number> = new Map([['0|0', 1]]); // "total|yaReducido"
  for (const parte of previstas) {
    const sig: Map<string, number> = new Map();
    for (const [clave, pe] of estados) {
      const [totalTxt, reducidoTxt] = clave.split('|');
      const acumulado = Number(totalTxt);
      const reducido = reducidoTxt === '1';
      for (const [d, pd] of parte.distribucion) {
        if (d > 0 && resistente && !reducido) {
          for (const x of [1, 2, 3]) {
            const k = `${acumulado + Math.max(0, d - x)}|1`;
            sig.set(k, (sig.get(k) ?? 0) + (pe * pd) / 3);
          }
        } else {
          const k = `${acumulado + d}|${reducido || d > 0 ? 1 : 0}`;
          sig.set(k, (sig.get(k) ?? 0) + pe * pd);
        }
      }
    }
    estados = sig;
  }

  const minis = objetivo.minis.length;
  let danioMedio = 0;
  let pTocar = 0;
  let bajasMedias = 0;
  let pDestruir = 0;
  for (const [clave, p] of estados) {
    const total = Number(clave.split('|')[0]);
    danioMedio += total * p;
    if (total > 0) pTocar += p;
    const bajas = bajasCon(objetivo, total, desde);
    bajasMedias += bajas * p;
    if (bajas >= minis) pDestruir += p;
  }

  return { partes: previstas, danioMedio, pTocar, bajasMedias, pDestruir, minisObjetivo: minis };
}
