import {
  ACTION_COST,
  IGNORA_TRABADO,
  anguloMuertoBloquea,
  baseDistance,
  bloqueaPaso,
  caminoMasCorto,
  hasAbility,
  lineOfSight,
  normalize,
  type ActionKind,
  type GameState,
  type RangedWeapon,
  type Unit,
  type UnitProfile,
} from '@zerolore/core';
import { HABILIDADES_ARMA, HABILIDADES_UNIDAD } from './setup.ts';

/**
 * Estado de una acción para la unidad activa: si se puede hacer ahora mismo y,
 * si no, por qué. El "por qué" es lo que se enseña en el desplegable, para que
 * una acción apagada no parezca un fallo de la interfaz.
 */
export interface AccionDisponible {
  readonly kind: ActionKind;
  readonly etiqueta: string;
  readonly coste: number;
  readonly disponible: boolean;
  readonly motivo: string;
}

const ETIQUETAS: Record<ActionKind, string> = {
  Mover: 'Mover',
  Correr: 'Correr',
  Disparar: 'Disparar',
  Cargar: 'Cargar',
  AtacarCaC: 'Atacar cuerpo a cuerpo',
  Destrabarse: 'Destrabarse',
};

const enemigosVivos = (state: GameState, u: Unit): Unit[] =>
  Object.values(state.units).filter((o) => o.owner !== u.owner && o.vidas > 0);

/**
 * Por qué NO se puede disparar a este objetivo con esta arma. null si sí.
 * Reproduce las comprobaciones del motor para poder avisar antes de intentarlo.
 */
export function motivoNoDisparo(
  state: GameState,
  u: Unit,
  p: UnitProfile,
  arma: RangedWeapon,
  o: Unit,
): string | null {
  const op = state.profiles[o.profileId];
  if (!op) return 'Perfil desconocido';
  if (o.vidas <= 0) return 'Destruida';

  const trabada = u.trabadaCon.length > 0 && !IGNORA_TRABADO.includes(p.clase);
  if (trabada) {
    if (!hasAbility(arma.habilidades, 'Multiuso')) return 'Trabada: el arma necesita Multiuso';
    if (!u.trabadaCon.includes(o.id)) return 'Multiuso solo dispara a su rival en combate';
  }
  if (o.trabadaCon.length > 0 && !IGNORA_TRABADO.includes(op.clase) && !o.trabadaCon.includes(u.id)) {
    return 'Trabada: no puede ser disparada desde fuera';
  }
  if (HABILIDADES_UNIDAD && state.profiles[o.profileId]?.habilidad?.nombre === 'Terror') {
    const d = baseDistance(u.position, p.radioPeana, o.position, op.radioPeana);
    if (d <= 12) return 'Terror: no se le puede disparar a 12" o menos';
  }

  const d = baseDistance(u.position, p.radioPeana, o.position, op.radioPeana);
  if (d > arma.distancia) return `Fuera de alcance (${d.toFixed(1)}" > ${arma.distancia}")`;
  if (HABILIDADES_ARMA && anguloMuertoBloquea(arma, d)) {
    return `Ángulo muerto: mínimo ${(arma.distancia / 2).toFixed(0)}"`;
  }
  const parabolica = HABILIDADES_ARMA && hasAbility(arma.habilidades, 'Parabólica');
  if (!parabolica && !lineOfSight(state, u, p, o, op).visible) {
    return 'Sin línea de visión';
  }
  return null;
}

/** Ids de los enemigos a los que se puede disparar con esa arma. */
export function objetivosDeDisparo(
  state: GameState,
  u: Unit,
  p: UnitProfile,
  arma: RangedWeapon,
): string[] {
  return enemigosVivos(state, u)
    .filter((o) => motivoNoDisparo(state, u, p, arma, o) === null)
    .map((o) => o.id);
}

