import {
  ACTION_COST,
  DISTANCIA_ENEMIGO,
  Engine,
  add,
  anclaDe,
  centerDistance,
  comandanteDe,
  COHERENCIA,
  formar,
  motivoSitio,
  normalize,
  piniaAlrededor,
  puedeDesplegarEn,
  recorrido,
  restriccionesPara,
  scale,
  sub,
  tocaPuesto,
  vec,
  esCoherente,
  type ActionKind,
  type GameState,
  type Mini,
  type Pieza,
  type PlayerId,
  type Unidad,
  type Vec2,
} from '@zerolore/core';
import { TIPOS } from './partida.ts';

/**
 * Lo que la interfaz necesita preguntar al motor, en un sitio. Ninguna regla
 * se reimplementa aquí: todo sale de los `motivo…` del motor, que son los
 * mismos que deciden si una orden es legal.
 */

/**
 * Un motor de consulta con la unidad ya activada. Así la rueda puede enseñar
 * qué podría hacer una unidad ANTES de activarla: la activación es implícita
 * y se produce con la primera acción que se confirme.
 */
export function consulta(estado: GameState, unidadId: string | null): Engine {
  const e = new Engine(estado);
  if (unidadId && estado.unidadActiva !== unidadId) e.execute({ type: 'ActivarUnidad', unidadId });
  return e;
}

export interface AccionUI {
  readonly kind: ActionKind;
  readonly disponible: boolean;
  readonly motivo: string | null;
  readonly coste: number;
}

const ORDEN: ActionKind[] = ['Mover', 'Correr', 'Disparar', 'Cargar', 'AtacarCaC', 'Destrabarse'];

/** ¿Puede activarse ahora? `null` si sí. */
export function motivoActivar(estado: GameState, u: Unidad, humano: PlayerId): string | null {
  if (u.owner !== humano) return 'no es tuya';
  if (estado.fase !== 'Activaciones') return 'aún no se juega';
  if (estado.jugadorActivo !== humano) return 'no es tu turno';
  if (estado.unidadActiva && estado.unidadActiva !== u.id) return 'hay otra unidad a medias';
  if (u.activada) return 'ya ha jugado este turno';
  return null;
}

export function accionesDe(estado: GameState, unidadId: string): AccionUI[] {
  const e = consulta(estado, unidadId);
  const u = e.getState().unidades[unidadId];
  if (!u) return [];
  const enemigos = Object.values(e.getState().unidades).filter((o) => o.owner !== u.owner);
  return ORDEN.map((kind) => {
    let motivo = e.motivoAccion(unidadId, kind);
    if (!motivo && kind === 'Disparar' && !enemigos.some((o) => e.motivoDisparo(unidadId, o.id) === null)) {
      motivo = 'nadie a tiro';
    }
    if (!motivo && kind === 'Cargar' && !enemigos.some((o) => e.motivoCarga(unidadId, o.id) === null)) {
      motivo = `nadie a ${e.alcanceDe(u, 'Cargar')}"`;
    }
    if (kind === 'AtacarCaC' && u.ataqueGratuitoContra) motivo = null;
    return { kind, disponible: motivo === null, motivo, coste: ACTION_COST[kind] };
  });
}

export function objetivosPara(estado: GameState, unidadId: string, accion: 'Disparar' | 'Cargar' | 'AtacarCaC'): string[] {
  const e = consulta(estado, unidadId);
  return Object.values(e.getState().unidades)
    .filter((o) => {
      const u = e.getState().unidades[unidadId];
      if (!u || o.owner === u.owner) return false;
      if (accion === 'Disparar') return e.motivoDisparo(unidadId, o.id) === null;
      if (accion === 'Cargar') return e.motivoCarga(unidadId, o.id) === null;
      return e.motivoCaC(unidadId, o.id) === null;
    })
    .map((o) => o.id);
}

// ---------------------------------------------------------------- Movimiento

export interface Colocacion {
  /** Posición propuesta de cada miniatura. */
  readonly posiciones: Record<string, Vec2>;
  /** Miniaturas que no pueden ir donde están. */
  readonly malas: ReadonlySet<string>;
  /** `null` si todo vale. */
  readonly motivo: string | null;
}

