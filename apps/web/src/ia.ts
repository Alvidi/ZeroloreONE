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
/** Holgura, en pulgadas, al decidir si un enemigo amenaza un puesto normal. */
const MARGEN_AMENAZA = 1;
/** Y un Cuartel General, que se vigila con más cuidado: perderlo es perder. */
const MARGEN_AMENAZA_CG = 6;

export interface Jugada {
  readonly cmd: Command;
  /** Para el registro: por qué hace esto. */
  readonly motivo: string;
}

export function siguienteJugada(state: GameState, jugador: string): Jugada | null {
  if (state.jugadorActivo !== jugador) return null;

  /*
    Despliegue inicial: coloca hasta quedarse sin reserva y entonces pasa. No
    hay tope aquí, el tope es cosa de los refuerzos en partida.
  */
  if (state.fase === 'Despliegue') {
    return (
      jugadaDeDespliegue(state, jugador) ?? {
        cmd: { type: 'PasarDespliegue', jugador },
        motivo: 'no despliega más',
      }
    );
  }
  if (state.fase !== 'Activaciones') return null;

  const activa = state.unidadActiva ? state.units[state.unidadActiva] : undefined;
  if (activa && activa.owner === jugador) {
    // Si ha caído en su propia activación (el retroceso de Inestable), hay que
    // cerrarla: el motor no deja activar a otra mientras siga abierta.
    if (activa.vidas <= 0) {
      return { cmd: { type: 'TerminarActivacion', unitId: activa.id }, motivo: 'ha caído' };
    }
    return jugadaDeUnidad(state, activa);
  }

  const siguiente = Object.values(state.units).find(
    (u) => u.owner === jugador && u.vidas > 0 && !u.activated,
  );
  if (siguiente) {
    return { cmd: { type: 'ActivarUnidad', unitId: siguiente.id }, motivo: 'le toca' };
  }
  /*
    Sin nada que activar todavía queda una jugada: meter un refuerzo, que
    consume la vez igual que una activación.
  */
  return jugadaDeDespliegue(state, jugador);
}

// ------------------------------------------------------------------ Despliegue

