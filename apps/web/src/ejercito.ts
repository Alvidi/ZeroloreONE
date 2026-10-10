import type { EntradaLista, TipoUnidad } from '@zerolore/core';
import { TIPOS } from './partida.ts';

/**
 * La lista de ejército tal como se monta en la armería: qué tipos y cuántos de
 * cada uno. Las escuadras no se deciden aquí, sino en la mesa: en el despliegue
 * se pone un Comandante y se le arrastran soldados sueltos hasta su máximo.
 */
export interface Fila {
  readonly id: string;
  readonly tipoId: string;
  readonly cantidad: number;
}

export const PRESUPUESTOS = [60, 85, 120, 160] as const;
export const PRESUPUESTO_INICIAL = 85;

let siguiente = 0;
export const nuevoId = (): string => `f${Date.now().toString(36)}${(siguiente++).toString(36)}`;

/**
 * Habilidades que el motor todavía no aplica. Se pueden poner en la lista
 * para probar sus perfiles, pero conviene saber que su regla especial no está.
 */
export const HABILIDAD_PENDIENTE = new Set(['Avanzadilla', 'Brinco', 'Regeneración', 'Transporte', 'Superioridad', 'Fuego indirecto', 'Poder mental']);

export const valorFila = (f: Fila): number => (TIPOS[f.tipoId]?.valor ?? 0) * f.cantidad;
export const valorDe = (filas: readonly Fila[]): number => filas.reduce((s, f) => s + valorFila(f), 0);

/** Suma unidades a la lista: las del mismo tipo comparten fila. */
export function anadir(filas: readonly Fila[], tipoId: string, cantidad = 1): Fila[] {
  const ya = filas.find((f) => f.tipoId === tipoId);
  if (ya) return filas.map((f) => (f === ya ? { ...f, cantidad: f.cantidad + cantidad } : f));
  return [...filas, { id: nuevoId(), tipoId, cantidad }];
}

/** Comandantes primero, luego lo que forma escuadra y al final lo que va solo. */
export function ordenar(filas: readonly Fila[]): Fila[] {
  const peso = (f: Fila): number => {
    const t = TIPOS[f.tipoId];
    return t?.esComandante ? 0 : t?.escuadra !== null ? 1 : 2;
  };
  return [...filas].sort((a, b) => peso(a) - peso(b));
}

/** Lo que el motor necesita: una entrada por miniatura; todas salen sueltas. */
export function aLista(filas: readonly Fila[]): EntradaLista[] {
  const out: EntradaLista[] = [];
  for (const f of ordenar(filas)) for (let i = 0; i < f.cantidad; i++) out.push({ tipoId: f.tipoId });
  return out;
}

/** Por qué la lista no vale todavía. Vacío si se puede jugar. */
export function problemas(filas: readonly Fila[], presupuesto: number): string[] {
  const out: string[] = [];
  if (filas.length === 0) out.push('La lista está vacía');
  const valor = valorDe(filas);
  if (valor > presupuesto) out.push(`Te pasas de Valor: ${valor} de ${presupuesto}`);
  return out;
}

/**
 * Avisos que no impiden jugar: cuántos soldados podrán ir en escuadra y
 * cuántos irán por libre porque no hay Comandantes para todos.
 */
export function avisos(filas: readonly Fila[]): string[] {
  const comandantes = filas.reduce((s, f) => s + (TIPOS[f.tipoId]?.esComandante ? f.cantidad : 0), 0);
  const tropa = filas.filter((f) => !TIPOS[f.tipoId]?.esComandante && TIPOS[f.tipoId]?.escuadra != null);
  if (tropa.length === 0) return [];
  if (comandantes === 0) return ['Sin Comandante, todo irá suelto: nadie podrá formar escuadra.'];
  // Cada Comandante se lleva la tropa más numerosa que le quede.
  const plazas = tropa
    .map((f) => Math.min(f.cantidad, TIPOS[f.tipoId]!.escuadra!))
    .sort((a, b) => b - a)
    .slice(0, comandantes)
    .reduce((s, n) => s + n, 0);
  const total = tropa.reduce((s, f) => s + f.cantidad, 0);
  const sobran = total - plazas;
  if (sobran <= 0) return [];
  return [sobran === 1 ? '1 soldado no cabe en ninguna escuadra: irá suelto.' : `${sobran} soldados no caben en ninguna escuadra: irán sueltos.`];
}

// ---------------------------------------------------------------- Listas hechas

