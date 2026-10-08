import { Engine, distanciaEntre, type Command } from './engine.ts';
import { add, centerDistance, normalize, scale, sub, vec, type Vec2 } from './geometry.ts';
import { esCoherente, formar, motivoSitio, piniaAlrededor, restriccionesPara, type Pieza } from './rules/formacion.ts';
import { puedeDesplegarEn, tocaPuesto } from './rules/puestos.ts';
import {
  DISTANCIA_ENEMIGO,
  anclaDe,
  comandanteDe,
  tipoDe,
  type GameState,
  type PlayerId,
  type Puesto,
  type Unidad,
} from './types.ts';

/**
 * Una IA sencilla para jugar contra ella y para que dos partidas se jueguen
 * solas. No planifica: en cada momento hace lo que parece mejor ahora mismo.
 *
 * Prioridades de una unidad activada:
 *   1. Rematar el ataque gratuito de una carga, o pelear si está trabada.
 *   2. Disparar a lo que más Valor se pueda llevar por delante.
 *   3. Cargar si es de cuerpo a cuerpo y hay alguien a tiro.
 *   4. Moverse: hacia el enemigo más cercano si pega de cerca; si dispara,
 *      hasta tenerlo a tiro.
 */
export interface Jugada {
  readonly cmd: Command;
  /** Para el registro: por qué hace esto. */
  readonly motivo: string;
}

export function siguienteJugada(state: GameState, jugador: PlayerId): Jugada | null {
  if (state.fase === 'Terminada') return null;
  if (state.fase === 'Iniciativa') return { cmd: { type: 'TirarIniciativa' }, motivo: 'empieza el turno' };
  if (state.fase === 'FinDeTurno') return { cmd: { type: 'TerminarTurno' }, motivo: 'se acaba el turno' };
  if (state.jugadorActivo !== jugador) return null;

  const e = new Engine(state);
  if (state.fase === 'Despliegue') return jugadaDeDespliegue(e, jugador);

  const activa = state.unidadActiva ? state.unidades[state.unidadActiva] : undefined;
  if (activa) return jugadaDeUnidad(e, activa) ?? { cmd: { type: 'TerminarActivacion', unidadId: activa.id }, motivo: 'nada más que hacer' };

  const siguiente = elegirUnidad(e, jugador);
  return siguiente ? { cmd: { type: 'ActivarUnidad', unidadId: siguiente.id }, motivo: 'le toca' } : null;
}

// ---------------------------------------------------------------- Despliegue

function jugadaDeDespliegue(e: Engine, jugador: PlayerId): Jugada {
  const s = e.getState();

  // Primero los refuerzos: engordar una escuadra que ya está en mesa.
  for (const u of Object.values(s.unidades)) {
    if (u.owner !== jugador || !comandanteDe(u)) continue;
    for (const r of s.reserva) {
      if (e.motivoRefuerzo(u, r.id) !== null) continue;
      const sitio = huecoJuntoA(e, u, r.minis[0]!.tipoId);
      if (sitio) return { cmd: { type: 'Reforzar', unidadId: u.id, reservaId: r.id, posicion: sitio }, motivo: `refuerza a ${u.id}` };
    }
  }

  // Después, sacar la unidad de más Valor por el puesto más adelantado.
  const puestos = s.puestos
    .filter((p) => puedeDesplegarEn(s, p, jugador))
    .sort((a, b) => Number(a.esCuartelGeneral) - Number(b.esCuartelGeneral));
  const reservas = s.reserva
    .filter((r) => r.owner === jugador)
    .sort((a, b) => valorReserva(s, b) - valorReserva(s, a));
  for (const p of puestos) {
    for (const r of reservas) {
      const posiciones = posicionesDeDespliegue(e, r.id, p);
      if (posiciones) {
        return { cmd: { type: 'Desplegar', reservaId: r.id, puestoId: p.id, posiciones }, motivo: `sale por ${p.id}` };
      }
    }
  }
  return { cmd: { type: 'PasarDespliegue', jugador }, motivo: 'no despliega más' };
}

function valorReserva(s: GameState, r: GameState['reserva'][number]): number {
  return r.minis.reduce((t, m) => t + (s.tipos[m.tipoId]?.valor ?? 0), 0);
}

