import {
  bloqueaPaso,
  caminoMasCorto,
  distanciaMaximaParaOcupar,
  centerDistance,
  esCobertura,
  expulsarDeRect,
  imantarARect,
  recortarCamino,
  ZONA_CONTROL,
  type Puesto,
  type Terrain,
  type Vec2,
} from '@zerolore/core';

/**
 * Dónde cae la miniatura al arrastrarla. Vive fuera del componente porque es
 * pura geometría con varias reglas encadenadas y hay que poder probarla: es la
 * parte que más se ha roto, sobre todo con la peana pegada a una esquina.
 */
export interface OpcionesColocacion {
  readonly origen: Vec2;
  readonly radio: number;
  readonly cursor: Vec2;
  /** Distancia máxima permitida; `null` si no hay tope. */
  readonly tope: number | null;
  /** Distancia mínima (al Correr, el Movimiento); `null` si no hay. */
  readonly minimo: number | null;
  readonly mesa: { readonly ancho: number; readonly alto: number };
  readonly terreno: readonly Terrain[];
  /** Puestos de mando: si acabas dentro de uno, te imanta para que lo ocupes. */
  readonly puestos: readonly Puesto[];
  /**
   * Las demás miniaturas en mesa. Con las propias basta con no solaparse; con
   * las enemigas hay que quedarse fuera de su zona de control, así que llevan
   * `margen` = ZONA_CONTROL.
   */
  readonly unidades: readonly {
    readonly centro: Vec2;
    readonly radio: number;
    readonly margen: number;
  }[];
  /** A cuántas pulgadas atrae la cobertura. */
  readonly iman: number;
}

/**
 * Devuelve SIEMPRE un punto, nunca `null`: el fantasma no puede desaparecer a
 * mitad de un arrastre. Si la dirección pedida está cortada, se queda en lo más
 * lejos que se puede llegar por ahí.
 */
/** El recorrido real hasta un destino, para dibujar la flecha con sus codos. */
export function caminoHasta(
  origen: Vec2,
  destino: Vec2,
  radio: number,
  terreno: readonly Terrain[],
): readonly Vec2[] {
  const camino = caminoMasCorto(
    origen, destino, radio, terreno.filter(bloqueaPaso).map((t) => t.rect),
  );
  return camino ? camino.puntos : [origen, destino];
}

/**
 * Las demás miniaturas vivas, en la forma que espera `destinoDeMovimiento`.
 *
 * Moviendo, a las enemigas solo se les respeta la peana: acabar a 1\" o menos es
 * legal, y es lo que deja montada la unidad para un ataque suelto. Corriendo sí
 * se les guarda la zona de control entera.
 */
export function otrasUnidades(
  state: { units: Record<string, { id: string; owner: string; profileId: string; position: Vec2; vidas: number }>;
           profiles: Record<string, { radioPeana: number }> },
  excluir: string,
  correr = false,
): { centro: Vec2; radio: number; margen: number }[] {
  const propio = state.units[excluir]?.owner;
  return Object.values(state.units)
    .filter((u) => u.id !== excluir && u.vidas > 0)
    .flatMap((u) => {
      const perfil = state.profiles[u.profileId];
      if (!perfil) return [];
      const enemiga = propio !== undefined && u.owner !== propio;
      const margen = enemiga && correr ? ZONA_CONTROL : 0;
      return [{ centro: u.position, radio: perfil.radioPeana, margen }];
    });
}