/**
 * Cómo se desplaza una unidad: moviendo o corriendo en su activación, o
 * recolocándose en el despliegue inicial (sin límite, tocando su puesto).
 */
export type Desplazamiento = 'Mover' | 'Correr' | 'Recolocar';

/** El motor al que preguntar y el alcance: recolocar no activa ni tiene tope. */
function paraDesplazar(estado: GameState, unidadId: string, accion: Desplazamiento): { e: Engine; u: Unidad; alcance: number | null } {
  const e = accion === 'Recolocar' ? new Engine(estado) : consulta(estado, unidadId);
  const u = e.getState().unidades[unidadId]!;
  return { e, u, alcance: accion === 'Recolocar' ? null : e.alcanceDe(u, accion) };
}

/**
 * Hacia dónde iría la unidad si su Comandante va a `cursor`, conservando la
 * formación de `actual` (por defecto, donde está). Si el cursor se pasa del
 * alcance, el Comandante se queda en el borde, en línea con él.
 */
export function colocarMovimiento(
  estado: GameState,
  unidadId: string,
  accion: Desplazamiento,
  cursor: Vec2,
  actual?: Readonly<Record<string, Vec2>>,
): Colocacion {
  const { e, u, alcance } = paraDesplazar(estado, unidadId, accion);
  const ancla = anclaDe(u);
  let destino = cursor;
  const d = centerDistance(ancla.posicion, cursor);
  if (alcance !== null && d > alcance) destino = add(ancla.posicion, scale(normalize(sub(cursor, ancla.posicion)), alcance));

  const R = restriccionesPara(e.getState(), u.owner, u.id, DISTANCIA_ENEMIGO);
  // Con una formación ya hecha a mano, se lleva tal cual: el Comandante tira de ella.
  const piezas = e.piezasDe(u).map((p) => ({ ...p, desde: actual?.[p.id] ?? p.desde }));
  const origen = actual?.[ancla.id] ?? ancla.posicion;
  // Del sitio pedido hacia atrás, por si con un muro en medio no llega.
  for (const f of [1, 0.9, 0.8, 0.65, 0.5]) {
    const objetivo = add(origen, scale(sub(destino, origen), f));
    const pos = formar(piezas, objetivo, R, actual ? null : alcance);
    if (pos) return revisarColocacion(estado, unidadId, accion, pos);
  }
  // No cabe: se enseña en rojo donde quedaría en bloque.
  const enBloque: Record<string, Vec2> = {};
  const delta = sub(destino, origen);
  for (const p of piezas) enBloque[p.id] = add(p.desde, delta);
  return revisarColocacion(estado, unidadId, accion, enBloque);
}

/** Valida una colocación miniatura a miniatura, para pintar en rojo la que falla. */
export function revisarColocacion(
  estado: GameState,
  unidadId: string,
  accion: Desplazamiento,
  posiciones: Record<string, Vec2>,
): Colocacion {
  const { e, u, alcance } = paraDesplazar(estado, unidadId, accion);
  const R = restriccionesPara(e.getState(), u.owner, u.id, DISTANCIA_ENEMIGO);
  const malas = new Set<string>();
  const colocadas: { centro: Vec2; radio: number }[] = [];
  for (const m of u.minis) {
    const p = posiciones[m.id]!;
    const r = TIPOS[m.tipoId]!.radioPeana;
    if (alcance !== null) {
      const camino = recorrido(m.posicion, p, r, R.terreno);
      if (camino === null || camino > alcance + 1e-6) malas.add(m.id);
    }
    if (motivoSitio(p, r, R, colocadas) !== null) malas.add(m.id);
    colocadas.push({ centro: p, radio: r });
  }
  // Si se rompe la coherencia, en rojo solo las que quedan fuera de la cadena del Comandante.
  for (const id of fueraDeLaCadena(u, posiciones)) malas.add(id);
  const motivo = accion === 'Recolocar'
    ? e.motivoRecolocar(u, posiciones)
    : e.motivoPosiciones(u, posiciones, alcance, DISTANCIA_ENEMIGO);
  // Recolocando, el Comandante que se sale del puesto también va en rojo.
  if (accion === 'Recolocar' && motivo?.includes('puesto')) malas.add(anclaDe(u).id);
  return { posiciones, malas, motivo };
}