/** Dónde meter una miniatura de refuerzo pegada a la escuadra. */
export function huecoJuntoA(e: Engine, u: Unidad, tipoId: string): Vec2 | null {
  const s = e.getState();
  const r = s.tipos[tipoId]!.radioPeana;
  const R = restriccionesPara(s, u.owner, u.id, DISTANCIA_ENEMIGO);
  const propias = u.minis.map((m) => ({ centro: m.posicion, radio: s.tipos[m.tipoId]!.radioPeana }));
  for (const m of propias) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const p = vec(m.centro.x + Math.cos(a) * (m.radio + r + 0.15), m.centro.y + Math.sin(a) * (m.radio + r + 0.15));
      if (motivoSitio(p, r, R, propias) !== null) continue;
      if (esCoherente([...propias, { centro: p, radio: r }])) return p;
    }
  }
  return null;
}

/**
 * Posiciones para desplegar una entrada de la Reserva en un puesto: el ancla
 * tocando el puesto y el resto en piña detrás, mirando hacia el enemigo.
 */
export function posicionesDeDespliegue(e: Engine, reservaId: string, p: Puesto): Vec2[] | null {
  const s = e.getState();
  const entrada = s.reserva.find((r) => r.id === reservaId);
  if (!entrada) return null;
  const iAncla = Math.max(0, entrada.minis.findIndex((m) => m.esComandante));
  const radios = entrada.minis.map((m) => s.tipos[m.tipoId]!.radioPeana);
  const rAncla = radios[iAncla]!;
  const haciaCentro = normalize(sub(vec(s.mesa.ancho / 2, s.mesa.alto / 2), p.centro));
  const atras = scale(haciaCentro, -1);
  const R = restriccionesPara(s, entrada.owner, null, DISTANCIA_ENEMIGO);

  // Se prueban anclas por el puesto, del centro hacia fuera.
  const anclas: Vec2[] = [p.centro];
  for (const d of [1, 2, p.radio]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      anclas.push(add(p.centro, vec(Math.cos(a) * d, Math.sin(a) * d)));
    }
  }
  const otros = radios.filter((_, i) => i !== iAncla);
  const desfases = piniaAlrededor(rAncla, otros, atras);
  for (const ancla of anclas) {
    if (!tocaPuesto(p, ancla, rAncla)) continue;
    let k = 0;
    const piezas: Pieza[] = entrada.minis.map((_, i) => ({
      id: String(i),
      radio: radios[i]!,
      desde: i === iAncla ? ancla : add(ancla, desfases[k++]!),
      esAncla: i === iAncla,
    }));
    const pos = formar(piezas, ancla, R, null);
    if (pos) return entrada.minis.map((_, i) => pos[String(i)]!);
  }
  return null;
}

// --------------------------------------------------------------- Activación

/** Primero lo que está trabado; después lo que ya tiene a quién disparar. */
function elegirUnidad(e: Engine, jugador: PlayerId): Unidad | null {
  const s = e.getState();
  const mias = Object.values(s.unidades).filter((u) => u.owner === jugador && !u.activada);
  const trabada = mias.find((u) => u.trabadaCon.length > 0);
  if (trabada) return trabada;
  return mias[0] ?? null;
}

