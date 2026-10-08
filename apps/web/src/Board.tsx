import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ZONA_CONTROL,
  baseDistance,
  baseToRectDistance,
  bloqueaVision,
  centerDistance,
  coberturasDeTiro,
  esCobertura,
  controlTrasTurno,
  dentroDelPuesto,
  encerrarEnPuesto,
  libreDeUnidades,
  poligonoDeVision,
  puedeDesplegarEn,
  type ActionKind,
  type EnReserva,
  type GameState,
  type TipoTerreno,
  type Vec2,
} from '@zerolore/core';
import type { AccionDisponible } from './acciones.ts';
import { caminoHasta, destinoDeMovimiento, otrasUnidades } from './colocacion.ts';
import { RuedaAcciones } from './RuedaAcciones.tsx';
import { MESA } from './setup.ts';
import { colorVida } from './vida.ts';

/** Píxeles por pulgada. Todo el render trabaja en pulgadas y escala aquí. */
const PPI = 22;
/** Distancia a la que la escenografía atrae la peana, en pulgadas. */
const IMAN = 0.9;

/**
 * Todo lo que habla de disparar va del mismo rojo que la retícula del
 * objetivo: el aura del arma, la trayectoria del tiro. El ámbar queda
 * reservado para la cobertura — usarlo para las dos cosas confundía.
 */
const ROJO_ATAQUE = '#ef4444';
const AMBAR_COBERTURA = '#fbbf24';
/*
  La amenaza ajena va en naranja suave y a trazos. Desaturado a propósito: no
  compite con el rojo del ataque propio ni con el ámbar vivo de la cobertura, y
  se lee como lo que es — una consulta de paso, no una acción en curso.
*/
const NARANJA_AMENAZA = '#fdba74';

/**
 * Un aura es un borde nítido con el color de la acción y un relleno que se
 * desvanece hacia dentro: marca el límite sin llegar a tapar el tablero.
 * `desde` deja hueco el centro, para la corona de Correr.
 */
function Degradado({
  id, color, cx, cy, r, desde = 0,
}: { id: string; color: string; cx: number; cy: number; r: number; desde?: number }) {
  const en = (t: number) => `${(desde + (1 - desde) * t) * 100}%`;
  return (
    <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r}>
      <stop offset={en(0)} stopColor={color} stopOpacity={0} />
      <stop offset={en(0.7)} stopColor={color} stopOpacity={0.025} />
      <stop offset={en(0.92)} stopColor={color} stopOpacity={0.08} />
      <stop offset="100%" stopColor={color} stopOpacity={0.22} />
    </radialGradient>
  );
}

/** Camino SVG de un polígono en pulgadas. */
function contorno(puntos: readonly Vec2[], ppi: number): string {
  return `M ${puntos.map((p) => `${p.x * ppi},${p.y * ppi}`).join(' L ')} Z`;
}

/** Un círculo expresado como camino, para tratarlo igual que un polígono. */
function circuloComoCamino(cx: number, cy: number, r: number): string {
  return `M ${cx - r},${cy} a ${r},${r} 0 1,0 ${2 * r},0 a ${r},${r} 0 1,0 ${-2 * r},0`;
}

/** Cada tipo de escenografía se lee de un vistazo por su color. */
const ESTILO_TERRENO: Record<
  TipoTerreno,
  { fondo: string; borde: string; texto: string; opacidad: number; etiqueta: string }
> = {
  bloqueo: { fondo: '#6b7280', borde: '#9ca3af', texto: '#111827', opacidad: 0.95, etiqueta: 'BLOQUEA' },
  obstaculo: { fondo: '#0e7490', borde: '#22d3ee', texto: '#e0f2fe', opacidad: 0.8, etiqueta: 'INTRANSITABLE' },
  cobertura: { fondo: '#a16207', borde: '#facc15', texto: '#111827', opacidad: 0.75, etiqueta: 'COBERTURA' },
};

/**
 * Token de puesto de mando, calcado del de la web: disco oscuro con el logo
 * de ZeroLore y dos aros interiores, uno continuo y otro a trazos. El color
 * del aro es la banderilla: azul o rojo según el dueño, gris si no es de nadie.
 */
const ARO_PUESTO: Record<string, { borde: string; interior: string; trazos: string; tinte: string }> = {
  A: { borde: '#569aff', interior: '#c2e2ff', trazos: '#aed6ff', tinte: '#84baff' },
  B: { borde: '#db4e4e', interior: '#ffd6d6', trazos: '#ffbaba', tinte: '#ff8484' },
  neutral: { borde: '#aab0bc', interior: '#c2cad6', trazos: '#aeb8c6', tinte: '#abb2bf' },
};

/** Icono de clase, el mismo que usa la web del juego en las fichas. */
const ICONO_CLASE: Record<string, string> = {
  Choque: 'choque.png',
  Elite: 'elite.png',
  Especialista: 'especialista.png',
  Comando: 'comando.png',
  Asaltante: 'asaltante.png',
  ArmasPesadas: 'arma_pesada.png',
  Monstruo: 'mosntruo.png',
  Vehiculo: 'vehiculo.png',
  Artilleria: 'artilleria.png',
  Heroe: 'heroe.png',
};

const COLOR_JUGADOR: Record<string, string> = {
  A: '#3b82f6', // azul
  B: '#ef4444', // rojo
};

/** Resultado de validar un destino de movimiento antes de soltarlo. */
export interface MovePreview {
  readonly ok: boolean;
  readonly distancia: number;
  readonly motivo: string;
  /** True si el destino solo es alcanzable corriendo (2 acciones). */
  readonly requiereCorrer: boolean;
}