// ------------------------------------------------------------------ La cadena

/** Un eslabón de la cadena de coherencia, de borde a borde de peana. */
export interface Eslabon {
  readonly a: Vec2;
  readonly ra: number;
  readonly b: Vec2;
  readonly rb: number;
  /** Hueco entre las dos peanas, en pulgadas. */
  readonly hueco: number;
  /**
   * 'nuevo': la miniatura que se está colocando; 'camino': los eslabones de
   * ella hasta el Comandante; 'roto': a más de 1" de la cadena; 'ok': el resto.
   */
  readonly tipo: 'ok' | 'camino' | 'nuevo' | 'roto';
}

export interface PiezaCadena {
  readonly id: string;
  readonly centro: Vec2;
  readonly radio: number;
}

/**
 * Quién engancha con quién. Se crece desde el Comandante cogiendo siempre el
 * eslabón más corto (un árbol de expansión mínimo): cada miniatura queda
 * colgada de la que tiene más cerca dentro de la cadena. Las que no llegan
 * a 1" de nadie se unen con un eslabón roto a la más cercana, para ver cuánto
 * les falta. Si hay una `destacada`, se marca su camino hasta el Comandante.
 */
export function cadenaDe(piezas: readonly PiezaCadena[], anclaId: string, destacada: string | null): Eslabon[] {
  const hueco = (p: PiezaCadena, q: PiezaCadena): number =>
    Math.max(0, centerDistance(p.centro, q.centro) - p.radio - q.radio);
  const padre = new Map<string, string>();
  const dentro = new Set([anclaId]);
  const porId = new Map(piezas.map((p) => [p.id, p]));
  if (!porId.has(anclaId)) return [];
  for (;;) {
    let mejor: { de: string; a: string; h: number } | null = null;
    for (const p of piezas) {
      if (dentro.has(p.id)) continue;
      for (const id of dentro) {
        const h = hueco(p, porId.get(id)!);
        if (h <= COHERENCIA + 1e-9 && (!mejor || h < mejor.h)) mejor = { de: p.id, a: id, h };
      }
    }
    if (!mejor) break;
    dentro.add(mejor.de);
    padre.set(mejor.de, mejor.a);
  }
  // El camino de la destacada hasta el Comandante.
  const camino = new Set<string>();
  for (let id = destacada ? padre.get(destacada) : undefined; id && id !== anclaId; id = padre.get(id)) camino.add(id);

  const out: Eslabon[] = [];
  for (const p of piezas) {
    if (p.id === anclaId) continue;
    let q: PiezaCadena | undefined;
    let tipo: Eslabon['tipo'];
    if (dentro.has(p.id)) {
      q = porId.get(padre.get(p.id)!)!;
      tipo = p.id === destacada ? 'nuevo' : camino.has(p.id) ? 'camino' : 'ok';
    } else {
      // Suelta: hacia la más cercana de la cadena.
      q = [...dentro].map((id) => porId.get(id)!).sort((x, y) => hueco(p, x) - hueco(p, y))[0];
      tipo = 'roto';
    }
    if (q) out.push({ a: p.centro, ra: p.radio, b: q.centro, rb: q.radio, hueco: hueco(p, q), tipo });
  }
  return out;
}

/** Las piezas de una unidad para la cadena, con posiciones propuestas si las hay. */
export function piezasCadena(u: Unidad, posiciones?: Readonly<Record<string, Vec2>>): PiezaCadena[] {
  return u.minis.map((m) => ({ id: m.id, centro: posiciones?.[m.id] ?? m.posicion, radio: TIPOS[m.tipoId]!.radioPeana }));
}