function jugadaDeDespliegue(state: GameState, jugador: string): Jugada | null {
  /*
    En partida, el tope de refuerzos por turno son los puestos que controles.
    En el despliegue inicial no hay tope: colocas hasta que digas basta.
  */
  if (state.fase !== 'Despliegue') {
    const tope = state.puestos.filter((pm) => pm.duenio === jugador).length;
    if ((state.refuerzosUsados[jugador] ?? 0) >= tope) return null;
  }
  // El Héroe sale el primero; después, el resto en el orden de la lista.
  const suyas = state.reserva.filter((r) => r.owner === jugador);
  const enReserva =
    suyas.find((r) => state.profiles[r.profileId]?.clase === 'Heroe') ?? suyas[0];
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
    const objetivo = mejorObjetivo(state, u.trabadaCon, arma) ?? u.trabadaCon[0];
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
      const elegido = mejorObjetivo(state, objetivos, arma);
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
    const elegido = mejorObjetivo(state, objetivosDeCarga(state, u, p), cac);
    if (elegido) {
      return { cmd: { type: 'Cargar', unitId: u.id, targetId: elegido }, motivo: 'carga' };
    }
  }

  /*
    4. Moverse. Antes de nada: si es la única que sostiene un puesto suyo Y hay
       un enemigo en condiciones de quitárselo, se queda. Sin amenaza cerca no
       hay nada que defender, y quedarse quieta solo desperdicia sus armas.
  */
  if (debeSostenerElPuesto(state, u, p)) {
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
        unidades: otrasUnidades(state, u.id, correr),
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
 * ¿Tiene que quedarse de guardia? Solo si es la única de su bando en un puesto
 * que controla y hay un enemigo que podría plantarse ahí pronto.
 *
 * La primera versión se quedaba siempre que sostuviera un puesto sola, y en
 * partida eso congelaba a medio ejército —Héroes incluidos— detrás de la ruina
 * sin disparar un tiro. Ahora:
 *   - Sin amenaza cerca, avanza: no hay nada que defender.
 *   - El Cuartel General se vigila con más margen, porque perderlo es derrota
 *     inmediata en Guerra Total.
 *   - El Héroe no hace guardia en puestos normales: es la punta de lanza y lo
 *     que más puntos vale, no un centinela.
 */
function debeSostenerElPuesto(state: GameState, u: Unit, p: UnitProfile): boolean {
  if (PUNTOS_POR_PUESTO <= 0) return false;
  return state.puestos.some((pm) => {
    if (pm.duenio !== u.owner) return false;
    if (!unidadOcupa(pm, u, p)) return false;
    if (ocupantes(state, pm, u.owner).some((o) => o.id !== u.id)) return false;
    if (!pm.esCuartelGeneral && p.clase === 'Heroe') return false;
    return puestoAmenazado(state, pm, u.owner);
  });
}

/**
 * ¿Algún enemigo podría llegar a este puesto en su próxima activación? Se mide
 * con su Movimiento + Velocidad, que es lo máximo que recorre corriendo o
 * cargando, más el radio del puesto. Al Cuartel General se le da margen extra.
 */
function puestoAmenazado(state: GameState, pm: Puesto, duenio: string): boolean {
  const margen = pm.esCuartelGeneral ? MARGEN_AMENAZA_CG : MARGEN_AMENAZA;
  return Object.values(state.units).some((e) => {
    if (e.owner === duenio || e.vidas <= 0) return false;
    const ep = state.profiles[e.profileId];
    if (!ep) return false;
    const alcance = ep.movimiento + ep.velocidad + pm.radio + margen;
    return centerDistance(e.position, pm.centro) <= alcance;
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
 * El daño se estima contra CADA objetivo, porque depende de él: su salvación,
 * si el arma lo perfora, si tiene Anti- contra su clase. Y con Explosiva cuenta
 * también a los enemigos pegados al objetivo, que se llevan el mismo daño.
 */
function mejorObjetivo(
  state: GameState,
  ids: readonly string[],
  arma: RangedWeapon | MeleeWeapon | undefined,
): string | null {
  let mejor: string | null = null;
  let mejorNota = -Infinity;

  for (const id of ids) {
    const o = state.units[id];
    const perfil = o ? state.profiles[o.profileId] : undefined;
    if (!o || !perfil || o.vidas <= 0) continue;

    const danio = arma ? danioMedio(arma, perfil) : 0;
    let nota = puntosPrevistos(o.vidas, perfil.valor, danio);
    for (const vecino of alcanzablesPorExplosiva(state, o, arma)) {
      const vp = state.profiles[vecino.profileId];
      if (vp) nota += puntosPrevistos(vecino.vidas, vp.valor, arma ? danioMedio(arma, vp) : 0);
    }
    if (nota > mejorNota) { mejorNota = nota; mejor = id; }
  }
  return mejor;
}

/**
 * Cuánto vale meterle este daño a una unidad. Tumbarla cobra su Valor entero y
 * pesa muchísimo más que cualquier daño a medias; si no cae, se cuenta la parte
 * proporcional, que es lo que acerca a la siguiente baja.
 */
function puntosPrevistos(vidas: number, valor: number, danio: number): number {
  if (danio >= vidas) return 1000 + valor;
  return valor * Math.min(1, danio / vidas);
}

/** Enemigos del objetivo a 3" de él que la Explosiva del arma se llevaría. */
function alcanzablesPorExplosiva(
  state: GameState,
  objetivo: Unit,
  arma: RangedWeapon | MeleeWeapon | undefined,
): Unit[] {
  const explosiva = arma?.habilidades.find((h) => h.nombre === 'Explosiva X');
  if (!explosiva?.x) return [];
  const po = state.profiles[objetivo.profileId];
  if (!po) return [];
  return Object.values(state.units)
    .filter((v) => v.id !== objetivo.id && v.owner === objetivo.owner && v.vidas > 0)
    .filter((v) => {
      const vp = state.profiles[v.profileId];
      return !!vp && centerDistance(objetivo.position, v.position) - po.radioPeana - vp.radioPeana <= 3;
    })
    .slice(0, explosiva.x);
}

/**
 * Daño medio que cabe esperar de un arma contra un perfil concreto. Sigue la
 * secuencia del reglamento con probabilidades en vez de dados:
 *   impacta → ¿crítico? → ¿salva? → daño, más el extra de Anti-.
 */
function danioMedio(arma: RangedWeapon | MeleeWeapon, objetivo: UnitProfile): number {
  const tiene = (n: string) => arma.habilidades.some((h) => h.nombre === n);
  const ataques = mediaCantidad(arma.ataques);

  // Probabilidad de impactar con cada dado.
  let umbral: number | null;
  if (arma.kind === 'disparo') {
    if (tiene('Directo')) umbral = null;
    else if (tiene('Errática')) umbral = 3.5; // la Precisión sale de 1D6
    else umbral = arma.precision;
  } else {
    umbral = 3; // en cuerpo a cuerpo fallan el 1 y el 2
  }

  // Brutal adelanta el crítico; sin tirada (Directo) no hay críticos.
  const brutal = arma.habilidades.find((h) => h.nombre === 'Brutal X+');
  const critico = brutal?.x ?? 6;

  let danioPorDado: number;
  if (umbral === null) {
    danioPorDado = arma.danio;
  } else {
    const pCritico = Math.max(0, 7 - Math.max(critico, umbral)) / 6;
    const pNormal = Math.max(0, critico - umbral) / 6;
    danioPorDado = pNormal * arma.danio + pCritico * arma.danioCritico;
  }

  // Salvación del objetivo; Perforante la empeora. Un 1 siempre falla.
  const salvacion = Math.min(6, objetivo.salvacion + (tiene('Perforante') ? 1 : 0));
  const pNoSalva = Math.max(1, salvacion - 1) / 6;

  let total = ataques * danioPorDado * pNoSalva;
  const anti = arma.habilidades.find((h) => h.nombre === 'Anti-X' && h.objetivo === objetivo.clase);
  if (anti && total > 0) total += 2; // media de 1D3
  return total;
}