export interface BoardProps {
  readonly state: GameState;
  readonly seleccionada: string | null;
  readonly onClickUnidad: (id: string) => void;
  readonly onMover: (destino: Vec2, correr: boolean) => void;
  /** Id de la unidad que puede arrastrarse ahora mismo, si la hay. */
  readonly arrastrable: string | null;
  /** Los tres anillos se dibujan siempre que haya unidad seleccionada. */
  readonly alcanceMovimiento: number | null;
  readonly alcanceCarrera: number | null;
  readonly alcanceArma: number | null;
  /**
   * Radio del anillo de Carga, ya con las peanas sumadas. El reglamento mide
   * la carga de peana a peana, así que un anillo trazado desde el centro
   * dejaría fuera objetivos que sí son alcanzables.
   */
  readonly alcanceCarga: { readonly radio: number; readonly pulgadas: number } | null;
  /** Si la acción sigue disponible; si no, el anillo se dibuja apagado. */
  readonly puedeMover: boolean;
  readonly puedeCorrer: boolean;
  /** Distancia máxima a la que se puede colocar la unidad ahora mismo. */
  readonly topeArrastre: number | null;
  /**
   * Distancia mínima. Al Correr es el Movimiento: quedarse dentro del anillo
   * verde gastaría 2 acciones para llegar a donde se llega con 1.
   */
  readonly minimoArrastre: number | null;
  /** Acción de desplazamiento elegida: activa el modo de colocación. */
  readonly modoColocacion: 'Mover' | 'Correr' | null;
  /** Qué acción manda para dibujar los anillos (elegida o resaltada). */
  readonly modoAnillos: 'Mover' | 'Correr' | null;
  /** Cancelar la acción en curso (botón derecho sobre el tablero). */
  readonly onCancelarAccion: () => void;
  /** Enemigos que pueden recibir el disparo seleccionado ahora mismo. */
  readonly objetivosMarcados: readonly string[];
  /** Objetivo ya elegido: lleva la retícula en vez del aro. */
  readonly objetivoElegido: string | null;
  /**
   * Centro de las auras cuando hay un movimiento hecho pero sin confirmar: la
   * casilla de salida. `null` el resto del tiempo, que es donde está la unidad.
   */
  readonly origenAuras: Vec2 | null;
  /** Apuntando un disparo: se traza la trayectoria y se evalúa la cobertura. */
  readonly apuntandoDisparo: boolean;
  /**
   * Acciones de la unidad activada, para la rueda que la rodea. `null` cuando
   * no toca enseñarla: sin unidad activada, o con una acción ya elegida.
   */
  readonly accionesRueda: readonly AccionDisponible[] | null;
  readonly accionResaltada: ActionKind | null;
  readonly onElegirAccion: (kind: ActionKind) => void;
  readonly onResaltarAccion: (kind: ActionKind | null) => void;
  readonly onTerminarActivacion: () => void;
  /**
   * Objetivo ya marcado de un ataque: se pinta un ✓ junto a él para rematar la
   * acción. Sustituye al panel con botones, que era otro cuadro más.
   */
  readonly confirmarSobreObjetivo: { readonly unitId: string; readonly hacer: () => void } | null;
  /** Movimiento sin confirmar: la rueda pregunta en vez de ofrecer acciones. */
  readonly confirmacionMovimiento: {
    readonly onAceptar: () => void;
    readonly onDeshacer: () => void;
  } | null;
  /** Unidad de la Reserva que se está colocando, si la hay. */
  readonly desplegando: EnReserva | null;
  readonly onDesplegar: (puestoId: string, posicion: Vec2) => void;
  readonly previewMovimiento: (destino: Vec2) => MovePreview;
}