/** Miniaturas que no quedan unidas al Comandante por la cadena de 1". */
function fueraDeLaCadena(u: Unidad, posiciones: Record<string, Vec2>): string[] {
  const ancla = anclaDe(u);
  const piezas = u.minis.map((m) => ({ id: m.id, c: posiciones[m.id]!, r: TIPOS[m.tipoId]!.radioPeana }));
  const unidas = new Set([ancla.id]);
  let crece = true;
  while (crece) {
    crece = false;
    for (const p of piezas) {
      if (unidas.has(p.id)) continue;
      const toca = piezas.some((q) => unidas.has(q.id) && Math.hypot(p.c.x - q.c.x, p.c.y - q.c.y) - p.r - q.r <= 1 + 1e-9);
      if (toca) {
        unidas.add(p.id);
        crece = true;
      }
    }
  }
  return piezas.filter((p) => !unidas.has(p.id)).map((p) => p.id);
}

// ---------------------------------------------------------------- Despliegue

export interface ColocacionDespliegue {
  readonly posiciones: Vec2[];
  readonly puestoId: string | null;
  readonly valida: boolean;
}

/** Cómo quedaría una entrada de la Reserva con su ancla en `cursor`. */
export function colocarDespliegue(estado: GameState, reservaId: string, cursor: Vec2): ColocacionDespliegue | null {
  const entrada = estado.reserva.find((r) => r.id === reservaId);
  if (!entrada) return null;
  const iAncla = Math.max(0, entrada.minis.findIndex((m) => m.esComandante));
  const radios = entrada.minis.map((m) => TIPOS[m.tipoId]!.radioPeana);
  const rAncla = radios[iAncla]!;

  const puesto = estado.puestos.find(
    (p) => puedeDesplegarEn(estado, p, entrada.owner) && tocaPuesto(p, cursor, rAncla),
  );
  // La piña se abre hacia atrás: lejos del centro de la mesa.
  const atras = normalize(sub(cursor, vec(estado.mesa.ancho / 2, estado.mesa.alto / 2)));
  const desfases = piniaAlrededor(rAncla, radios.filter((_, i) => i !== iAncla), atras);
  let k = 0;
  const piezas: Pieza[] = entrada.minis.map((_, i) => ({
    id: String(i),
    radio: radios[i]!,
    desde: i === iAncla ? cursor : add(cursor, desfases[k++]!),
    esAncla: i === iAncla,
  }));
  const R = restriccionesPara(estado, entrada.owner, null, DISTANCIA_ENEMIGO);
  const pos = formar(piezas, cursor, R, null);
  if (pos) {
    return { posiciones: entrada.minis.map((_, i) => pos[String(i)]!), puestoId: puesto?.id ?? null, valida: !!puesto };
  }
  return { posiciones: piezas.map((p) => p.desde), puestoId: puesto?.id ?? null, valida: false };
}

/**
 * El Comandante propio más cercano al cursor (a 3" o menos) y, si no puede
 * recibir esta miniatura, por qué: así soltar un Élite sobre una escuadra de
 * Milicia dice que está ocupada en vez de no hacer nada.
 */
export function comandanteCercano(estado: GameState, reservaId: string, cursor: Vec2): { u: Unidad; motivo: string | null } | null {
  const r = estado.reserva.find((x) => x.id === reservaId);
  if (!r) return null;
  const e = new Engine(estado);
  const cerca: { u: Unidad; motivo: string | null; d: number }[] = [];
  for (const u of Object.values(estado.unidades)) {
    if (u.owner !== r.owner || !comandanteDe(u)) continue;
    const d = Math.min(...u.minis.map((m) => centerDistance(m.posicion, cursor)));
    if (d < 3) cerca.push({ u, motivo: e.motivoRefuerzo(u, reservaId), d });
  }
  cerca.sort((a, b) => a.d - b.d);
  const masCerca = cerca[0];
  if (!masCerca) return null;
  // Entre dos escuadras pegadas se prefiere la que sí la admite.
  const admite = cerca.find((c) => c.motivo === null && c.d <= masCerca.d + 1);
  const elegido = admite ?? masCerca;
  return { u: elegido.u, motivo: elegido.motivo };
}

/** El Comandante propio bajo el cursor que puede recibir esta miniatura. */
export function comandanteParaRefuerzo(estado: GameState, reservaId: string, cursor: Vec2): Unidad | null {
  const c = comandanteCercano(estado, reservaId, cursor);
  return c && c.motivo === null ? c.u : null;
}