/** ¿Hay algún enemigo al que esta unidad pueda dispararle ahora mismo? */
function hayObjetivoDeDisparo(state: GameState, u: Unit, p: UnitProfile): boolean {
  for (const arma of p.armas) {
    if (arma.kind !== 'disparo') continue;
    if (objetivosDeDisparo(state, u, p, arma).length > 0) return true;
  }
  return false;
}

/**
 * Ids de los enemigos a los que se puede cargar.
 *
 * El criterio es el que se ve en pantalla: el CÍRCULO del enemigo tiene que
 * tocar el anillo de carga. El anillo se traza a Movimiento + Velocidad desde
 * el centro, así que la condición es que la distancia entre centros menos el
 * radio del enemigo quepa en ese alcance.
 *
 * Ojo: es algo más estricto que el reglamento, que mide de peana a peana y
 * por tanto concede además el radio de la peana propia. La diferencia es el
 * radio del atacante; se acepta a cambio de que lo que se ve y lo que se
 * puede hacer coincidan exactamente.
 */
export function objetivosDeCarga(state: GameState, u: Unit, p: UnitProfile): string[] {
  const alcance = p.movimiento + p.velocidad;
  const bloqueantes = state.terrain.filter(bloqueaPaso).map((t) => t.rect);
  return enemigosVivos(state, u)
    .filter((o) => {
      const op = state.profiles[o.profileId];
      if (!op) return false;
      /*
        Mismo criterio que el motor: el recorrido REAL hasta el contacto de
        peana, que puede doblar por una esquina. Midiéndolo en recto la
        interfaz marcaba objetivos que luego la carga rechazaba.
      */
      const dir = normalize({ x: u.position.x - o.position.x, y: u.position.y - o.position.y });
      const contacto = {
        x: o.position.x + dir.x * (p.radioPeana + op.radioPeana),
        y: o.position.y + dir.y * (p.radioPeana + op.radioPeana),
      };
      const camino = caminoMasCorto(u.position, contacto, p.radioPeana, bloqueantes);
      return camino !== null && camino.longitud <= alcance + 1e-9;
    })
    .map((o) => o.id);
}

const hayObjetivoDeCarga = (state: GameState, u: Unit, p: UnitProfile): boolean =>
  objetivosDeCarga(state, u, p).length > 0;

/**
 * A quién puede pegar en cuerpo a cuerpo: las unidades con las que está trabada
 * más las que tenga a 1" o menos —el ataque suelto, que no traba a ninguna de
 * las dos—. Un arma con Alcance estira ese suelto hasta 3".
 */
export function objetivosDeCaC(state: GameState, u: Unit, p: UnitProfile): string[] {
  const conAlcance =
    HABILIDADES_ARMA &&
    p.armas.some((w) => w.kind === 'cuerpo_a_cuerpo' && hasAbility(w.habilidades, 'Alcance'));
  const suelto = conAlcance ? 3 : 1;

  const ids = new Set(u.trabadaCon);
  for (const o of enemigosVivos(state, u)) {
    const op = state.profiles[o.profileId];
    if (!op) continue;
    if (baseDistance(u.position, p.radioPeana, o.position, op.radioPeana) <= suelto) ids.add(o.id);
  }
  return [...ids];
}

const hayObjetivoCaC = (state: GameState, u: Unit, p: UnitProfile): boolean =>
  objetivosDeCaC(state, u, p).length > 0;

/**
 * Las seis acciones del reglamento con su disponibilidad real. Devuelve
 * siempre las seis: las que no puede hacer salen apagadas con su motivo.
 */
/**
 * Por qué esta unidad no puede empezar a jugar ahora mismo. `null` si puede.
 * Sirve para explicar en la rueda qué pasa, en vez de enseñar seis acciones
 * apagadas sin decir por qué.
 */
export function motivoNoActivable(state: GameState, unidad: Unit): string | null {
  if (unidad.vidas <= 0) return 'Está destruida';
  if (state.fase !== 'Activaciones') return 'Aún no han empezado las activaciones';
  if (state.unidadActiva !== null && state.unidadActiva !== unidad.id) {
    return 'Hay otra unidad a media activación';
  }
  if (unidad.activated) return 'Ya ha jugado este turno';
  if (state.jugadorActivo !== unidad.owner) {
    return `Le toca a ${state.jugadorActivo === 'A' ? 'AZUL' : 'ROJO'}`;
  }
  return null;
}