/** La lista con la que se ha probado el prototipo: 85 de Valor. */
export function listaInicial(): Fila[] {
  return [
    { id: nuevoId(), tipoId: 'comandante-disparo', cantidad: 1 },
    { id: nuevoId(), tipoId: 'comandante-cac', cantidad: 1 },
    { id: nuevoId(), tipoId: 'tirador', cantidad: 4 },
    { id: nuevoId(), tipoId: 'choque', cantidad: 4 },
    { id: nuevoId(), tipoId: 'juggernaut', cantidad: 1 },
  ];
}

export interface Estilo {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string;
  /** Qué compra, en orden: primero los bloques; con lo que sobra, relleno. */
  readonly bloques: readonly { readonly tipoId: string; readonly tropa?: string }[];
  readonly relleno: string;
}

/** Ejércitos para la máquina. Se montan para el Valor que se elija. */
export const ESTILOS: readonly Estilo[] = [
  {
    id: 'marea',
    nombre: 'Marea',
    descripcion: 'Mucha Milicia barata con un Exterminador de punta.',
    bloques: [{ tipoId: 'comandante-cac', tropa: 'milicia' }, { tipoId: 'exterminador' }, { tipoId: 'comandante-disparo', tropa: 'tirador' }],
    relleno: 'milicia',
  },
  {
    id: 'fuego',
    nombre: 'Línea de fuego',
    descripcion: 'Tiradores y un Juggernaut que no se mueven del sitio.',
    bloques: [{ tipoId: 'comandante-disparo', tropa: 'tirador' }, { tipoId: 'juggernaut' }, { tipoId: 'comandante-acorazado', tropa: 'tirador' }],
    relleno: 'tirador',
  },
  {
    id: 'martillo',
    nombre: 'Martillo',
    descripcion: 'Choques y Exterminadores directos al cuerpo a cuerpo.',
    bloques: [{ tipoId: 'comandante-cac', tropa: 'choque' }, { tipoId: 'exterminador' }, { tipoId: 'juggernaut' }],
    relleno: 'choque',
  },
];

/**
 * Monta un estilo para un presupuesto. Cada Comandante se compra con la tropa
 * para la escuadra más grande que quepa —sin pasarse del máximo del tipo ni de
 * un tercio del Valor—, y lo que sobra se llena con más tropa suelta.
 */
export function listaDeEstilo(estilo: Estilo, presupuesto: number): Fila[] {
  let filas: Fila[] = [];
  let resto = presupuesto;
  for (const b of estilo.bloques) {
    const t = TIPOS[b.tipoId];
    if (!t || t.valor > resto) continue;
    filas = anadir(filas, t.id);
    resto -= t.valor;
    if (b.tropa) {
      const tropa = TIPOS[b.tropa]!;
      const tope = Math.min(tropa.escuadra ?? 0, Math.floor((presupuesto / 3 - t.valor) / tropa.valor));
      const n = Math.max(0, Math.min(tope, Math.floor(resto / tropa.valor)));
      if (n > 0) filas = anadir(filas, tropa.id, n);
      resto -= n * tropa.valor;
    }
  }
  const relleno = TIPOS[estilo.relleno];
  if (relleno && relleno.valor <= resto) filas = anadir(filas, relleno.id, Math.floor(resto / relleno.valor));
  return ordenar(filas);
}

// ------------------------------------------------------------------ Aleatoria

/** La tropa que mejor casa con cada Comandante: no obliga, solo pesa más. */
const AFINIDAD: Record<string, readonly string[]> = {
  'comandante-disparo': ['tirador', 'armas-pesadas', 'milicia'],
  'comandante-cac': ['choque', 'exterminador', 'milicia'],
  'comandante-psiquico': ['psiquico', 'tirador', 'milicia'],
  'comandante-acorazado': ['juggernaut', 'tirador', 'armas-pesadas'],
};

function elegir<T>(azar: () => number, opciones: readonly T[], peso: (x: T) => number): T | undefined {
  const total = opciones.reduce((s, x) => s + peso(x), 0);
  if (total <= 0) return undefined;
  let r = azar() * total;
  for (const x of opciones) {
    r -= peso(x);
    if (r < 0) return x;
  }
  return opciones[opciones.length - 1];
}

const programado = (t: TipoUnidad): boolean => !HABILIDAD_PENDIENTE.has(t.habilidad);