/** Hueco para el refuerzo pegado a la escuadra, lo más cerca del cursor posible. */
export function huecoDeRefuerzo(estado: GameState, u: Unidad, tipoId: string, cursor: Vec2): Vec2 | null {
  const r = TIPOS[tipoId]!.radioPeana;
  const R = restriccionesPara(estado, u.owner, u.id, DISTANCIA_ENEMIGO);
  const propias = u.minis.map((m) => ({ centro: m.posicion, radio: TIPOS[m.tipoId]!.radioPeana }));
  let mejor: Vec2 | null = null;
  let d = Infinity;
  const candidatos: Vec2[] = [cursor];
  for (const m of propias) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      candidatos.push(vec(m.centro.x + Math.cos(a) * (m.radio + r + 0.15), m.centro.y + Math.sin(a) * (m.radio + r + 0.15)));
    }
  }
  for (const p of candidatos) {
    if (motivoSitio(p, r, R, propias) !== null) continue;
    if (!esCoherente([...propias, { centro: p, radio: r }])) continue;
    const dp = centerDistance(p, cursor);
    if (dp < d) {
      d = dp;
      mejor = p;
    }
  }
  return mejor;
}

// ----------------------------------------------------------------- Disparo

/** Flechas del tiro: de cada miniatura que dispara a la enemiga más cercana. */
export function trayectorias(estado: GameState, unidadId: string, objetivoId: string, modo: 'disparo' | 'cac' | 'carga'): { desde: Vec2; hasta: Vec2 }[] {
  const e = consulta(estado, unidadId);
  const u = e.getState().unidades[unidadId];
  const o = e.getState().unidades[objetivoId];
  if (!u || !o) return [];
  const cercana = (m: Mini): Vec2 => {
    let mejor = o.minis[0]!.posicion;
    let d = Infinity;
    for (const x of o.minis) {
      const dx = centerDistance(m.posicion, x.posicion);
      if (dx < d) {
        d = dx;
        mejor = x.posicion;
      }
    }
    return mejor;
  };
  if (modo !== 'disparo') return [{ desde: anclaDe(u).posicion, hasta: cercana(anclaDe(u)) }];
  const tiradores = e.situacionesDisparo(u, o).flatMap((s) => s.minis);
  return tiradores.slice(0, 6).map((m) => ({ desde: m.posicion, hasta: cercana(m) }));
}

/** Escenografía que cubre al objetivo frente a esta unidad, para iluminarla. */
export function coberturasDelTiro(estado: GameState, unidadId: string, objetivoId: string): string[] {
  const e = consulta(estado, unidadId);
  const u = e.getState().unidades[unidadId];
  const o = e.getState().unidades[objetivoId];
  if (!u || !o) return [];
  const ids = new Set<string>();
  for (const s of e.situacionesDisparo(u, o)) {
    if (!s.situacion.enCobertura) continue;
    for (const t of estado.terreno) if (t.tipo === 'cobertura') ids.add(t.id);
  }
  // Solo las que tocan al objetivo.
  return [...ids].filter((id) => {
    const t = estado.terreno.find((x) => x.id === id)!;
    return o.minis.some((m) => {
      const r = TIPOS[m.tipoId]!.radioPeana;
      const cx = Math.max(t.rect.x, Math.min(m.posicion.x, t.rect.x + t.rect.width));
      const cy = Math.max(t.rect.y, Math.min(m.posicion.y, t.rect.y + t.rect.height));
      return Math.hypot(m.posicion.x - cx, m.posicion.y - cy) <= r + 1e-6;
    });
  });
}

/** Alcance del arma de la unidad: un círculo por miniatura con arma a distancia. */
export function alcances(estado: GameState, unidadId: string): { centro: Vec2; radio: number }[] {
  const u = estado.unidades[unidadId];
  if (!u) return [];
  return u.minis.flatMap((m) => {
    const t = TIPOS[m.tipoId]!;
    return t.disparo ? [{ centro: m.posicion, radio: t.disparo.distancia + t.radioPeana }] : [];
  });
}
