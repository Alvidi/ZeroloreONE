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
import { HABILIDADES_ACTIVAS } from './setup.ts';

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
  if (HABILIDADES_ACTIVAS && state.profiles[o.profileId]?.habilidad?.nombre === 'Terror') {
    const d = baseDistance(u.position, p.radioPeana, o.position, op.radioPeana);
    if (d <= 12) return 'Terror: no se le puede disparar a 12" o menos';
  }

  const d = baseDistance(u.position, p.radioPeana, o.position, op.radioPeana);
  if (d > arma.distancia) return `Fuera de alcance (${d.toFixed(1)}" > ${arma.distancia}")`;
  if (HABILIDADES_ACTIVAS && anguloMuertoBloquea(arma, d)) {
    return `Ángulo muerto: mínimo ${(arma.distancia / 2).toFixed(0)}"`;
  }
  const parabolica = HABILIDADES_ACTIVAS && hasAbility(arma.habilidades, 'Parabólica');
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

/** ¿Puede atacar en cuerpo a cuerpo? Trabada, o con un arma con Alcance a 3". */
function hayObjetivoCaC(state: GameState, u: Unit, p: UnitProfile): boolean {
  if (u.trabadaCon.length > 0) return true;
  const conAlcance =
    HABILIDADES_ACTIVAS &&
    p.armas.some((w) => w.kind === 'cuerpo_a_cuerpo' && hasAbility(w.habilidades, 'Alcance'));
  if (!conAlcance) return false;
  return enemigosVivos(state, u).some((o) => {
    const op = state.profiles[o.profileId];
    return !!op && baseDistance(u.position, p.radioPeana, o.position, op.radioPeana) <= 3;
  });
}

/**
 * Las seis acciones del reglamento con su disponibilidad real. Devuelve
 * siempre las seis: las que no puede hacer salen apagadas con su motivo.
 */
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
  if (state.unidadActiva !== unidad.id) {
    return orden.map((k) => base(k, false, 'La unidad no está activada'));
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
          : base(kind, false, 'No está trabada con nadie');
      case 'Destrabarse':
        return trabada ? base(kind, true, '') : base(kind, false, 'No está trabada');
    }
  });
}