export function destinoDeMovimiento(o: OpcionesColocacion): Vec2 {
  const bloqueantes = o.terreno.filter(bloqueaPaso).map((t) => t.rect);
  /*
    Recortar ya no es cortar en línea recta: se busca el camino real —que puede
    doblar por una esquina— y se avanza por él lo que dé el movimiento. Así,
    pegado a un muro, se puede rodearlo si sobra recorrido.
  */
  const recortar = (p: Vec2): Vec2 => {
    const camino = caminoMasCorto(o.origen, p, o.radio, bloqueantes);
    if (!camino) return o.origen;
    const tope = o.tope ?? camino.longitud;
    return recortarCamino(camino, tope).puntos.at(-1) ?? o.origen;
  };

  let p = enElAnillo(o, o.cursor);
  p = dentroDeLaMesa(o, p);
  // Primero el corte: lo que está al otro lado de un muro no es un destino.
  p = recortar(p);

  /*
    Ahora se aparta de la escenografía que no se puede ocupar y se imanta a la
    cobertura. Ambas cosas MUEVEN el punto, así que hay que volver a recortar:
    si no, expulsar de un muro podía dejar la peana al otro lado de él.
  */
  for (const t of o.terreno) {
    const fuera = expulsarDeRect(p, o.radio, t.rect);
    if (fuera) p = recortar(dentroDeLaMesa(o, fuera));
  }
  for (const t of o.terreno) {
    if (!esCobertura(t)) continue;
    const pegado = imantarARect(p, o.radio, t.rect, o.iman);
    if (pegado) {
      p = recortar(dentroDeLaMesa(o, pegado));
      break;
    }
  }

  /*
    Y por último las miniaturas: tampoco se puede acabar encima de otra. Se
    aparta lo justo para quedar en contacto, y se recorta otra vez por si el
    empujón la mandó al otro lado de un muro.
  */
  for (let intento = 0; intento < 8; intento += 1) {
    const encima = o.unidades.find(
      (u) => centerDistance(p, u.centro) < u.radio + o.radio + u.margen - 1e-9,
    );
    if (!encima) break;
    p = recortar(dentroDeLaMesa(o, apartarDe(p, o.radio, encima)));
  }

  /*
    Imán del puesto de mando: si la peana acaba dentro del token pero asomando
    demasiado, no lo ocuparía —hace falta media peana encima— y quien lo ve en
    pantalla jura que sí. Se mete lo justo para que cuente.
  */
  for (const pm of o.puestos) {
    const d = centerDistance(p, pm.centro);
    if (d > pm.radio) continue;
    const umbral = distanciaMaximaParaOcupar(pm, o.radio);
    if (d <= umbral) break;
    const k = umbral / d;
    p = recortar({
      x: pm.centro.x + (p.x - pm.centro.x) * k,
      y: pm.centro.y + (p.y - pm.centro.y) * k,
    });
    break;
  }

  return p;
}

/**
 * Aparta la peana de otra miniatura: hasta el contacto si es propia, hasta
 * dejar libre su zona de control si es enemiga. Un pelo más allá del límite,
 * para que el redondeo no la deje justo en la raya y el motor la rechace.
 */
function apartarDe(
  p: Vec2,
  radio: number,
  otra: { readonly centro: Vec2; readonly radio: number; readonly margen: number },
): Vec2 {
  const dx = p.x - otra.centro.x;
  const dy = p.y - otra.centro.y;
  const d = Math.hypot(dx, dy);
  const fuera = otra.radio + radio + otra.margen + (otra.margen > 0 ? 0.01 : 0);
  if (d < 1e-9) return { x: otra.centro.x, y: otra.centro.y + fuera };
  return { x: otra.centro.x + (dx / d) * fuera, y: otra.centro.y + (dy / d) * fuera };
}

/** Encaja el punto en el anillo permitido, por arriba y por abajo. */
function enElAnillo(o: OpcionesColocacion, destino: Vec2): Vec2 {
  const dx = destino.x - o.origen.x;
  const dy = destino.y - o.origen.y;
  const dist = Math.hypot(dx, dy);
  const ux = dist > 1e-6 ? dx / dist : 0;
  const uy = dist > 1e-6 ? dy / dist : -1;

  if (o.tope !== null && dist > o.tope) {
    return { x: o.origen.x + ux * o.tope, y: o.origen.y + uy * o.tope };
  }
  if (o.minimo !== null && dist < o.minimo) {
    return { x: o.origen.x + ux * o.minimo, y: o.origen.y + uy * o.minimo };
  }
  return destino;
}


function dentroDeLaMesa(o: OpcionesColocacion, p: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(p.x, o.radio), o.mesa.ancho - o.radio),
    y: Math.min(Math.max(p.y, o.radio), o.mesa.alto - o.radio),
  };
}
