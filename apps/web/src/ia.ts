import {
  centerDistance,
  PUNTOS_POR_PUESTO,
  dentroDelPuesto,
  mediaCantidad,
  puedeDesplegarEn,
  ocupantes,
  unidadOcupa,
  type Command,
  type GameState,
  type MeleeWeapon,
  type Puesto,
  type RangedWeapon,
  type Unit,
  type UnitProfile,
  type Vec2,
} from '@zerolore/core';
import { accionesDisponibles, objetivosDeCarga, objetivosDeDisparo } from './acciones.ts';
import { destinoDeMovimiento, otrasUnidades } from './colocacion.ts';
import { MESA } from './setup.ts';

/**
 * Oponente automático. Devuelve UNA jugada por llamada, para que la partida se
 * vea moverse en vez de resolverse de golpe; la interfaz la ejecuta y vuelve a
 * preguntar.
 *
 * Es deliberadamente simple y DETERMINISTA: sin azar propio, las mismas
 * posiciones dan siempre la misma jugada, que es lo que permite probarla y
 * también enfrentar dos IAs sin que la partida dependa del reloj.
 *
 * Juega a los puntos, que es como se gana: cada puesto controlado da
 * PUNTOS_POR_PUESTO al cerrar el turno, y cada baja vale el Valor de la unidad
 * destruida. De ahí salen sus dos manías: rematar antes que repartir daño, y
 * no soltar un puesto que esté sosteniendo ella sola.
 *
 * La prioridad, en este orden:
 *   1. Si está trabada, pelea.
 *   2. Si tiene tiro, dispara — al objetivo que más puntos deje.
 *   3. Si puede cargar, carga, con el mismo criterio.
 *   4. Si sostiene un puesto ella sola, se queda: irse regala 5 por turno.
 *   5. Si no, avanza hacia el puesto más cercano que no controle, y si los
 *      tiene todos, a por el enemigo.
 */
export interface Jugada {
  readonly cmd: Command;
  /** Para el registro: por qué hace esto. */
  readonly motivo: string;
}

export function siguienteJugada(state: GameState, jugador: string): Jugada | null {
  if (state.fase === 'Iniciativa') return jugadaDeDespliegue(state, jugador);
  if (state.fase !== 'Activaciones' || state.jugadorActivo !== jugador) return null;

  const activa = state.unidadActiva ? state.units[state.unidadActiva] : undefined;
  if (activa && activa.owner === jugador && activa.vidas > 0) return jugadaDeUnidad(state, activa);

  const siguiente = Object.values(state.units).find(
    (u) => u.owner === jugador && u.vidas > 0 && !u.activated,
  );
  if (!siguiente) return null;
  return { cmd: { type: 'ActivarUnidad', unitId: siguiente.id }, motivo: 'le toca' };
}

// ------------------------------------------------------------------ Despliegue

function jugadaDeDespliegue(state: GameState, jugador: string): Jugada | null {
  // Un refuerzo por jugador y turno; el resto espera.
  if (state.refuerzoUsado[jugador]) return null;
  const enReserva = state.reserva.find((r) => r.owner === jugador);
  if (!enReserva) return null;
  const perfil = state.profiles[enReserva.profileId];
  if (!perfil) return null;

  // Primero los puestos avanzados: el Cuartel General se guarda para el final.
  const puestos = state.puestos
    .filter((pm) => puedeDesplegarEn(state, pm, jugador))
    .sort((a, b) => Number(a.esCuartelGeneral) - Number(b.esCuartelGeneral));

  for (const pm of puestos) {
    const sitio = huecoEnPuesto(state, pm, perfil);
    if (!sitio) continue;
    return {
      cmd: { type: 'Desplegar', unitId: enReserva.id, puestoId: pm.id, posicion: sitio },
      motivo: `refuerzo por ${pm.id}`,
    };
  }
  return null;
}

/** Busca un punto libre dentro del puesto, girando alrededor de su centro. */
function huecoEnPuesto(state: GameState, pm: Puesto, perfil: UnitProfile): Vec2 | null {
  const r = perfil.radioPeana;
  if (pm.radio <= r) return null;
  const candidatos: Vec2[] = [pm.centro];
  const anillo = Math.max(0, pm.radio - r);
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    candidatos.push({
      x: pm.centro.x + Math.cos(rad) * anillo,
      y: pm.centro.y + Math.sin(rad) * anillo,
    });
  }
  return candidatos.find((c) => sitioLibre(state, c, r, pm)) ?? null;
}

