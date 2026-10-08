import {
  ACTION_COST,
  DISTANCIA_ENEMIGO,
  Engine,
  add,
  anclaDe,
  centerDistance,
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
 * Hacia dónde iría la unidad si su Comandante va a `cursor`. Si el cursor se
 * pasa del alcance, el Comandante se queda en el borde, en línea con él.
 */
export function colocarMovimiento(
  estado: GameState,
  unidadId: string,
  accion: 'Mover' | 'Correr',
  cursor: Vec2,
): Colocacion {
  const e = consulta(estado, unidadId);
  const u = e.getState().unidades[unidadId]!;
  const ancla = anclaDe(u);
  const alcance = e.alcanceDe(u, accion);
  let destino = cursor;
  const d = centerDistance(ancla.posicion, cursor);
  if (d > alcance) destino = add(ancla.posicion, scale(normalize(sub(cursor, ancla.posicion)), alcance));

  const R = restriccionesPara(e.getState(), u.owner, u.id, DISTANCIA_ENEMIGO);
  const piezas = e.piezasDe(u);
  // Del sitio pedido hacia atrás, por si con un muro en medio no llega.
  for (const f of [1, 0.9, 0.8, 0.65, 0.5]) {
    const objetivo = add(ancla.posicion, scale(sub(destino, ancla.posicion), f));
    const pos = formar(piezas, objetivo, R, alcance);
    if (pos) return revisarColocacion(estado, unidadId, accion, pos);
  }
  // No cabe: se enseña en rojo donde quedaría en bloque.
  const enBloque: Record<string, Vec2> = {};
  const delta = sub(destino, ancla.posicion);
  for (const m of u.minis) enBloque[m.id] = add(m.posicion, delta);
  return revisarColocacion(estado, unidadId, accion, enBloque);
}

/** Valida una colocación miniatura a miniatura, para pintar en rojo la que falla. */
export function revisarColocacion(
  estado: GameState,
  unidadId: string,
  accion: 'Mover' | 'Correr',
  posiciones: Record<string, Vec2>,
): Colocacion {
  const e = consulta(estado, unidadId);
  const u = e.getState().unidades[unidadId]!;
  const alcance = e.alcanceDe(u, accion);
  const R = restriccionesPara(e.getState(), u.owner, u.id, DISTANCIA_ENEMIGO);
  const malas = new Set<string>();
  const colocadas: { centro: Vec2; radio: number }[] = [];
  for (const m of u.minis) {
    const p = posiciones[m.id]!;
    const r = TIPOS[m.tipoId]!.radioPeana;
    const camino = recorrido(m.posicion, p, r, R.terreno);
    if (camino === null || camino > alcance + 1e-6 || motivoSitio(p, r, R, colocadas) !== null) malas.add(m.id);
    colocadas.push({ centro: p, radio: r });
  }
  // Si se rompe la coherencia, en rojo solo las que quedan fuera de la cadena del Comandante.
  for (const id of fueraDeLaCadena(u, posiciones)) malas.add(id);
  const motivo = e.motivoPosiciones(u, posiciones, alcance, DISTANCIA_ENEMIGO);
  return { posiciones, malas, motivo };
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

/** El Comandante propio bajo el cursor que puede recibir esta miniatura. */
export function comandanteParaRefuerzo(estado: GameState, reservaId: string, cursor: Vec2): Unidad | null {
  const e = new Engine(estado);
  let mejor: Unidad | null = null;
  let d = Infinity;
  for (const u of Object.values(estado.unidades)) {
    if (e.motivoRefuerzo(u, reservaId) !== null) continue;
    for (const m of u.minis) {
      const dm = centerDistance(m.posicion, cursor);
      if (dm < 3 && dm < d) {
        d = dm;
        mejor = u;
      }
    }
  }
  return mejor;
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