export function accionesDisponibles(
  state: GameState,
  unidad: Unit | undefined,
  perfil: UnitProfile | undefined,
): AccionDisponible[] {
  const orden: ActionKind[] = ['Mover', 'Correr', 'Disparar', 'Cargar', 'AtacarCaC', 'Destrabarse'];

  const base = (kind: ActionKind, disponible: boolean, motivo: string): AccionDisponible => ({
    kind,
    etiqueta: ETIQUETAS[kind],
    coste: ACTION_COST[kind],
    disponible,
    motivo,
  });

  if (!unidad || !perfil) return orden.map((k) => base(k, false, 'Sin unidad'));
  /*
    No hace falta activar a mano: si la unidad PUEDE activarse ahora, sus
    acciones se calculan igual que si ya lo estuviera, y la activación la
    dispara la primera acción que se ejecute. Lo que se sigue respetando es de
    quién es el turno y que cada unidad juega una vez.
  */
  if (state.unidadActiva !== unidad.id) {
    const motivo = motivoNoActivable(state, unidad);
    if (motivo) return orden.map((k) => base(k, false, motivo));
  }

  const trabada = unidad.trabadaCon.length > 0;
  const libreEstandoTrabada = IGNORA_TRABADO.includes(perfil.clase);

  const gratuito = unidad.ataqueGratuitoContra;

  return orden.map((kind) => {
    // El ataque gratuito de la carga se ofrece aunque no queden acciones.
    if (kind === 'AtacarCaC' && gratuito) {
      return { ...base(kind, true, ''), coste: 0, etiqueta: 'Atacar cuerpo a cuerpo (gratis)' };
    }
    const coste = ACTION_COST[kind];
    if (unidad.accionesRestantes < coste) {
      return base(kind, false, `Requiere ${coste} ${coste === 1 ? 'acción' : 'acciones'}`);
    }
    if (unidad.accionesUsadas.includes(kind)) {
      return base(kind, false, 'Ya usada en esta activación');
    }
    // Trabada: solo Atacar o Destrabarse, salvo Vehículos y Monstruos.
    if (trabada && !libreEstandoTrabada && kind !== 'AtacarCaC' && kind !== 'Destrabarse') {
      if (kind !== 'Disparar' || !hayObjetivoDeDisparo(state, unidad, perfil)) {
        return base(kind, false, 'Trabada en cuerpo a cuerpo');
      }
    }

    switch (kind) {
      case 'Mover':
      case 'Correr':
        if (perfil.clase === 'Artilleria') return base(kind, false, 'La Artillería no se mueve');
        if (unidad.corrio && kind === 'Mover') return base(kind, false, 'Ya corrió');
        return base(kind, true, '');
      case 'Disparar':
        if (unidad.corrio) return base(kind, false, 'Corrió: no puede atacar');
        if (!perfil.armas.some((w) => w.kind === 'disparo')) {
          return base(kind, false, 'Sin arma a distancia');
        }
        return hayObjetivoDeDisparo(state, unidad, perfil)
          ? base(kind, true, '')
          : base(kind, false, 'Ningún enemigo a tiro o con línea de visión');
      case 'Cargar':
        if (trabada) return base(kind, false, 'Ya está trabada');
        return hayObjetivoDeCarga(state, unidad, perfil)
          ? base(kind, true, '')
          : base(kind, false, `Ningún enemigo a ${perfil.movimiento + perfil.velocidad}"`);
      case 'AtacarCaC':
        return hayObjetivoCaC(state, unidad, perfil)
          ? base(kind, true, '')
          : base(kind, false, 'Ningún enemigo trabado ni a 1"');
      case 'Destrabarse':
        return trabada ? base(kind, true, '') : base(kind, false, 'No está trabada');
    }
  });
}