function sitioLibre(state: GameState, p: Vec2, r: number, pm: Puesto): boolean {
  if (!dentroDelPuesto(p, r, pm)) return false;
  if (state.terrain.some((t) => distanciaARect(p, r, t.rect) <= 0)) return false;
  return Object.values(state.units).every((u) => {
    if (u.vidas <= 0) return true;
    const up = state.profiles[u.profileId];
    if (!up) return true;
    const separacion = centerDistance(p, u.position) - r - up.radioPeana;
    return u.owner === pm.duenio ? separacion > 0 : separacion > 1;
  });
}

function distanciaARect(p: Vec2, r: number, rect: { x: number; y: number; width: number; height: number }): number {
  const cx = Math.min(Math.max(p.x, rect.x), rect.x + rect.width);
  const cy = Math.min(Math.max(p.y, rect.y), rect.y + rect.height);
  return Math.hypot(p.x - cx, p.y - cy) - r;
}

// ----------------------------------------------------------------- Activación

function jugadaDeUnidad(state: GameState, u: Unit): Jugada | null {
  const p = state.profiles[u.profileId];
  if (!p) return null;
  const acciones = accionesDisponibles(state, u, p);
  const puede = (kind: string): boolean =>
    acciones.some((a) => a.kind === kind && a.disponible);

  // 1. Trabada: pelear es lo único que tiene sentido.
  if (u.trabadaCon.length > 0 && puede('AtacarCaC')) {
    const arma = p.armas.find((w) => w.kind === 'cuerpo_a_cuerpo');
    const objetivo = arma
      ? mejorObjetivo(state, u.trabadaCon, danioMedio(arma)) ?? u.trabadaCon[0]
      : u.trabadaCon[0];
    if (arma && objetivo) {
      return {
        cmd: { type: 'AtacarCaC', unitId: u.id, targetId: objetivo, armaNombre: arma.nombre },
        motivo: 'pelea',
      };
    }
  }

  // 2. Disparar: al enemigo más débil que tenga a tiro.
  if (puede('Disparar')) {
    for (const arma of p.armas) {
      if (arma.kind !== 'disparo') continue;
      const objetivos = objetivosDeDisparo(state, u, p, arma);
      const elegido = mejorObjetivo(state, objetivos, danioMedio(arma));
      if (elegido) {
        return {
          cmd: { type: 'Disparar', unitId: u.id, targetId: elegido, armaNombre: arma.nombre },
          motivo: 'tiene tiro',
        };
      }
    }
  }

  // 3. Cargar: si alcanza a alguien, se le echa encima.
  if (puede('Cargar')) {
    const cac = p.armas.find((w) => w.kind === 'cuerpo_a_cuerpo');
    const elegido = mejorObjetivo(
      state, objetivosDeCarga(state, u, p), cac ? danioMedio(cac) : 0,
    );
    if (elegido) {
      return { cmd: { type: 'Cargar', unitId: u.id, targetId: elegido }, motivo: 'carga' };
    }
  }

  /*
    4. Moverse. Antes de nada: si es la única que sostiene un puesto suyo, se
       queda. Marcharse a buscar otro cuesta PUNTOS_POR_PUESTO cada turno, y
       casi nada de lo que pueda encontrar fuera lo compensa.
  */
  if (sostieneElPuestoSola(state, u, p)) {
    return { cmd: { type: 'TerminarActivacion', unitId: u.id }, motivo: 'sostiene el puesto' };
  }

  // Si no, a por el puesto que le falta; y si los tiene todos, a por el enemigo.
  const meta = puestoObjetivo(state, u, p) ?? enemigoMasCercano(state, u);
  if (meta) {
    const correr = puede('Correr') && centerDistance(u.position, meta.centro) > p.movimiento;
    if (correr || puede('Mover')) {
      const destino = destinoDeMovimiento({
        origen: u.position,
        radio: p.radioPeana,
        cursor: meta.centro,
        tope: correr ? p.movimiento + p.velocidad : p.movimiento,
        minimo: null,
        mesa: MESA,
        terreno: state.terrain,
        puestos: state.puestos,
        unidades: otrasUnidades(state, u.id),
        iman: 0.9,
      });
      if (centerDistance(destino, u.position) > 0.05) {
        return {
          cmd: correr
            ? { type: 'Correr', unitId: u.id, destino }
            : { type: 'Mover', unitId: u.id, destino },
          motivo: `hacia ${meta.id}`,
        };
      }
    }
  }

  return { cmd: { type: 'TerminarActivacion', unitId: u.id }, motivo: 'sin nada que hacer' };
}