export function Board({
  state,
  seleccionada,
  onClickUnidad,
  onMover,
  arrastrable,
  alcanceMovimiento,
  alcanceCarrera,
  alcanceArma,
  alcanceCarga,
  puedeMover,
  puedeCorrer,
  topeArrastre,
  minimoArrastre,
  modoColocacion,
  modoAnillos,
  onCancelarAccion,
  objetivosMarcados,
  objetivoElegido,
  origenAuras,
  apuntandoDisparo,
  accionesRueda,
  accionResaltada,
  onElegirAccion,
  onResaltarAccion,
  onTerminarActivacion,
  confirmacionMovimiento,
  confirmarSobreObjetivo,
  desplegando,
  onDesplegar,
  previewMovimiento,
}: BoardProps) {
  const w = MESA.ancho * PPI;
  const h = MESA.alto * PPI;
  const svgRef = useRef<SVGSVGElement>(null);
  const [arrastre, setArrastre] = useState<{ destino: Vec2; preview: MovePreview } | null>(null);
  /** Posición bajo el cursor en modo colocación, sin necesidad de arrastrar. */
  const [fantasma, setFantasma] = useState<{ destino: Vec2; preview: MovePreview } | null>(null);
  /** Último destino que cumplía todas las reglas, para no pintar nunca uno inválido. */
  const ultimoValido = useRef<Vec2 | null>(null);

  const sel = seleccionada ? state.units[seleccionada] : undefined;

  /** Unidad bajo el puntero: enseña su amenaza sin llegar a seleccionarla. */
  const [señalada, setSeñalada] = useState<string | null>(null);
  /** Sitio donde caería el refuerzo con el cursor donde está. */
  const [fantasmaRefuerzo, setFantasmaRefuerzo] =
    useState<{ puestoId: string; posicion: Vec2 } | null>(null);

  /*
    Los anillos de movimiento y el aura del arma no se anclan igual, porque no
    miden lo mismo.

    El movimiento se mide DESDE donde sale la unidad: su anillo se queda en la
    casilla de salida mientras colocas y hasta que confirmas. Al empezar OTRO
    movimiento vuelve a mandar la posición real, que es el nuevo punto de
    partida.
  */
  const centroMovimiento = !modoColocacion && origenAuras ? origenAuras : sel?.position;
  /*
    El alcance del arma, en cambio, es consecuencia de dónde ACABAS: sigue al
    fantasma mientras lo mueves, que es lo que responde a "si me pongo ahí,
    ¿a quién llego?".
  */
  const destinoVista = (arrastre ?? fantasma)?.destino;
  const centroArma = destinoVista ?? sel?.position;

  /** Puestos por los que la unidad en reserva puede entrar ahora mismo. */
  const puestosDisponibles = desplegando
    ? state.puestos.filter((pm) => puedeDesplegarEn(state, pm, desplegando.owner))
    : [];

  /**
   * Posición de despliegue a partir del cursor. La peana se encierra DENTRO del
   * puesto válido más cercano: no puede sobresalir, así que la unidad entra ya
   * ocupándolo y no se puede colocar a medias.
   */
  const destinoDespliegue = (cursor: Vec2): { puestoId: string; posicion: Vec2 } | null => {
    if (!desplegando) return null;
    const perfil = state.profiles[desplegando.profileId];
    if (!perfil) return null;
    const r = perfil.radioPeana;

    let mejor: { puestoId: string; posicion: Vec2; lejos: number } | null = null;
    for (const pm of puestosDisponibles) {
      if (pm.radio <= r) continue; // token más pequeño que la peana: no cabe
      /*
        El cursor tiene que estar DENTRO del token. Sin esto se buscaba el
        puesto más cercano desde cualquier punto de la mesa, así que soltando
        en mitad de la nada la unidad aparecía en un puesto que no habías
        elegido.
      */
      if (centerDistance(cursor, pm.centro) > pm.radio) continue;
      const posicion = encerrarEnPuesto(cursor, r, pm);
      /*
        Con las propias basta con no solaparse: la zona de control de 1\" es
        solo frente a enemigos. Pidiendo 1\" a todo el mundo, un puesto de 3\"
        con una unidad dentro no admitía refuerzos — justo el puesto que acabas
        de conquistar.
      */
      if (!libreDeUnidades(state, posicion, r, 0)) continue;
      const enemigoCerca = Object.values(state.units).some((u) => {
        if (u.owner === desplegando.owner || u.vidas <= 0) return false;
        const pu = state.profiles[u.profileId];
        return !!pu && baseDistance(posicion, r, u.position, pu.radioPeana) <= ZONA_CONTROL;
      });
      if (enemigoCerca) continue;
      if (state.terrain.some((t) => baseToRectDistance(posicion, r, t.rect) <= 1e-9)) continue;
      if (!dentroDelPuesto(posicion, r, pm)) continue;
      const lejos = centerDistance(cursor, posicion);
      if (!mejor || lejos < mejor.lejos) mejor = { puestoId: pm.id, posicion, lejos };
    }
    return mejor ? { puestoId: mejor.puestoId, posicion: mejor.posicion } : null;
  };

  /** Lo único que proyecta sombra sobre el aura del arma. */
  const bloqueos = useMemo(
    () => state.terrain.filter(bloqueaVision).map((t) => t.rect),
    [state.terrain],
  );
  /*
    La linterna: qué ve el arma desde donde está la unidad y, mientras se
    coloca, desde donde va a quedar. Se memoriza porque el fantasma la
    recalcula en cada movimiento del ratón.
  */
  const visionActual = useMemo(
    () => (centroArma && alcanceArma !== null ? poligonoDeVision(centroArma, alcanceArma, bloqueos) : null),
    [centroArma?.x, centroArma?.y, alcanceArma, bloqueos],
  );
  /*
    Amenaza de la unidad señalada: hasta dónde alcanza ELLA. Sirve para decidir
    un movimiento sabiendo desde dónde te van a poder disparar, sin tener que
    seleccionarla y perder la acción en curso.
  */
  const amenaza = useMemo(() => {
    const u = señalada ? state.units[señalada] : undefined;
    if (!u || u.vidas <= 0 || u.id === seleccionada) return null;
    const perfil = state.profiles[u.profileId];
    if (!perfil) return null;
    const arma = perfil.armas.find((w) => w.kind === 'disparo');
    if (arma && arma.kind === 'disparo') {
      return contorno(poligonoDeVision(u.position, arma.distancia, bloqueos), PPI);
    }
    // Sin arma a distancia, lo que amenaza es su carga.
    const alcance = perfil.movimiento + perfil.velocidad;
    return circuloComoCamino(u.position.x * PPI, u.position.y * PPI, alcance * PPI);
  }, [señalada, seleccionada, state.units, state.profiles, bloqueos]);


  // Al salir del modo colocación (cancelar, colocar, cambiar de unidad) el
  // fantasma tiene que irse: si no, se queda un destino dibujado que ya no
  // corresponde a ninguna acción en curso.
  useEffect(() => {
    if (!desplegando) setFantasmaRefuerzo(null);
  }, [desplegando]);

  useEffect(() => {
    if (!modoColocacion) setFantasma(null);
    ultimoValido.current = null;
  }, [modoColocacion, seleccionada]);

  /** Convierte coordenadas de pantalla a pulgadas de mesa. */
  const aPulgadas = (clientX: number, clientY: number): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * MESA.ancho,
      y: ((clientY - rect.top) / rect.height) * MESA.alto,
    };
  };

  const radioDe = (profileId: string): number => state.profiles[profileId]?.radioPeana ?? 0.63;

  /** Encaja el destino dentro del anillo permitido (tope y mínimo). */

  /**
   * Convierte la posición del cursor en un destino LEGAL.
   *
   * Se aplican las restricciones en cadena y se vuelve a ajustar al anillo,
   * porque expulsar de la escenografía o imantar a ella puede sacar la peana
   * del alcance. Si aun así no sale una posición válida, se conserva la última
   * que sí lo era: el fantasma nunca se pinta en rojo ni salta un aviso, ya
   * que el usuario solo puede soltar donde el juego le deja.
   */
  const destinoLegal = (crudo: Vec2): { destino: Vec2; preview: MovePreview } | null => {
    if (!sel) return null;
    const r = radioDe(sel.profileId);
    const opciones = {
      origen: sel.position,
      radio: r,
      cursor: crudo,
      tope: topeArrastre,
      minimo: minimoArrastre,
      mesa: MESA,
      terreno: state.terrain,
      puestos: state.puestos,
      unidades: otrasUnidades(state, sel.id, modoAnillos === 'Correr'),
      iman: IMAN,
    };

    const destino = destinoDeMovimiento(opciones);
    const preview = previewMovimiento(destino);
    if (preview.ok) {
      ultimoValido.current = destino;
      return { destino, preview };
    }

    /*
      La dirección pedida no vale —típico al Correr pegado a un muro, donde lo
      más lejos que se llega queda dentro del anillo mínimo—. Antes esto dejaba
      el fantasma en nada; ahora se mantiene el último bueno, y si todavía no
      hay ninguno se busca uno girando alrededor de la unidad.
    */
    const anterior = ultimoValido.current ?? buscarDestinoValido(opciones);
    if (!anterior) return null;
    ultimoValido.current = anterior;
    return { destino: anterior, preview: previewMovimiento(anterior) };
  };

  /** Barre el anillo en busca de un destino que cumpla todas las reglas. */
  const buscarDestinoValido = (
    opciones: Parameters<typeof destinoDeMovimiento>[0],
  ): Vec2 | null => {
    const alcance = opciones.tope ?? 1;
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const cursor = {
        x: opciones.origen.x + Math.cos(rad) * alcance,
        y: opciones.origen.y + Math.sin(rad) * alcance,
      };
      const p = destinoDeMovimiento({ ...opciones, cursor });
      if (previewMovimiento(p).ok) return p;
    }
    return null;
  };

  const iniciarArrastre = (e: React.PointerEvent, unitId: string): void => {
    if (e.button !== 0) return;
    if (unitId !== arrastrable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setArrastre(destinoLegal(aPulgadas(e.clientX, e.clientY)));
  };

  const moverArrastre = (e: React.PointerEvent): void => {
    if (desplegando) {
      setFantasmaRefuerzo(destinoDespliegue(aPulgadas(e.clientX, e.clientY)));
      return;
    }
    if (arrastre) {
      setArrastre(destinoLegal(aPulgadas(e.clientX, e.clientY)));
      return;
    }
    // Modo colocación: la unidad "sigue" al cursor sin arrastrar nada.
    if (modoColocacion && sel) {
      setFantasma(destinoLegal(aPulgadas(e.clientX, e.clientY)));
    }
  };

  /**
   * Botón derecho: cancela lo que se esté haciendo sin colocar nada. Evita
   * tener que ir al panel a pulsar Cancelar en mitad de una jugada.
   */
  const cancelar = (e: React.MouseEvent): void => {
    e.preventDefault();
    setArrastre(null);
    setFantasma(null);
    onCancelarAccion();
  };

  /** En modo colocación un clic en el tablero coloca la unidad. */
  const colocar = (e: React.MouseEvent): void => {
    // Solo el botón primario coloca. El secundario cancela, y sin este filtro
    // llegaba a disparar también la colocación antes de cancelarse.
    if (e.button !== 0) return;
    if (desplegando) {
      const sitio = fantasmaRefuerzo ?? destinoDespliegue(aPulgadas(e.clientX, e.clientY));
      if (!sitio) return;
      e.stopPropagation();
      setFantasmaRefuerzo(null);
      onDesplegar(sitio.puestoId, sitio.posicion);
      return;
    }
    if (!modoColocacion) return;
    /*
      Sin fantasma —un clic seco sin mover antes el ratón, o un toque en móvil,
      donde no hay hover— el destino se saca del propio clic. Exigir fantasma
      dejaba la colocación muerta en pantallas táctiles.
    */
    const vista = fantasma ?? destinoLegal(aPulgadas(e.clientX, e.clientY));
    if (!vista?.preview.ok) return;
    e.stopPropagation();
    setFantasma(null);
    onMover(vista.destino, vista.preview.requiereCorrer);
  };

  const soltarArrastre = (e: React.PointerEvent): void => {
    if (!arrastre) return;
    const { destino, preview } = arrastre;
    setArrastre(null);
    // Un arrastre de menos de media pulgada se interpreta como un clic
    // para seleccionar, no como una orden de movimiento.
    if (preview.distancia < 0.5) return;
    if (preview.ok) onMover(destino, preview.requiereCorrer);
    e.stopPropagation();
  };

  return (
    <svg
      ref={svgRef}
      className="board"
      viewBox={`0 0 ${w} ${h}`}
      onPointerMove={moverArrastre}
      onPointerUp={(e) => {
        // Soltar un refuerzo arrastrado desde la reserva también lo coloca.
        if (desplegando) colocar(e as unknown as React.MouseEvent);
        else soltarArrastre(e);
      }}
      onPointerLeave={() => setFantasma(null)}
      onClick={colocar}
      onContextMenu={cancelar}
      /*
        La proporción sale del mismo viewBox, para que la mesa quepa entera
        tanto si sobra ancho como si sobra alto. Sin ella, al quitar las bandas
        laterales el tablero se estiraba a lo ancho y se salía por abajo.
      */
      style={{ aspectRatio: `${w} / ${h}`, ...(modoColocacion ? { cursor: 'crosshair' as const } : {}) }}
      role="img"
      aria-label="Tablero de juego"
    >
      <defs>
        {/* Las unidades ya activadas se apagan un poco, lo justo para verse
            "dormidas" sin perder el color de bando: en rojo contra azul hay
            que seguir distinguiendo de quién es cada miniatura. */}
        <filter id="dormida">
          <feColorMatrix type="saturate" values="0.55" />
        </filter>
      </defs>

      <rect x={0} y={0} width={w} height={h} fill="#1d2229" />

      <g>
        {Array.from({ length: MESA.ancho + 1 }, (_, i) => (
          <line key={`v${i}`} x1={i * PPI} y1={0} x2={i * PPI} y2={h}
                stroke={i % 6 === 0 ? '#39424e' : '#262c34'} strokeWidth={1} />
        ))}
        {Array.from({ length: MESA.alto + 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * PPI} x2={w} y2={i * PPI}
                stroke={i % 6 === 0 ? '#39424e' : '#262c34'} strokeWidth={1} />
        ))}
      </g>

      {/*
        Puestos de mando: objetivos y, a la vez, los únicos puntos por donde
        entran refuerzos. La banderilla del color del dueño marca quién lo
        controla; sin banderilla, está en disputa.
      */}
      {state.puestos.map((pm) => {
        const cx = pm.centro.x * PPI;
        const cy = pm.centro.y * PPI;
        const r = pm.radio * PPI;
        /*
          El control se consolida al final del turno, pero el token cambia de
          color en cuanto alguien lo domina: así se ve sobre la marcha si te
          están quitando el puesto. Mientras no esté consolidado, el aro late.
        */
        const mando = controlTrasTurno(state, pm);
        const provisional = mando !== pm.duenio;
        const aro = ARO_PUESTO[mando ?? 'neutral']!;
        const logo = r * 1.32; // el logo ocupa dos tercios del token
        return (
          <g key={pm.id} style={{ pointerEvents: 'none' }}>
            <defs>
              <radialGradient id={`puesto-${pm.id}`} cx="50%" cy="46%" r="62%">
                <stop offset="0%" stopColor={aro.tinte} stopOpacity={0.26} />
                <stop offset="42%" stopColor="#1a202c" stopOpacity={0.4} />
                <stop offset="74%" stopColor="#0a0c12" stopOpacity={0.97} />
                <stop offset="100%" stopColor="#0a0c12" stopOpacity={0.99} />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={r} fill={`url(#puesto-${pm.id})`} stroke={aro.borde} strokeWidth={2}>
              {provisional && (
                <animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.3s" repeatCount="indefinite" />
              )}
            </circle>
            <circle cx={cx} cy={cy} r={r * 0.84} fill="none" stroke={aro.interior} strokeWidth={1} strokeOpacity={0.55} />
            <circle
              cx={cx} cy={cy} r={r * 0.6}
              fill="none" stroke={aro.trazos} strokeWidth={1} strokeOpacity={0.42} strokeDasharray="3 4"
            />
            <image
              href="/tokens/zerolore-mark.png"
              x={cx - logo / 2} y={cy - (logo * 388) / 624 / 2}
              width={logo} height={(logo * 388) / 624}
              opacity={0.92}
            />
            {/* El Cuartel General lleva un aro exterior: no es un puesto cualquiera. */}
            {pm.esCuartelGeneral && (
              <circle cx={cx} cy={cy} r={r + 3.5} fill="none" stroke={aro.borde} strokeWidth={1.2} strokeOpacity={0.55} />
            )}
            {/* Se está conquistando: el aro exterior avisa de que aún no es suyo. */}
            {provisional && (
              <circle
                cx={cx} cy={cy} r={r + 6} fill="none"
                stroke={aro.borde} strokeWidth={1.6} strokeDasharray="5 5" strokeOpacity={0.8}
              >
                <animate attributeName="stroke-opacity" values="0.8;0.2;0.8" dur="1.3s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        );
      })}

      {/* Escenografía: cuadrados, con color según su efecto en las reglas. */}
      {state.terrain.map((t) => {
        const estilo = ESTILO_TERRENO[t.tipo];
        return (
          <g key={t.id} style={{ pointerEvents: 'none' }}>
            <rect
              x={t.rect.x * PPI}
              y={t.rect.y * PPI}
              width={t.rect.width * PPI}
              height={t.rect.height * PPI}
              fill={estilo.fondo}
              fillOpacity={estilo.opacidad}
              stroke={estilo.borde}
              strokeWidth={2}
              rx={2}
            />
            <text
              x={(t.rect.x + t.rect.width / 2) * PPI}
              y={(t.rect.y + t.rect.height / 2) * PPI + 4}
              textAnchor="middle" fontSize={11} fill={estilo.texto} fontWeight={700}
            >
              {estilo.etiqueta}
            </text>
          </g>
        );
      })}

      {/*
        Anillos de la unidad seleccionada: movimiento, carrera y alcance del
        arma. Solo se dibujan los de acciones que todavía puede hacer; el del
        arma se queda siempre, porque su alcance no depende de las acciones
        que le queden.
      */}
      {sel && centroMovimiento && centroArma && (() => {
        const cx = centroMovimiento.x * PPI;
        const cy = centroMovimiento.y * PPI;
        const ax = centroArma.x * PPI;
        const ay = centroArma.y * PPI;

/*
          Los anillos van sin rótulo: el color ya dice de qué acción es cada uno
          y las distancias están en la ficha. Etiquetarlos llenaba el tablero de
          letras que solo hacen falta las primeras partidas.
        */
        const anillo = (id: string, radio: number, color: string, relleno = true) => (
          <g key={id}>
            {relleno && <defs><Degradado id={id} color={color} cx={cx} cy={cy} r={radio * PPI} /></defs>}
            <circle
              cx={cx} cy={cy} r={radio * PPI}
              fill={relleno ? `url(#${id})` : 'none'}
              stroke={color} strokeWidth={1.8} strokeOpacity={0.95}
            />
          </g>
        );

        /**
         * Corona entre el anillo de Mover y el de Correr: la única zona donde
         * se puede terminar una carrera. Se dibuja con dos círculos y
         * fill-rule evenodd, que deja el centro hueco sin tapar la rejilla.
         */
        const corona = (r: number, R: number): string =>
          `M ${cx - R},${cy} a ${R},${R} 0 1,0 ${2 * R},0 a ${R},${R} 0 1,0 ${-2 * R},0 ` +
          `M ${cx - r},${cy} a ${r},${r} 0 1,0 ${2 * r},0 a ${r},${r} 0 1,0 ${-2 * r},0`;

        return (
          <g style={{ pointerEvents: 'none' }}>
            {modoAnillos === 'Correr' && puedeCorrer && alcanceCarrera !== null && alcanceMovimiento !== null && (
              <>
                <defs>
                  <Degradado
                    id="aura-corona" color="#14b8a6" cx={cx} cy={cy}
                    r={alcanceCarrera * PPI} desde={alcanceMovimiento / alcanceCarrera}
                  />
                </defs>
                <path
                  d={corona(alcanceMovimiento * PPI, alcanceCarrera * PPI)}
                  fillRule="evenodd"
                  fill="url(#aura-corona)"
                />
              </>
            )}
            {/*
              El aura del arma no es un círculo sino lo que se ve de verdad
              desde aquí: la escenografía que bloquea proyecta su sombra y esa
              zona queda fuera.

              Viaja con el fantasma mientras colocas: enseña a quién llegarías
              disparando DESDE ahí, que es lo que decide si el sitio vale.
            */}
            {alcanceArma !== null && visionActual && (
              <g>
                <defs>
                  <Degradado id="aura-arma" color={ROJO_ATAQUE} cx={ax} cy={ay} r={alcanceArma * PPI} />
                </defs>
                <path
                  d={contorno(visionActual, PPI)}
                  fill="url(#aura-arma)"
                  stroke={ROJO_ATAQUE} strokeWidth={1.8} strokeOpacity={0.95} strokeLinejoin="round"
                />
              </g>
            )}
            {alcanceCarga !== null &&
              anillo('aura-carga', alcanceCarga.radio, AMBAR_COBERTURA)}
            {/* El área de Correr la pinta la corona, no el círculo entero. */}
            {alcanceCarrera !== null && puedeCorrer &&
              anillo('aura-correr', alcanceCarrera, '#14b8a6', false)}
            {/*
              Al Correr, el círculo interior no es una alternativa: es el borde
              de la zona válida. Se pinta del mismo turquesa y sin etiqueta,
              porque etiquetarlo como "Mover" invitaba a soltar ahí dentro.
            */}
            {alcanceMovimiento !== null &&
              (modoAnillos === 'Correr'
                ? puedeCorrer && anillo('aura-mover-borde', alcanceMovimiento, '#14b8a6', false)
                : puedeMover && anillo('aura-mover', alcanceMovimiento, '#22c55e'))}
          </g>
        );
      })()}

      {/*
        Combates en curso: una línea entre las dos unidades trabadas y un
        distintivo de espadas cruzadas en el punto medio. Se lee de un vistazo
        quién está peleando con quién, sin tener que abrir ninguna ficha.
      */}
      <g style={{ pointerEvents: 'none' }}>
        {Object.values(state.units).flatMap((u) =>
          u.trabadaCon
            .filter((otro) => u.id < otro)
            .map((otro) => {
              const o = state.units[otro];
              if (!o || u.vidas <= 0 || o.vidas <= 0) return null;
              const x1 = u.position.x * PPI;
              const y1 = u.position.y * PPI;
              const x2 = o.position.x * PPI;
              const y2 = o.position.y * PPI;
              // Las unidades trabadas están en contacto de peana, así que el
              // punto medio cae encima de ellas. El distintivo se desplaza
              // perpendicular a la línea para que se lea.
              const dx = x2 - x1;
              const dy = y2 - y1;
              const largo = Math.hypot(dx, dy) || 1;
              const sep = 30;
              const mx = (x1 + x2) / 2 + (-dy / largo) * sep;
              const my = (y1 + y2) / 2 + (dx / largo) * sep;
              const e = 9; // media longitud de cada espada
              return (
                /* Solo las espadas: el disco, el aura y la línea saturaban la
                   zona justo donde hay que leer las vidas de los combatientes. */
                <g key={`${u.id}-${otro}`}>
                  <g stroke="#0b0e13" strokeWidth={5} strokeLinecap="round">
                    <line x1={mx - e} y1={my + e} x2={mx + e} y2={my - e} />
                    <line x1={mx + e} y1={my + e} x2={mx - e} y2={my - e} />
                  </g>
                  <g stroke="#fbbf24" strokeWidth={2.4} strokeLinecap="round">
                    <line x1={mx - e} y1={my + e} x2={mx + e} y2={my - e} />
                    <line x1={mx + e} y1={my + e} x2={mx - e} y2={my - e} />
                    <line x1={mx - e + 1} y1={my + e - 5} x2={mx - e + 5} y2={my + e - 1} strokeWidth={2.5} />
                    <line x1={mx + e - 5} y1={my + e - 1} x2={mx + e - 1} y2={my + e - 5} strokeWidth={2.5} />
                  </g>
                </g>
              );
            }),
        )}
      </g>

      {/* Previsualización: fantasma, línea y distancia. Vale para el arrastre
          y para el modo colocación, que usan la misma pintura. */}
      {(arrastre ?? fantasma) && sel && (() => {
        const vista = (arrastre ?? fantasma)!;
        return (
        <g style={{ pointerEvents: 'none' }}>
          {/*
            El alcance del arma viajando con el fantasma: enseña hasta dónde
            llegarías disparando DESDE ese sitio, que es lo que decide si la
            posición vale la pena.
          */}
          {/*
            El recorrido, con sus codos: si hay que rodear una esquina la línea
            se dobla por ella, que es por donde va a pasar la miniatura de
            verdad y lo que se le cobra de movimiento.
          */}
          <polyline
            points={caminoHasta(sel.position, vista.destino, radioDe(sel.profileId), state.terrain)
              .map((q) => `${q.x * PPI},${q.y * PPI}`)
              .join(' ')}
            fill="none"
            stroke={vista.preview.ok ? '#22c55e' : '#ef4444'}
            strokeWidth={2.5} strokeDasharray="6 4" strokeLinejoin="round"
          />
          <circle
            cx={vista.destino.x * PPI} cy={vista.destino.y * PPI} r={14}
            fill={vista.preview.ok ? '#22c55e' : '#ef4444'} fillOpacity={0.3}
            stroke={vista.preview.ok ? '#22c55e' : '#ef4444'} strokeWidth={2}
            strokeDasharray={vista.preview.requiereCorrer ? '4 3' : undefined}
          />
          <rect
            x={vista.destino.x * PPI + 18} y={vista.destino.y * PPI - 26}
            width={vista.preview.ok ? (vista.preview.requiereCorrer ? 118 : 62) : 190}
            height={20} rx={4}
            fill="#0b1220" fillOpacity={0.9}
            stroke={vista.preview.ok ? '#22c55e' : '#ef4444'}
          />
          <text
            x={vista.destino.x * PPI + 24} y={vista.destino.y * PPI - 12}
            fontSize={12} fill={vista.preview.ok ? '#86efac' : '#fca5a5'} fontWeight={600}
          >
            {vista.preview.ok
              ? `${vista.preview.distancia.toFixed(1)}"${vista.preview.requiereCorrer ? ' · CORRER' : ''}`
              : vista.preview.motivo}
          </text>
        </g>
        );
      })()}

      {/*
        Trayectoria del disparo. La cobertura no es una propiedad del sitio
        donde está el defensor sino de la línea: si el murete queda al otro
        lado, no tapa nada. Se dibuja el mismo segmento que evalúa la regla
        para que lo que se ve y lo que se aplica no puedan discrepar.
      */}
      {apuntandoDisparo && (() => {
        const tirador = seleccionada ? state.units[seleccionada] : null;
        const blanco = objetivoElegido ? state.units[objetivoElegido] : null;
        const perfilBlanco = blanco ? state.profiles[blanco.profileId] : null;
        if (!tirador || !blanco || !perfilBlanco) return null;

        const cubren = coberturasDeTiro(state, tirador, blanco, perfilBlanco);
        const cubierto = cubren.length > 0;
        const color = cubierto ? AMBAR_COBERTURA : ROJO_ATAQUE;

        const x1 = tirador.position.x * PPI;
        const y1 = tirador.position.y * PPI;
        const x2 = blanco.position.x * PPI;
        const y2 = blanco.position.y * PPI;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        // La punta se detiene en el borde de la peana, no en el centro.
        const rBlanco = Math.max(perfilBlanco.radioPeana * PPI, 13);
        const px = x2 - Math.cos(ang) * rBlanco;
        const py = y2 - Math.sin(ang) * rBlanco;
        const ala = 7;

        return (
          <g style={{ pointerEvents: 'none' }}>
            {/* Los elementos que sí se interponen se remarcan. */}
            {state.terrain
              .filter((t) => cubren.includes(t.id))
              .map((t) => (
                <rect
                  key={`cob-${t.id}`}
                  x={t.rect.x * PPI} y={t.rect.y * PPI}
                  width={t.rect.width * PPI} height={t.rect.height * PPI}
                  fill="none" stroke={AMBAR_COBERTURA} strokeWidth={3} rx={2}
                />
              ))}
            {/* Trazo oscuro debajo: la línea se lee sobre cualquier fondo. */}
            <line x1={x1} y1={y1} x2={px} y2={py} stroke="#0b0e13" strokeWidth={5} strokeLinecap="round" />
            <line
              x1={x1} y1={y1} x2={px} y2={py}
              stroke={color} strokeWidth={2.2} strokeLinecap="round"
              strokeDasharray="7 5"
            >
              <animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.5s" repeatCount="indefinite" />
            </line>
            <path
              d={`M ${px} ${py} L ${px - Math.cos(ang - 0.42) * ala} ${py - Math.sin(ang - 0.42) * ala} M ${px} ${py} L ${px - Math.cos(ang + 0.42) * ala} ${py - Math.sin(ang + 0.42) * ala}`}
              stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none"
            />
            {cubierto && (
              <text
                x={(x1 + px) / 2} y={(y1 + py) / 2 - 8}
                textAnchor="middle" fontSize={11} fontWeight={700}
                fill={AMBAR_COBERTURA} stroke="#0b0e13" strokeWidth={3} paintOrder="stroke"
              >
                COBERTURA
              </text>
            )}
          </g>
        );
      })()}

      {/*
        Amenaza de la unidad señalada con el puntero. Sin relleno degradado y a
        trazos finos, para que se distinga de las auras de la unidad en juego
        aunque se solapen.
      */}
      {amenaza && (
        <g style={{ pointerEvents: 'none' }}>
          <path
            d={amenaza}
            fill={NARANJA_AMENAZA} fillOpacity={0.05}
            stroke={NARANJA_AMENAZA} strokeWidth={1.4} strokeDasharray="3 6" strokeLinejoin="round"
          />
        </g>
      )}

      {/*
        Refuerzos: se resalta cada puesto por el que pueden entrar y se pega la
        peana a su borde. El reglamento pide contacto exacto con el puesto, así
        que no se deja soltar a mano en cualquier punto.
      */}
      {desplegando && (() => {
        const perfil = state.profiles[desplegando.profileId];
        if (!perfil) return null;
        const rp = perfil.radioPeana * PPI;
        const color = COLOR_JUGADOR[desplegando.owner] ?? '#94a3b8';
        return (
          <g style={{ pointerEvents: 'none' }}>
            {puestosDisponibles.map((pm) => (
              <circle
                key={`entrada-${pm.id}`}
                cx={pm.centro.x * PPI} cy={pm.centro.y * PPI}
                r={Math.max(0, pm.radio - perfil.radioPeana) * PPI}
                fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="4 5" strokeOpacity={0.85}
              >
                <animate attributeName="stroke-opacity" values="0.85;0.3;0.85" dur="1.6s" repeatCount="indefinite" />
              </circle>
            ))}
            {fantasmaRefuerzo && (
              <circle
                cx={fantasmaRefuerzo.posicion.x * PPI} cy={fantasmaRefuerzo.posicion.y * PPI} r={rp}
                fill={color} fillOpacity={0.45} stroke={color} strokeWidth={2}
              />
            )}
          </g>
        );
      })()}

      {/* Unidades: círculos. */}
      {Object.values(state.units).map((u) => {
        const p = state.profiles[u.profileId];
        if (!p) return null;
        const muerta = u.vidas <= 0;
        const cx = u.position.x * PPI;
        const cy = u.position.y * PPI;
        const r = Math.max(p.radioPeana * PPI, 13);
        const color = COLOR_JUGADOR[u.owner] ?? '#94a3b8';
        const puedeArrastrarse = u.id === arrastrable;
        const trabada = u.trabadaCon.length > 0 && !muerta;
        /*
          Pegada a una cobertura lo bastante alta: puede beneficiarse de ella.
          Si acaba aplicándose depende de desde dónde le disparen — eso lo dice
          la línea de tiro —, pero como indicador de "estoy resguardado" es lo
          que importa ver. Pegarse a un muro o al agua no pinta escudo: esos no
          cubren nunca.
        */
        const enCobertura = state.terrain.some(
          (t) =>
            esCobertura(t) &&
            t.altura * 2 >= 2 &&
            baseToRectDistance(u.position, p.radioPeana, t.rect) <= 1e-6,
        );

        return (
          /*
            El grupo se posiciona con transform y los hijos se dibujan en
            coordenadas relativas: así basta una transición CSS para que la
            miniatura se DESPLACE al moverse o al cargar, en vez de aparecer
            de golpe en el destino.
          */
          <g
            key={u.id}
            transform={`translate(${cx}, ${cy})`}
            style={{
              transition: arrastre ? 'none' : 'transform .38s cubic-bezier(.2,.7,.3,1)',
              cursor: muerta
                ? 'default'
                : objetivosMarcados.includes(u.id)
                  ? 'crosshair'
                  : puedeArrastrarse
                    ? 'grab'
                    : 'pointer',
            }}
            opacity={muerta ? 0.55 : 1}
            filter={u.activated && !muerta ? 'url(#dormida)' : undefined}
            onMouseEnter={() => setSeñalada(u.id)}
            onMouseLeave={() => setSeñalada((actual) => (actual === u.id ? null : actual))}
            onPointerDown={(e) => iniciarArrastre(e, u.id)}
            onClick={(e) => {
              if (modoColocacion && !objetivosMarcados.includes(u.id)) return;
              e.stopPropagation();
              if (!muerta && !arrastre) onClickUnidad(u.id);
            }}
          >
            {/* Objetivo posible: aro que late. Elegido: retícula de corchetes. */}
            {objetivosMarcados.includes(u.id) && u.id !== objetivoElegido && (
              <circle cx={0} cy={0} r={r + 7} fill="none" stroke="#ef4444" strokeWidth={2.5} opacity={0.85}>
                <animate attributeName="r" values={`${r + 5};${r + 11};${r + 5}`} dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.35;0.9" dur="1.4s" repeatCount="indefinite" />
              </circle>
            )}
            {u.id === objetivoElegido && (() => {
              const d = r + 11;
              const b = r * 0.55;
              const esquinas = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const;
              return (
                <g style={{ pointerEvents: 'none' }} stroke="#ef4444" strokeWidth={2.5} fill="none" strokeLinecap="round">
                  {esquinas.map(([sx, sy], i) => (
                    <path key={i} d={`M ${sx * d} ${sy * d - sy * b} L ${sx * d} ${sy * d} L ${sx * d - sx * b} ${sy * d}`} />
                  ))}
                  <line x1={0} y1={-d - 4} x2={0} y2={-d + 2} />
                  <line x1={0} y1={d - 2} x2={0} y2={d + 4} />
                  <line x1={-d - 4} y1={0} x2={-d + 2} y2={0} />
                  <line x1={d - 2} y1={0} x2={d + 4} y2={0} />
                </g>
              );
            })()}

            {puedeArrastrarse && (
              <circle cx={0} cy={0} r={r + 6} fill="none" stroke="#22c55e" strokeWidth={2} opacity={0.8}>
                <animate attributeName="opacity" values="0.8;0.25;0.8" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}

            <circle cx={0} cy={0} r={p.radioPeana * PPI} fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
            {/*
              Disco oscuro con el icono de la clase dentro y el marco del color
              del bando. El icono dice de un vistazo QUÉ es la unidad, que es lo
              que hace falta al mirar la mesa; el id solo servía para nombrarla.
            */}
            <circle
              cx={0} cy={0} r={r}
              fill="#0c1118"
              fillOpacity={0.96}
              stroke={color}
              strokeWidth={u.id === seleccionada ? 3.5 : 2.5}
            />
            {u.id === seleccionada && (
              <circle cx={0} cy={0} r={r + 3} fill="none" stroke="#fff" strokeWidth={1.4} opacity={0.85} />
            )}
            {/* ✓ para rematar el ataque, pegado al objetivo elegido. */}
            {confirmarSobreObjetivo?.unitId === u.id && (
              <g
                className="rueda-item aceptar confirmar-ataque"
                transform={`translate(${r + 16}, ${-r - 16})`}
                onClick={(e) => { e.stopPropagation(); confirmarSobreObjetivo.hacer(); }}
              >
                <circle className="fondo" cx={0} cy={0} r={14} />
                <g className="icono" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M-5.5 0 L-1.5 4.5 L6 -4.5" />
                </g>
              </g>
            )}

            {/* La rueda vive dentro del grupo de la unidad: la sigue sola. */}
            {u.id === seleccionada && accionesRueda && (
              <RuedaAcciones
                acciones={accionesRueda}
                radio={r}
                desplazamiento={(() => {
                  // Radio del anillo más el icono, para no cortarlo en el borde.
                  const m = r + 28 + 17;
                  return {
                    x: Math.max(0, m - cx) + Math.min(0, w - (cx + m)),
                    y: Math.max(0, m - cy) + Math.min(0, h - (cy + m)),
                  };
                })()}
                resaltada={accionResaltada}
                onElegir={onElegirAccion}
                onResaltar={onResaltarAccion}
                onTerminar={onTerminarActivacion}
                confirmacion={confirmacionMovimiento}
              />
            )}
            {!muerta && (
              <image
                href={`/clases/${ICONO_CLASE[p.clase] ?? 'choque.png'}`}
                x={-r * 0.62} y={-r * 0.62} width={r * 1.24} height={r * 1.24}
                opacity={0.95} style={{ pointerEvents: 'none' }}
              />
            )}

            {!muerta && (() => {
              // Solo la barra: la cifra exacta de vidas vive en la ficha.
              const fraccion = p.vidas > 0 ? u.vidas / p.vidas : 0;
              const ancho = r * 2;
              const alto = 5;
              const by = r + 4;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={-r} y={by} width={ancho} height={alto} rx={2}
                        fill="#0b1220" fillOpacity={0.85} stroke="#0f172a" strokeWidth={1} />
                  <rect x={-r} y={by} width={Math.max(0, ancho * fraccion)} height={alto} rx={2}
                        fill={colorVida(u.vidas, p.vidas)} />
                </g>
              );
            })()}

            {/*
              Escudo: la unidad está pegada a un elemento de escenografía que
              puede darle cobertura. Va debajo del zZ, en el mismo ámbar de las
              coberturas del tablero.
            */}
            {enCobertura && !muerta && (
              <g style={{ pointerEvents: 'none' }} transform={`translate(${r + 6}, ${r - 4})`}>
                <path
                  d="M 0 -7 L 6 -4 L 6 2 Q 6 7 0 9 Q -6 7 -6 2 L -6 -4 Z"
                  fill="#fbbf24" stroke="#0b0e13" strokeWidth={1.5} paintOrder="stroke"
                />
              </g>
            )}

            {/* Dormida solo si no está trabada: en combate manda el aura. */}
            {u.activated && !muerta && !trabada && (
              <text x={r + 2} y={-r + 2} fontSize={12} fontWeight={800} fill="#e2e8f0"
                    stroke="#0b1220" strokeWidth={2.5} paintOrder="stroke"
                    style={{ pointerEvents: 'none' }}>
                zZ
              </text>
            )}

            {muerta && (
              <g style={{ pointerEvents: 'none' }}>
                <circle cx={0} cy={0} r={r} fill="#0b0e13" fillOpacity={0.85} stroke="#64748b" strokeWidth={2} />
                <circle cx={0} cy={-2} r={r * 0.52} fill="#e2e8f0" />
                <rect x={-r * 0.3} y={r * 0.24} width={r * 0.6} height={r * 0.34} rx={1.5} fill="#e2e8f0" />
                <circle cx={-r * 0.2} cy={-r * 0.1} r={r * 0.15} fill="#0b0e13" />
                <circle cx={r * 0.2} cy={-r * 0.1} r={r * 0.15} fill="#0b0e13" />
                <rect x={-r * 0.05} y={r * 0.12} width={r * 0.1} height={r * 0.12} fill="#0b0e13" />
                <line x1={-r * 0.1} y1={r * 0.24} x2={-r * 0.1} y2={r * 0.58} stroke="#0b0e13" strokeWidth={1.2} />
                <line x1={r * 0.1} y1={r * 0.24} x2={r * 0.1} y2={r * 0.58} stroke="#0b0e13" strokeWidth={1.2} />
                <text x={0} y={r + 16} textAnchor="middle" fontSize={10} fill="#94a3b8">baja</text>
              </g>
            )}
          </g>
        );
      })}

    </svg>
  );
}