function jugadaDeUnidad(e: Engine, u: Unidad): Jugada | null {
  const s = e.getState();

  if (u.ataqueGratuitoContra) {
    return { cmd: { type: 'AtacarCaC', unidadId: u.id, objetivoId: u.ataqueGratuitoContra }, motivo: 'golpe de la carga' };
  }

  if (u.trabadaCon.length > 0) {
    const objetivo = mejorObjetivo(e, u, u.trabadaCon, 'cac');
    if (objetivo && e.motivoCaC(u.id, objetivo) === null) {
      return { cmd: { type: 'AtacarCaC', unidadId: u.id, objetivoId: objetivo }, motivo: 'pelea' };
    }
    if (e.motivoAccion(u.id, 'Destrabarse') === null) {
      return { cmd: { type: 'Destrabarse', unidadId: u.id }, motivo: 'intenta salir' };
    }
    return null;
  }

  const enemigos = Object.values(s.unidades).filter((x) => x.owner !== u.owner);
  if (enemigos.length === 0) return null;

  // Disparar a lo que más rente.
  const aTiro = enemigos.filter((o) => e.motivoDisparo(u.id, o.id) === null).map((o) => o.id);
  const tiro = mejorObjetivo(e, u, aTiro, 'disparo');
  if (tiro) return { cmd: { type: 'Disparar', unidadId: u.id, objetivoId: tiro }, motivo: 'dispara' };

  // Cargar si pega más de cerca que de lejos.
  if (prefiereCuerpoACuerpo(e, u)) {
    const aCarga = enemigos.filter((o) => e.motivoCarga(u.id, o.id) === null).map((o) => o.id);
    const carga = mejorObjetivo(e, u, aCarga, 'carga');
    if (carga) return { cmd: { type: 'Cargar', unidadId: u.id, objetivoId: carga }, motivo: 'carga' };
  }

  // Acercarse.
  if (e.motivoAccion(u.id, 'Mover') === null) {
    const movimiento = avance(e, u, enemigos);
    if (movimiento) return { cmd: { type: 'Mover', unidadId: u.id, posiciones: movimiento }, motivo: 'avanza' };
  }
  return null;
}

/** ¿Hace más daño pegando que disparando? */
function prefiereCuerpoACuerpo(e: Engine, u: Unidad): boolean {
  const s = e.getState();
  let disparo = 0;
  let cac = 0;
  for (const m of u.minis) {
    const t = s.tipos[m.tipoId]!;
    const media = (a: number | { dados: number; caras: number; mas: number }) =>
      typeof a === 'number' ? a : a.dados * ((a.caras + 1) / 2) + a.mas;
    if (t.disparo) disparo += media(t.disparo.ataques) * t.disparo.danio;
    if (t.cac) cac += media(t.cac.ataques) * t.cac.danio;
  }
  return cac > disparo;
}

/**
 * Elige el objetivo que más Valor promete llevarse: las miniaturas que caerían
 * por su Valor, más un premio si borra la unidad entera.
 */
function mejorObjetivo(e: Engine, u: Unidad, candidatos: readonly string[], modo: 'disparo' | 'cac' | 'carga'): string | null {
  const s = e.getState();
  let mejor: string | null = null;
  let nota = 0;
  for (const id of candidatos) {
    const o = s.unidades[id];
    if (!o) continue;
    const p = e.prevision(u.id, id, modo);
    if (!p) continue;
    const valorMini = tipoDe(s, o).valor;
    let n = p.bajasMedias * valorMini + p.pDestruir * 15 + p.danioMedio * 0.2;
    if (modo === 'carga') n *= 4 / 6; // la carga prende con 3+
    if (n > nota) {
      nota = n;
      mejor = id;
    }
  }
  return mejor;
}

/** Hacia dónde avanzar: al enemigo más cercano, sin acabar a menos de 1" de él. */
function avance(e: Engine, u: Unidad, enemigos: readonly Unidad[]): Record<string, Vec2> | null {
  const s = e.getState();
  const ancla = anclaDe(u);
  const objetivo = [...enemigos].sort((a, b) => distanciaEntre(s, u, a) - distanciaEntre(s, u, b))[0]!;
  const destino = anclaDe(objetivo).posicion;
  const alcance = e.alcanceDe(u, 'Mover');
  if (alcance <= 0) return null;

  const dir = normalize(sub(destino, ancla.posicion));
  const distancia = centerDistance(ancla.posicion, destino);
  const piezas = e.piezasDe(u);
  const R = restriccionesPara(s, u.owner, u.id, DISTANCIA_ENEMIGO);

  // Del paso más largo al más corto, hasta dar con uno que quepa.
  for (const f of [1, 0.85, 0.7, 0.55, 0.4, 0.25]) {
    const paso = Math.min(alcance * f, Math.max(0, distancia - 2));
    if (paso < 0.3) break;
    const pos = formar(piezas, add(ancla.posicion, scale(dir, paso)), R, alcance);
    if (pos && e.motivoPosiciones(u, pos, alcance, DISTANCIA_ENEMIGO) === null) return pos;
  }
  return null;
}