/**
 * ¿Es la única de su bando que ocupa un puesto que controla? Entonces irse lo
 * pierde. Vale `PUNTOS_POR_PUESTO` por turno, que es más que la mayoría de
 * unidades del juego.
 */
function sostieneElPuestoSola(state: GameState, u: Unit, p: UnitProfile): boolean {
  if (PUNTOS_POR_PUESTO <= 0) return false;
  return state.puestos.some((pm) => {
    if (pm.duenio !== u.owner) return false;
    if (!unidadOcupa(pm, u, p)) return false;
    return !ocupantes(state, pm, u.owner).some((o) => o.id !== u.id);
  });
}

/** El enemigo vivo más cercano, como destino al que acercarse. */
function enemigoMasCercano(state: GameState, u: Unit): { id: string; centro: Vec2 } | null {
  const enemigos = Object.values(state.units).filter((o) => o.owner !== u.owner && o.vidas > 0);
  if (enemigos.length === 0) return null;
  const cerca = enemigos.reduce((mejor, o) =>
    centerDistance(u.position, o.position) < centerDistance(u.position, mejor.position) ? o : mejor,
  );
  return { id: cerca.id, centro: cerca.position };
}

/** El puesto más cercano que no controla, o el suyo si ya los tiene todos. */
function puestoObjetivo(state: GameState, u: Unit, p: UnitProfile): { id: string; centro: Vec2 } | null {
  const yaDentro = state.puestos.some(
    (pm) => pm.duenio === u.owner && unidadOcupa(pm, u, p),
  );
  const candidatos = state.puestos.filter((pm) => pm.duenio !== u.owner);
  const lista = yaDentro && candidatos.length === 0 ? [] : candidatos;
  if (lista.length === 0) return null;
  return lista.reduce((mejor, pm) =>
    centerDistance(u.position, pm.centro) < centerDistance(u.position, mejor.centro) ? pm : mejor,
  );
}

/**
 * El objetivo que más puntos promete. Una baja vale el Valor de la unidad, así
 * que rematar a una unidad cara y tocada gana a arañarle vidas a una entera.
 *
 * Con `danioEsperado` se sabe a quién puede tumbar de este golpe: esos van
 * primero, ordenados por Valor. Al resto se les mira el Valor por Vida que le
 * queda, o sea, cuántos puntos rinde cada punto de daño invertido.
 */
function mejorObjetivo(
  state: GameState,
  ids: readonly string[],
  danioEsperado: number,
): string | null {
  let mejor: string | null = null;
  let mejorNota = -Infinity;

  for (const id of ids) {
    const o = state.units[id];
    const perfil = o ? state.profiles[o.profileId] : undefined;
    if (!o || !perfil || o.vidas <= 0) continue;

    const remata = danioEsperado >= o.vidas;
    // Rematar pesa muchísimo más: el Valor solo se cobra si la unidad cae.
    const nota = remata ? 1000 + perfil.valor : perfil.valor / o.vidas;
    if (nota > mejorNota) { mejorNota = nota; mejor = id; }
  }
  return mejor;
}

/** Daño medio que cabe esperar de un arma, para saber a quién puede rematar. */
function danioMedio(arma: RangedWeapon | MeleeWeapon): number {
  const ataques = mediaCantidad(arma.ataques);
  /*
    A distancia impacta con su Precisión; en CaC fallan el 1 y el 2. Precisión
    nula es la convención de las armas Directo: impactan siempre.
  */
  const acierta =
    arma.kind === 'disparo' ? (arma.precision === null ? 1 : (7 - arma.precision) / 6) : 4 / 6;
  return ataques * acierta * arma.danio;
}