/**
 * Una lista al azar pero con sentido: uno a tres Comandantes, cada uno con
 * soldados de sobra para una escuadra que encaje con él, quizá una pieza
 * pesada, y lo que sobre en más tropa. Se prefieren las unidades cuya regla ya
 * está programada.
 */
export function listaAleatoria(presupuesto: number, azar: () => number = Math.random): Fila[] {
  const todos = Object.values(TIPOS);
  const comandantes = todos.filter((t) => t.esComandante);
  const escuadrables = todos.filter((t) => !t.esComandante && t.escuadra !== null);
  const pesadas = todos.filter((t) => !t.esComandante && t.escuadra === null && t.valor <= presupuesto / 3);

  let filas: Fila[] = [];
  let resto = presupuesto;
  const tropas: TipoUnidad[] = [];

  const cuantos = Math.max(1, Math.round(presupuesto / 55) - (azar() < 0.3 ? 1 : 0));
  // Lo que se reserva para las escuadras: el resto es para pesadas y relleno.
  const porEscuadra = (presupuesto * 0.75) / cuantos;
  for (let i = 0; i < cuantos; i++) {
    const c = elegir(azar, comandantes.filter((t) => t.valor <= resto), (t) => (programado(t) ? 3 : 1));
    if (!c) break;
    const hueco = Math.min(porEscuadra, resto) - c.valor;
    // Una tropa con la que quepan al menos dos soldados; si no, el Comandante va solo.
    const tropa = elegir(
      azar,
      escuadrables.filter((t) => t.valor * 2 <= hueco),
      (t) => (programado(t) ? 4 : 1) * (AFINIDAD[c.id]?.includes(t.id) ? 3 : 1),
    );
    filas = anadir(filas, c.id);
    resto -= c.valor;
    if (!tropa) continue;
    const n = Math.min(tropa.escuadra!, Math.floor(hueco / tropa.valor));
    filas = anadir(filas, tropa.id, n);
    resto -= n * tropa.valor;
    tropas.push(tropa);
  }

  // A veces, una pieza pesada que vaya por su cuenta.
  if (azar() < 0.6) {
    const p = elegir(azar, pesadas.filter((t) => t.valor <= resto), (t) => (programado(t) ? 4 : 1));
    if (p) {
      filas = anadir(filas, p.id);
      resto -= p.valor;
    }
  }

  // Con lo que quede, completar escuadras y, si aún sobra, tropa suelta barata.
  for (const t of tropas) {
    const tengo = filas.find((f) => f.tipoId === t.id)?.cantidad ?? 0;
    const capacidad = t.escuadra! * tropas.filter((x) => x === t).length;
    const n = Math.max(0, Math.min(capacidad - tengo, Math.floor(resto / t.valor)));
    if (n > 0) {
      filas = anadir(filas, t.id, n);
      resto -= n * t.valor;
    }
  }
  const baratas = escuadrables.filter(programado).sort((a, b) => a.valor - b.valor);
  for (const t of baratas) {
    const n = Math.floor(resto / t.valor);
    if (n > 0) {
      filas = anadir(filas, t.id, n);
      resto -= n * t.valor;
    }
  }
  return ordenar(filas);
}

// ------------------------------------------------------------ Recordar la lista

const CLAVE = 'zerolore.lista.v1';

/** El formato anterior: el Comandante llevaba su escuadra dentro de su fila. */
interface FilaAntigua {
  readonly k?: 'comandante' | 'suelta';
  readonly tipoId: string;
  readonly tropa?: string | null;
  readonly cantidad: number;
}

export function cargarLista(): { filas: Fila[]; presupuesto: number } | null {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return null;
    const datos = JSON.parse(raw) as { filas?: FilaAntigua[]; presupuesto?: number };
    let filas: Fila[] = [];
    for (const f of datos.filas ?? []) {
      if (!TIPOS[f.tipoId]) continue;
      if (f.k === 'comandante') {
        filas = anadir(filas, f.tipoId);
        if (f.tropa && TIPOS[f.tropa] && f.cantidad > 0) filas = anadir(filas, f.tropa, f.cantidad);
      } else if (f.cantidad > 0) {
        filas = anadir(filas, f.tipoId, f.cantidad);
      }
    }
    return { filas: ordenar(filas), presupuesto: datos.presupuesto ?? PRESUPUESTO_INICIAL };
  } catch {
    return null;
  }
}

export function guardarLista(filas: readonly Fila[], presupuesto: number): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ filas, presupuesto }));
  } catch {
    // Sin almacenamiento solo se pierde el recordarla.
  }
}
