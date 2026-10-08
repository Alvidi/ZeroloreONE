import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, baseDistance, baseSolapaRect, hasCover, type ActionKind, type GameEvent, type GameState, type MeleeWeapon, type PlayerId, type RangedWeapon, type Unit, type Vec2 } from '@zerolore/core';
import { Board, type MovePreview } from './Board.tsx';
import { Dado } from './Dado.tsx';
import { Combate, type CombateEnCurso } from './Combate.tsx';
import { Ficha } from './Ficha.tsx';
import { Hoja } from './Hoja.tsx';
import { TiradaIniciativa } from './TiradaIniciativa.tsx';
import { Compania } from './Compania.tsx';
import { Prevision } from './Prevision.tsx';
import { siguienteJugada } from './ia.ts';
import { accionesDisponibles, motivoNoActivable, objetivosDeCaC, objetivosDeCarga, objetivosDeDisparo } from './acciones.ts';
import { puedeDesplegarEn } from '@zerolore/core';
import { opcionesMovimiento } from './movimiento.ts';
import { HABILIDADES_ARMA, HABILIDADES_UNIDAD, LISTA_A, LISTA_B, MESA, createGame } from './setup.ts';

/**
 * Espera antes de abrir el pop-up de carga: lo que dura la animación de
 * aproximación (0,38 s) más un margen para que se vea llegar.
 */
const MS_APROXIMACION = 900;
/** Pausa entre jugadas de la máquina: sin ella la partida se resuelve de golpe. */
const MS_JUGADA_IA = 650;
/** Lo que se tarda en pasar de turno solo: lo justo para ver que ha pasado. */
const MS_FIN_DE_TURNO = 900;
/** Y en tirar la iniciativa del turno nuevo. */
const MS_TIRAR_INICIATIVA = 400;
/** Y en cerrar la activación de una unidad que ya no puede hacer nada. */
const MS_CERRAR_ACTIVACION = 700;

function describe(e: GameEvent, state: GameState): string {
  const nombre = (id: string): string => {
    const u = state.units[id];
    const p = u ? state.profiles[u.profileId] : undefined;
    return p ? `${id} ${p.nombre}` : id;
  };
  switch (e.type) {
    case 'TurnoIniciado': return `— Turno ${e.turno} —`;
    case 'IniciativaTirada':
      return `Iniciativa: ${Object.entries(e.tiradas).map(([p, d]) => `${p}=${d}`).join('  ')} → empieza ${e.orden[0]}`;
    case 'UnidadActivada': return `${nombre(e.unitId)} se activa`;
    case 'UnidadMovida': return `${nombre(e.unitId)} avanza ${e.distancia.toFixed(1)}"`;
    case 'UnidadDesplegada': return `${nombre(e.unitId)} entra por ${e.puestoId}`;
    case 'PuestoConquistado':
      return e.jugador
        ? `${e.puestoId}: lo controla ${e.jugador}${e.anterior ? ` (se lo quita a ${e.anterior})` : ''}`
        : `${e.puestoId} queda sin dueño`;
    case 'DisparoResuelto': {
      const r = e.resultado;
      return `${nombre(e.attackerId)} dispara ${e.arma} → [${r.dadosAtaque.join(',')}] ${r.impactos}+${r.criticos}cr | salva [${r.dadosSalvacion.join(',')}] vs ${r.umbralSalvacion}+ | daño ${r.danioTotal}`;
    }
    case 'CargaResuelta':
      return `${nombre(e.unitId)} carga a ${nombre(e.targetId)}: 1D6=${e.dado} ${e.exito ? '✔ traba' : '✘ se frena'}`;
    case 'BarridoDeclarado': return `${nombre(e.unitId)} usa Barrido contra ${e.objetivos.join(', ')}`;
    case 'CaCResuelto': {
      const r = e.resultado;
      return `${nombre(e.attackerId)} ataca con ${e.arma} → ${r.impactos}+${r.criticos}cr | daño ${r.danioTotal}`;
    }
    case 'DestrabeResuelto':
      return `${nombre(e.unitId)} destrabe: 1D6=${e.dado} ${e.exito ? '✔ libre' : '✘ atrapada'}`;
    case 'DanioAplicado': return `   ↳ ${nombre(e.unitId)} −${e.danio} (quedan ${e.vidasRestantes})`;
    case 'UnidadDestruida': return `   ☠ ${nombre(e.unitId)} destruida`;
    case 'ExplosivaAlcanza':
      return `   ✹ Explosiva: ${e.afectados.map(nombre).join(', ')} sufre${e.afectados.length > 1 ? 'n' : ''} ${e.danio}`;
    case 'UnidadRetirada': return `${e.unitId} se retira del campo de batalla`;
    case 'ActivacionTerminada': return `${nombre(e.unitId)} termina su activación`;
    case 'TurnoTerminado': return `— fin del turno ${e.turno} —`;
    case 'PartidaTerminada': return `PARTIDA TERMINADA. Gana ${e.ganador ?? 'nadie'}`;
    default: return e.type;
  }
}

/**
 * Semilla nueva para cada partida.
 *
 * El motor es determinista a propósito —la misma semilla da los mismos dados,
 * y eso es lo que permite deshacer sin rebuscar tiradas—, pero la semilla de
 * partida tiene que cambiar. Estaba fija en 2024, así que "Nueva partida"
 * repetía siempre la misma partida con los mismos dados, y la iniciativa del
 * primer turno la ganaba siempre el mismo bando.
 *
 * Se saca del generador criptográfico del navegador: aquí sí toca azar de
 * verdad, porque es lo único que NO debe poder repetirse.
 */
function semillaAleatoria(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_647;
}

export function App() {
  const [semilla, setSemilla] = useState(semillaAleatoria);
  const engineRef = useRef<Engine>(
    new Engine(createGame(LISTA_A, LISTA_B, semilla), [], { habilidadesArma: HABILIDADES_ARMA, habilidadesUnidad: HABILIDADES_UNIDAD }),
  );
  const [, forceRender] = useState(0);
  const refresh = useCallback(() => forceRender((n) => n + 1), []);

  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [objetivo, setObjetivo] = useState<string | null>(null);
  /**
   * Instantáneas previas a cada comando. Permiten deshacer: colocar una
   * unidad deja de ser irreversible, que era lo que hacía incómodo probar
   * posiciones antes de decidirse.
   */
  const historialRef = useRef<
    { state: GameState; log: readonly GameEvent[]; cmd: Parameters<Engine['execute']>[0] }[]
  >([]);
  /**
   * Longitud del historial en el momento de confirmar una posición. Mientras
   * el historial no crezca por encima de esta marca, no se ofrece deshacer.
   */
  const [confirmadoHasta, setConfirmadoHasta] = useState(0);
  /** Unidad de la Reserva que el jugador está colocando, si la hay. */
  const [refuerzo, setRefuerzo] = useState<string | null>(null);
  /*
    A quién le toca DESPLEGAR durante la Fase de Iniciativa. El reglamento manda
    alternar unidad por unidad empezando por quien ganó la tirada; en activaciones
    manda el motor, aquí no.
  */
  /** Qué bandos lleva la máquina. Con los dos puestos, la partida se juega sola. */
  const [ia, setIa] = useState<Record<string, boolean>>({ A: false, B: true });
  /** Hoja abierta encima del tablero, si hay alguna. */
  const [hoja, setHoja] = useState<'partida' | null>(null);
  /** Acción elegida en el desplegable: filtra qué anillos se dibujan. */
  const [accionElegida, setAccionElegida] = useState<ActionKind | null>(null);
  /** Arma a distancia seleccionada mientras se apunta. */
  const [armaElegida, setArmaElegida] = useState<string | null>(null);
  /** Acción bajo el ratón en el desplegable: enseña su aura sin elegirla. */
  const [accionResaltada, setAccionResaltada] = useState<ActionKind | null>(null);
  /** Ataque pendiente de narrar en el pop-up de combate. */
  const [combate, setCombate] = useState<CombateEnCurso | null>(null);
  /** Tirada suelta que no es un ataque (destrabe, chequeos varios). */
  const [tirada, setTirada] = useState<
    { titulo: string; dado: number; exito: boolean; texto: string } | null
  >(null);

  /**
   * Solo puede haber un pop-up a la vez. Sin esto, una tirada abierta durante
   * un combate se dibujaba DEBAJO y quedaba invisible, dando la sensación de
   * que la acción no había ocurrido.
   */
  const abrirCombate = (c: CombateEnCurso): void => {
    setTirada(null);
    setCombate(c);
  };
  const abrirTirada = (t: { titulo: string; dado: number; exito: boolean; texto: string }): void => {
    setCombate(null);
    setTirada(t);
  };
  const [aviso, setAviso] = useState<string | null>(null);
  /** Tiradas de la última Iniciativa, para mostrarlas en pantalla. */
  const [iniciativa, setIniciativa] = useState<{ tiradas: Record<PlayerId, number>; orden: readonly PlayerId[] } | null>(null);

  const engine = engineRef.current;
  const state = engine.getState();
  const activa = state.unidadActiva;

  const run = (cmd: Parameters<Engine['execute']>[0]): boolean => {
    const antes = { state: engine.getState(), log: engine.getLog().slice(), cmd };
    const r = engine.execute(cmd);
    if (r.ok) {
      historialRef.current.push(antes);
      // No hace falta guardar la partida entera: 30 pasos sobran de sobra.
      if (historialRef.current.length > 30) historialRef.current.shift();
    }
    setAviso(r.ok ? null : r.reason);
    refresh();
    return r.ok;
  };

  const deshacer = (): void => {
    const previo = historialRef.current.pop();
    if (!previo) return;
    engineRef.current = new Engine(previo.state, previo.log, { habilidadesArma: HABILIDADES_ARMA, habilidadesUnidad: HABILIDADES_UNIDAD });
    setAviso(null);
    setObjetivo(null);
    refresh();
  };

  /**
   * `repetir` vuelve a jugar con la misma semilla —útil para reproducir una
   * partida concreta—; sin él, cada partida nueva estrena semilla.
   */
  const nuevaPartida = (repetir = false): void => {
    const semillaDeEsta = repetir ? semilla : semillaAleatoria();
    setSemilla(semillaDeEsta);
    engineRef.current = new Engine(createGame(LISTA_A, LISTA_B, semillaDeEsta), [], {
      habilidadesArma: HABILIDADES_ARMA,
      habilidadesUnidad: HABILIDADES_UNIDAD,
    });
    historialRef.current = [];
    setConfirmadoHasta(0);
    setAccionElegida(null);
    setArmaElegida(null);
    setSeleccionada(null);
    setObjetivo(null);
    setIniciativa(null);
    setAviso(null);
    refresh();
  };

  const tirarIniciativa = (): void => {
    const cmd = { type: 'TirarIniciativa' } as const;
    const antes = { state: engine.getState(), log: engine.getLog().slice(), cmd };
    const r = engine.execute(cmd);
    if (r.ok) historialRef.current.push(antes);
    if (r.ok) {
      const ev = r.events.find((e) => e.type === 'IniciativaTirada');
      if (ev && ev.type === 'IniciativaTirada') {
        setIniciativa({ tiradas: ev.tiradas, orden: ev.orden });
      }
    }
    refresh();
  };

  // Mientras haya activación en curso, el panel es siempre el de esa unidad.
  const idPanel = activa ?? seleccionada;
  const unidadSel = idPanel ? state.units[idPanel] : undefined;
  const perfilSel = unidadSel ? state.profiles[unidadSel.profileId] : undefined;

  const opciones = opcionesMovimiento(unidadSel, perfilSel, activa);
  const { puedeMover, puedeCorrer } = opciones;
  /*
    Si se ha elegido Mover explícitamente, el arrastre se limita al Movimiento
    aunque quedasen 2 acciones: eligiendo la acción se decide el tope.
  */
  const topeArrastre =
    accionElegida === 'Mover' && puedeMover
      ? (perfilSel?.movimiento ?? null)
      : accionElegida === 'Correr' && puedeCorrer
        ? ((perfilSel?.movimiento ?? 0) + (perfilSel?.velocidad ?? 0))
        : opciones.tope;

  /**
   * La acción que manda para dibujar auras: la elegida, o si no hay ninguna,
   * la que esté bajo el ratón en el desplegable. Así se puede tantear cada
   * alcance sin comprometerse, y solo se ve un aura cada vez.
   */
  const accionMostrada = accionElegida ?? accionResaltada;

  /**
   * Al Correr, el destino tiene que salir del anillo de Movimiento: correr
   * para quedarse dentro gastaría 2 acciones a cambio de nada.
   */
  /**
   * Anillo de Carga. Cargar y Correr recorren la misma distancia
   * (Movimiento + Velocidad), así que se dibujan con el mismo radio y desde
   * el mismo sitio: el centro de la miniatura. Quién es cargable lo dicen los
   * marcadores sobre los enemigos, que sí aplican la medida de peana a peana
   * del reglamento.
   */
  const alcanceCarga =
    perfilSel && accionMostrada === 'Cargar'
      ? {
          radio: perfilSel.movimiento + perfilSel.velocidad,
          pulgadas: perfilSel.movimiento + perfilSel.velocidad,
        }
      : null;

  const minimoArrastre =
    accionElegida === 'Correr' && perfilSel ? perfilSel.movimiento : null;
  const modoColocacion =
    accionElegida === 'Mover' || accionElegida === 'Correr' ? accionElegida : null;

  const acciones = accionesDisponibles(state, unidadSel, perfilSel);

  /** Objetivos válidos de cada arma a distancia de la unidad del panel. */
  const objetivosPorArma: Record<string, string[]> = {};
  if (unidadSel && perfilSel) {
    for (const w of perfilSel.armas) {
      if (w.kind !== 'disparo') continue;
      objetivosPorArma[w.nombre] = objetivosDeDisparo(state, unidadSel, perfilSel, w);
    }
  }
  /** Enemigos marcados en el tablero según la acción que se esté apuntando. */
  const objetivosMarcados =
    accionElegida === 'Disparar' && armaElegida
      ? (objetivosPorArma[armaElegida] ?? [])
      : accionElegida === 'Cargar' && unidadSel && perfilSel
        ? objetivosDeCarga(state, unidadSel, perfilSel)
        : accionElegida === 'AtacarCaC' && unidadSel && perfilSel
          ? objetivosDeCaC(state, unidadSel, perfilSel)
          : [];

  /*
    Un aura cada vez, la de la acción en juego: teniendo todas a la vez el
    tablero se vuelve ilegible.
  */
  /*
    En modo Correr se dibujan los dos: el de Correr es el tope y el de Mover
    marca el borde interior, la línea a partir de la cual correr aporta algo.
    Sin él no se ve dónde empieza la zona válida.
  */
  const alcanceMovimiento =
    perfilSel && (accionMostrada === 'Mover' || accionMostrada === 'Correr')
      ? perfilSel.movimiento
      : null;
  const alcanceCarrera =
    perfilSel && accionMostrada === 'Correr'
      ? perfilSel.movimiento + perfilSel.velocidad
      : null;
  const armaDisparo = perfilSel?.armas.find((w) => w.kind === 'disparo');
  /*
    El aura del arma acompaña a Mover y Correr —para saber si desde allí se
    llegaría a disparar— y a Disparar. Con Cargar se oculta: ahí solo importa
    el alcance de la carga.
  */
  const alcanceArma =
    armaDisparo?.kind === 'disparo' && accionMostrada !== 'Cargar'
      ? armaDisparo.distancia
      : null;

  const arrastrable = puedeMover || puedeCorrer ? (activa ?? null) : null;

  /** Valida el destino ya limitado por el tablero: solo quedan bordes y enemigos. */
  const previewMovimiento = useCallback(
    (destino: Vec2): MovePreview => {
      const u = activa ? state.units[activa] : undefined;
      const p = u ? state.profiles[u.profileId] : undefined;
      if (!u || !p) return { ok: false, distancia: 0, motivo: 'Sin unidad activa', requiereCorrer: false };

      const distancia = Math.hypot(destino.x - u.position.x, destino.y - u.position.y);
      const requiereCorrer =
        accionElegida === 'Correr' ? true : distancia > p.movimiento + 1e-9;
      if (accionElegida === 'Correr' && distancia < p.movimiento - 1e-9) {
        return {
          ok: false,
          distancia,
          motivo: `Al Correr hay que pasar de ${p.movimiento}"`,
          requiereCorrer,
        };
      }
      if (requiereCorrer && !puedeCorrer) {
        return { ok: false, distancia, motivo: 'Ya no puede Correr', requiereCorrer };
      }
      if (!requiereCorrer && !puedeMover) {
        return { ok: false, distancia, motivo: 'Ya se movió', requiereCorrer };
      }
      // No se puede terminar encima de la escenografía: se atraviesa, no se
      // ocupa. La peana no puede solaparse con ninguna pieza.
      for (const t of state.terrain) {
        if (baseSolapaRect(destino, p.radioPeana, t.rect)) {
          return { ok: false, distancia, motivo: 'No se puede acabar encima de la escenografía', requiereCorrer };
        }
      }
      for (const otra of Object.values(state.units)) {
        if (otra.owner === u.owner || otra.vidas <= 0) continue;
        const op = state.profiles[otra.profileId];
        if (!op) continue;
        if (baseDistance(destino, p.radioPeana, otra.position, op.radioPeana) <= 1) {
          return { ok: false, distancia, motivo: `A 1" o menos de ${otra.id}: usa Cargar`, requiereCorrer };
        }
      }
      return { ok: true, distancia, motivo: '', requiereCorrer };
    },
    [activa, state, puedeMover, puedeCorrer, accionElegida],
  );

  /** Resuelve el disparo y abre el pop-up que lo narra. */
  const resolverDisparo = (unitId: string, targetId: string, armaNombre: string): void => {
    const objetivo = state.units[targetId];
    if (!objetivo) return;
    const vidasAntes = objetivo.vidas;
    const cmd = { type: 'Disparar' as const, unitId, targetId, armaNombre };
    const antes = { state: engine.getState(), log: engine.getLog().slice(), cmd };
    const r = engine.execute(cmd);
    if (r.ok) {
      historialRef.current.push(antes);
      const ev = r.events.find((e) => e.type === 'DisparoResuelto');
      const danio = r.events.find((e) => e.type === 'DanioAplicado');
      if (ev && ev.type === 'DisparoResuelto') {
        abrirCombate({
          attackerId: ev.attackerId,
          targetId: ev.targetId,
          arma: ev.arma,
          resultado: ev.resultado,
          vidasAntes,
          vidasDespues: danio?.type === 'DanioAplicado' ? danio.vidasRestantes : vidasAntes,
          destruida: r.events.some((e) => e.type === 'UnidadDestruida' && e.unitId === targetId),
        });
      }
      setAccionElegida(null);
      setArmaElegida(null);
      setObjetivo(null);
    } else {
      setAviso(r.reason);
    }
    refresh();
  };

  /** Intento de destrabe: 1D6, se libera con 4+. */
  const resolverDestrabe = (unitId: string): void => {
    const cmd = { type: 'Destrabarse' as const, unitId };
    const antes = { state: engine.getState(), log: engine.getLog().slice(), cmd };
    const r = engine.execute(cmd);
    if (r.ok) {
      historialRef.current.push(antes);
      const ev = r.events.find((e) => e.type === 'DestrabeResuelto');
      if (ev && ev.type === 'DestrabeResuelto') {
        abrirTirada({
          titulo: 'Destrabarse',
          dado: ev.dado,
          exito: ev.exito,
          texto: ev.exito
            ? 'Se libera del combate. Le queda su acción restante.'
            : 'No consigue soltarse: pierde todas sus acciones y termina su activación.',
        });
      }
      setAccionElegida(null);
      setObjetivo(null);
    } else {
      setAviso(r.reason);
    }
    refresh();
  };

  /** Resuelve un ataque cuerpo a cuerpo y lo narra en el pop-up. */
  const resolverCaC = (unitId: string, targetId: string, armaNombre: string): void => {
    const objetivo = state.units[targetId];
    if (!objetivo) return;
    const vidasAntes = objetivo.vidas;
    const cmd = { type: 'AtacarCaC' as const, unitId, targetId, armaNombre };
    const antes = { state: engine.getState(), log: engine.getLog().slice(), cmd };
    const r = engine.execute(cmd);
    if (r.ok) {
      historialRef.current.push(antes);
      const ev = r.events.find((e) => e.type === 'CaCResuelto');
      const danio = r.events.find((e) => e.type === 'DanioAplicado' && e.unitId === targetId);
      if (ev && ev.type === 'CaCResuelto') {
        abrirCombate({
          attackerId: ev.attackerId,
          targetId: ev.targetId,
          arma: ev.arma,
          resultado: ev.resultado,
          vidasAntes,
          vidasDespues: danio?.type === 'DanioAplicado' ? danio.vidasRestantes : vidasAntes,
          destruida: r.events.some((e) => e.type === 'UnidadDestruida' && e.unitId === targetId),
        });
      }
      setAccionElegida(null);
      setObjetivo(null);
    } else {
      setAviso(r.reason);
    }
    refresh();
  };

  /** Resuelve la carga y narra en el pop-up la tirada y el ataque gratuito. */
  const resolverCarga = (unitId: string, targetId: string): void => {
    const objetivo = state.units[targetId];
    if (!objetivo) return;
    const vidasAntes = objetivo.vidas;
    const cmd = { type: 'Cargar' as const, unitId, targetId };
    const antes = { state: engine.getState(), log: engine.getLog().slice(), cmd };
    const r = engine.execute(cmd);
    if (r.ok) {
      historialRef.current.push(antes);
      const carga = r.events.find((e) => e.type === 'CargaResuelta');
      const danio = r.events.find((e) => e.type === 'DanioAplicado' && e.unitId === targetId);
      if (carga && carga.type === 'CargaResuelta') {
        /*
          El pop-up se retrasa: el motor ya ha recolocado la unidad, así que
          durante esta pausa se ve la aproximación sobre el tablero limpio.
          Si abriera de inmediato, el movimiento ocurriría tapado.
        */
        const datos = {
          attackerId: unitId,
          targetId,
          arma: '',
          carga: { dado: carga.dado, exito: carga.exito },
          resultado: undefined,
          vidasAntes,
          vidasDespues: danio?.type === 'DanioAplicado' ? danio.vidasRestantes : vidasAntes,
          destruida: r.events.some((e) => e.type === 'UnidadDestruida' && e.unitId === targetId),
        };
        window.setTimeout(() => abrirCombate(datos), MS_APROXIMACION);
      }
      setAccionElegida(null);
      setArmaElegida(null);
      setObjetivo(null);
    } else {
      setAviso(r.reason);
    }
    refresh();
  };

  /**
   * Elegir acción entra en modo apuntado. Nunca resuelve sola: la acción
   * siempre se confirma desde el panel. Lo único que se automatiza es la
   * puntería — si solo hay un objetivo posible, queda ya marcado.
   */
  const elegirAccion = (kind: ActionKind | null): void => {
    /*
      La activación la dispara la propia acción: no hay botón de activar. Se
      hace aquí, antes de nada, porque el motor sigue exigiéndola —el orden de
      activaciones es una regla— y así deja de ser un paso que dar a mano.
    */
    if (kind && unidadSel && state.unidadActiva !== unidadSel.id) {
      if (!run({ type: 'ActivarUnidad', unitId: unidadSel.id })) return;
    }
    if (kind === 'Destrabarse' && activa) {
      // Sin objetivo que elegir: se tira y ya está, sin cuadro de por medio.
      resolverDestrabe(activa);
      return;
    }

    setAccionElegida(kind);
    setArmaElegida(null);
    setObjetivo(null);
    if (!kind || !perfilSel || !unidadSel) return;

    if (kind === 'Disparar') {
      const arma = perfilSel.armas.find((w) => w.kind === 'disparo');
      if (!arma || arma.kind !== 'disparo') return;
      setArmaElegida(arma.nombre);
      const objetivos = objetivosDeDisparo(state, unidadSel, perfilSel, arma);
      if (objetivos.length === 1) setObjetivo(objetivos[0]!);
      return;
    }

    if (kind === 'Cargar') {
      const objetivos = objetivosDeCarga(state, unidadSel, perfilSel);
      if (objetivos.length === 1) setObjetivo(objetivos[0]!);
      return;
    }

    if (kind === 'AtacarCaC') {
      const candidatos = unidadSel.ataqueGratuitoContra
        ? [unidadSel.ataqueGratuitoContra]
        : perfilSel
          ? objetivosDeCaC(state, unidadSel, perfilSel)
          : [];
      if (candidatos.length === 1) setObjetivo(candidatos[0]!);
    }
  };

  const onMover = (destino: Vec2, correr: boolean): void => {
    if (!activa) return;
    if (run({ type: correr ? 'Correr' : 'Mover', unitId: activa, destino })) {
      setAccionElegida(null);
    }
  };

  /**
   * Tocar una unidad la selecciona. Con una unidad ya activada no se puede
   * cambiar a otra: su activación tiene que resolverse entera y terminarse
   * antes de pasar a la siguiente, como en la mesa.
   */
  const onClickUnidad = (id: string): void => {
    const u = state.units[id];
    if (!u) return;
    /*
      Mientras no haya hecho nada, cambiar de unidad es gratis: se deselecciona
      y punto. En cuanto ejecuta una acción queda activada y ya no se suelta
      hasta que termine.
    */
    if (activa) {
      // Apuntando: tocar un enemigo marcado resuelve el disparo.
      // Apuntando: tocar un enemigo lo marca como objetivo. La acción se
      // lanza desde el panel, no clicando la miniatura. Vale igual para
      // Disparar y para Cargar: la carga no usa arma, así que no puede
      // depender de que haya uma seleccionada.
      if (objetivosMarcados.includes(id)) {
        setObjetivo(id);
        return;
      }
      // Se mantiene la activa seleccionada; tocar otra no hace nada.
      if (activa !== id) setSeleccionada(activa);
      return;
    }
    setSeleccionada(id);
    setObjetivo(null);
    setAccionElegida(null);
    setArmaElegida(null);
  };

  const log = engine.getLog();
  const ganador = log.find((e) => e.type === 'PartidaTerminada');

  /**
   * El deshacer es de la unidad, no global: solo se ofrece si lo último que
   * ocurrió fue que ESTA unidad se movió o corrió.
   */
  const ultimo = historialRef.current[historialRef.current.length - 1];
  const ultimoFueMovimientoDeEsta =
    !!ultimo &&
    !!unidadSel &&
    (ultimo.cmd.type === 'Mover' || ultimo.cmd.type === 'Correr') &&
    ultimo.cmd.unitId === unidadSel.id &&
    historialRef.current.length > confirmadoHasta;
  const distanciaDeshacer = ultimoFueMovimientoDeEsta
    ? [...log].reverse().find((e) => e.type === 'UnidadMovida' && e.unitId === unidadSel!.id)
    : undefined;
  /*
    Mientras el movimiento está hecho pero sin confirmar, las auras se quedan
    donde SALIÓ la unidad. Es la referencia contra la que se decide si el sitio
    nuevo compensa; saltando al destino se pierde justo cuando hace falta.
  */
  const origenAuras =
    distanciaDeshacer?.type === 'UnidadMovida' ? distanciaDeshacer.desde : null;

  /*
    De quién es la vez AHORA MISMO. Lo dice el motor, y vale igual para el
    despliegue inicial que para las activaciones: desplegar es una jugada más.
    Es el dato que tiñe toda la interfaz.
  */
  const jugadorDeTurno = state.jugadorActivo;
  const COLOR_TURNO: Record<string, string> = { A: '#3b82f6', B: '#ef4444' };
  const colorTurno = jugadorDeTurno ? (COLOR_TURNO[jugadorDeTurno] ?? '#64748b') : '#64748b';

  /** Reservas del jugador al que le toca; las del rival no pintan nada ahora. */
  const reservaDelTurno = jugadorDeTurno
    ? state.reserva.filter((r) => r.owner === jugadorDeTurno)
    : [];

  /*
    Bucle de la máquina: una jugada cada vez, con una pausa para poder seguirla
    con la vista. Cada jugada cambia el estado, el efecto se vuelve a disparar y
    encadena la siguiente; cuando no hay nada que hacer, se para solo.
  */
  /*
    Cuándo se puede sacar algo de Reserva. En el despliegue inicial, siempre que
    sea tu vez. Ya en partida, desplegar consume la vez igual que una activación:
    solo vale si no tienes ninguna unidad a medias y te quedan refuerzos, que
    son tantos por turno como puestos controles.
  */
  const puedeDesplegarAhora = ((): boolean => {
    if (!jugadorDeTurno) return false;
    if (state.fase === 'Despliegue') return true;
    if (state.fase !== 'Activaciones' || state.unidadActiva) return false;
    const tope = state.puestos.filter((pm) => pm.duenio === jugadorDeTurno).length;
    return (state.refuerzosUsados[jugadorDeTurno] ?? 0) < tope;
  })();

  /** Nadie puede plantarse en el despliegue sin haber sacado nada a la mesa. */
  const tieneTropas =
    !!jugadorDeTurno &&
    Object.values(state.units).some((u) => u.owner === jugadorDeTurno && u.vidas > 0);

  /*
    Fin de turno y tirada de Iniciativa van solos: no hay nada que decidir en
    ninguno de los dos, y obligar a pulsar cortaba el ritmo de la partida. Lo
    que SÍ se pulsa es "Comenzar activaciones", porque ahí el jugador decide
    cuándo ha terminado de meter refuerzos.
  */
  useEffect(() => {
    if (ganador) return;
    if (state.fase === 'FinDeTurno') {
      const t = setTimeout(() => run({ type: 'TerminarTurno' }), MS_FIN_DE_TURNO);
      return () => clearTimeout(t);
    }
    if (state.ordenIniciativa.length === 0) {
      const t = setTimeout(tirarIniciativa, MS_TIRAR_INICIATIVA);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fase, state.turno, state.ordenIniciativa.length, ganador]);

  /*
    Y una unidad sin nada que hacer termina sola. La excepción es el movimiento
    sin confirmar: ahí todavía queda una decisión —dejarlo o deshacerlo— y
    cerrarle la activación te quitaría el deshacer de las manos.
  */
  const sinNadaQueHacer =
    !!unidadSel &&
    // Ojo: `activated` es "ya terminó", no "está jugando"; ponerlo aquí hacía
    // la condición imposible y la activación no se cerraba sola nunca.
    unidadSel.vidas > 0 &&
    state.fase === 'Activaciones' &&
    state.unidadActiva === unidadSel.id &&
    unidadSel.ataqueGratuitoContra === null &&
    !ultimoFueMovimientoDeEsta &&
    !modoColocacion &&
    !combate &&
    !tirada &&
    acciones.every((a) => !a.disponible);

  useEffect(() => {
    if (!sinNadaQueHacer || !state.unidadActiva) return undefined;
    const id = state.unidadActiva;
    const t = setTimeout(() => { run({ type: 'TerminarActivacion', unitId: id }); }, MS_CERRAR_ACTIVACION);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinNadaQueHacer, state.unidadActiva]);

  const ambasIA = state.jugadores.every((j) => ia[j]);
  useEffect(() => {
    const jugarSolo = (): void => {
      // La tirada de Iniciativa va sola; hasta que caiga, no le toca a nadie.
      if (state.ordenIniciativa.length === 0) return;
      if (state.fase !== 'Despliegue' && state.fase !== 'Activaciones') return;

      const jugador = state.jugadorActivo;
      if (!jugador || !ia[jugador]) return;

      const jugada = siguienteJugada(state, jugador);
      if (!jugada) {
        if (state.unidadActiva) run({ type: 'TerminarActivacion', unitId: state.unidadActiva });
        return;
      }
      // Si el motor la rechaza, se corta la activación en vez de insistir.
      if (!run(jugada.cmd) && state.unidadActiva) {
        run({ type: 'TerminarActivacion', unitId: state.unidadActiva });
      }
    };

    const t = setTimeout(jugarSolo, MS_JUGADA_IA);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ia, combate, tirada]);


  /*
    El menú de acciones sale junto a la miniatura, abriéndose hacia el lado con
    sitio: si la unidad está en la mitad derecha del tablero, se despliega hacia
    la izquierda para no salirse. Va en porcentaje del tablero, que es lo que
    hace que siga a la miniatura al escalar la ventana.
  */
  const anclajeMenu = unidadSel
    ? {
        x: (unidadSel.position.x / MESA.ancho) * 100,
        y: Math.min(78, (unidadSel.position.y / MESA.alto) * 100),
        lado: (unidadSel.position.x > MESA.ancho / 2 ? 'izq' : 'der') as 'izq' | 'der',
      }
    : null;

  /*
    Ya no hay panel de acciones: la rueda, los objetivos marcados y el ✓ junto
    al objetivo lo cubren todo. Cada cuadro de texto que quitamos es un sitio
    menos donde mirar mientras juegas.
  */
  const conRueda =
    !!unidadSel &&
    !accionElegida &&
    (state.unidadActiva === unidadSel.id || motivoNoActivable(state, unidadSel) === null);

  /*
    El ataque apuntado: quién, contra quién, con qué arma y si le tapa algo.
    De aquí salen tanto el ✓ junto al objetivo como la previsión de la banda,
    y así no pueden decir cosas distintas.
  */
  const ataqueApuntado = ((): {
    atacante: Unit;
    objetivo: Unit;
    arma: RangedWeapon | MeleeWeapon;
    enCobertura: boolean;
    hacer: () => void;
  } | null => {
    if (!activa || !objetivo || !accionElegida || !unidadSel || !perfilSel) return null;
    const obj = state.units[objetivo];
    const po = obj ? state.profiles[obj.profileId] : undefined;
    if (!obj || !po) return null;

    const arma =
      accionElegida === 'Disparar'
        ? perfilSel.armas.find((w) => w.kind === 'disparo' && w.nombre === armaElegida)
        : accionElegida === 'Cargar' || accionElegida === 'AtacarCaC'
          ? perfilSel.armas.find((w) => w.kind === 'cuerpo_a_cuerpo')
          : undefined;
    if (!arma) return null;

    /*
      Cargando todavía no sabes desde dónde acabarás pegando —el motor busca el
      hueco libre al llegar—, así que la cobertura de la posición actual no
      vale: se prevé el cuerpo a cuerpo sin ella.
    */
    const enCobertura =
      accionElegida === 'Cargar' ? false : hasCover(state, unidadSel, perfilSel, obj, po);

    return {
      atacante: unidadSel,
      objetivo: obj,
      arma,
      enCobertura,
      hacer: () => {
        if (accionElegida === 'Disparar') resolverDisparo(activa, objetivo, arma.nombre);
        else if (accionElegida === 'Cargar') resolverCarga(activa, objetivo);
        else resolverCaC(activa, objetivo, arma.nombre);
      },
    };
  })();

  /*
    Ya no hay botón de "empezar": el turno arranca solo. Lo único que queda por
    decidir en el despliegue inicial es cuándo dejas de colocar, y para eso hace
    falta decirlo. En cuanto los dos lo dicen, empieza la partida sola.
  */
  const accionDeFase =
    state.fase === 'Despliegue' && jugadorDeTurno && !ia[jugadorDeTurno] && tieneTropas
      ? {
          texto: 'No despliego más',
          desactivado: false,
          hacer: () => {
            setRefuerzo(null);
            run({ type: 'PasarDespliegue', jugador: jugadorDeTurno });
          },
        }
      : null;

  return (
    <div className={`app turno-${jugadorDeTurno ?? "nadie"}`} style={{ ["--turno" as string]: colorTurno }}>
      <div className="board-wrap">
        <Board
          state={state}
          seleccionada={seleccionada}
          onClickUnidad={onClickUnidad}
          onMover={onMover}
          arrastrable={arrastrable}
          alcanceMovimiento={alcanceMovimiento}
          alcanceCarrera={alcanceCarrera}
          alcanceArma={alcanceArma}
          alcanceCarga={alcanceCarga}
          puedeMover={puedeMover}
          puedeCorrer={puedeCorrer}
          topeArrastre={topeArrastre}
          minimoArrastre={minimoArrastre}
          modoColocacion={modoColocacion}
          modoAnillos={
            accionMostrada === 'Mover' || accionMostrada === 'Correr' ? accionMostrada : null
          }
          objetivosMarcados={objetivosMarcados}
          objetivoElegido={objetivo}
          origenAuras={origenAuras}
          apuntandoDisparo={accionElegida === 'Disparar'}
          /*
            La rueda sale con la unidad activada y sin acción elegida: en cuanto
            eliges una, manda el tablero (anillos, objetivos) y la rueda estorba.
          */
          accionesRueda={
            /*
              `activated` significa "ya jugó este turno" (el zZ), no "está
              jugando ahora": lo que manda es ser la unidad activa del motor.
            */
            conRueda ? acciones : null
          }
          accionResaltada={accionResaltada}
          onElegirAccion={elegirAccion}
          onResaltarAccion={setAccionResaltada}
          /*
            Disparar, Cargar y Atacar se rematan con un ✓ junto al objetivo, no
            con un botón en un cuadro: es la misma confirmación, sin texto.
          */
          confirmarSobreObjetivo={
            ataqueApuntado ? { unitId: ataqueApuntado.objetivo.id, hacer: ataqueApuntado.hacer } : null
          }
          confirmacionMovimiento={
            ultimoFueMovimientoDeEsta
              ? {
                  onAceptar: () => setConfirmadoHasta(historialRef.current.length),
                  onDeshacer: deshacer,
                }
              : null
          }
          onTerminarActivacion={() => {
            if (unidadSel) {
              run({ type: 'TerminarActivacion', unitId: unidadSel.id });
              setObjetivo(null);
            }
          }}
          desplegando={state.reserva.find((r) => r.id === refuerzo) ?? null}
          onDesplegar={(puestoId, posicion) => {
            // El motor pasa la vez solo: desplegar consume la jugada.
            if (refuerzo && run({ type: 'Desplegar', unitId: refuerzo, puestoId, posicion })) {
              setRefuerzo(null);
            }
          }}
          onCancelarAccion={() => { setAccionElegida(null); setArmaElegida(null); }}
          previewMovimiento={previewMovimiento}
        />
        {aviso && <div className="aviso" onClick={() => setAviso(null)}>{aviso}</div>}
      </div>
      {/*
        Banda de compañía: TU lista y, al lado, lo que estés mirando —la ficha
        de la unidad, o la previsión si ya has marcado a quién atacar—.

        Solo va la tuya. El enemigo se mira en la mesa, y cuando apuntas sale
        entero en la previsión: tener su lista aquí abajo era pedirle al jugador
        que llevara la contabilidad de un bando que no juega. Cuando haya online
        esto seguirá valiendo: cada uno ve la suya.
      */}
      <footer className="banda">
        <Compania
          jugador="A"
          state={state}
          deTurno={jugadorDeTurno === 'A'}
          seleccionada={seleccionada}
          onSeleccionar={onClickUnidad}
          puedeDesplegar={puedeDesplegarAhora}
          refuerzo={refuerzo}
          onElegirRefuerzo={setRefuerzo}
          esMaquina={ia.A ?? false}
        />

        <div className="banda-centro">
          {ataqueApuntado ? (
            <Prevision
              state={state}
              atacante={ataqueApuntado.atacante}
              objetivo={ataqueApuntado.objetivo}
              arma={ataqueApuntado.arma}
              enCobertura={ataqueApuntado.enCobertura}
              onConfirmar={ataqueApuntado.hacer}
              onCancelar={() => { setAccionElegida(null); setArmaElegida(null); setObjetivo(null); }}
            />
          ) : (
            <Ficha state={state} unidad={unidadSel} />
          )}
        </div>

      </footer>

      {/*
        Marcador: cada bando en su lado, con sus puntos, y el bando al que le
        toca encendido. Jugando en local es lo que evita perderse.
      */}
      <header className="marcador">
        {/*
          Un solo bloque en el centro. Repartir el tanteo por las dos esquinas
          valía para dos jugadores en la misma pantalla, cada uno mirando a su
          lado; jugando solo obliga a barrer la pantalla entera para saber cómo
          va la cosa.
        */}
        <div className="tanteo">
          <div className={`equipo pA ${jugadorDeTurno === 'A' ? 'juega' : ''}`}>
            <span className="nombre">AZUL</span>
            <b className="puntos">{state.puntos.A ?? 0}</b>
            {ia.A && <span className="maquina" title="Lo lleva la máquina">CPU</span>}
          </div>

          <div className="centro">
            <span className="turno">Turno {state.turno}<i>/{state.turnosTotales}</i></span>
            <span className="fase">{state.fase}</span>
          </div>

          <div className={`equipo pB derecha ${jugadorDeTurno === 'B' ? 'juega' : ''}`}>
            {ia.B && <span className="maquina" title="Lo lleva la máquina">CPU</span>}
            <b className="puntos">{state.puntos.B ?? 0}</b>
            <span className="nombre">ROJO</span>
          </div>
        </div>

        {accionDeFase && (
          <button
            className="hud-boton accion-fase"
            disabled={'desactivado' in accionDeFase && accionDeFase.desactivado}
            title={
              'desactivado' in accionDeFase && accionDeFase.desactivado
                ? 'Cada bando necesita al menos una unidad en mesa'
                : undefined
            }
            onClick={accionDeFase.hacer}
          >
            {accionDeFase.texto}
          </button>
        )}

        {/* Los ajustes no son parte de la partida: se apartan a la esquina. */}
        <button className="hud-boton icono ajustes" onClick={() => setHoja('partida')} title="Partida">⚙</button>
      </header>

      {/* --- Hojas: se abren, se leen y se cierran --- */}

      {iniciativa && (
        <TiradaIniciativa
          // Una por turno: la clave hace que cada tirada ruede desde cero.
          key={state.turno}
          tiradas={iniciativa.tiradas}
          orden={iniciativa.orden}
          jugadores={state.jugadores}
          onContinuar={() => setIniciativa(null)}
        />
      )}

      {hoja === 'partida' && (
        <Hoja titulo="Partida" subtitulo="Semilla y reinicio" onCerrar={() => setHoja(null)}>
          <label className="semilla">
            semilla
            <input type="number" value={semilla} onChange={(e) => setSemilla(Number(e.target.value))} />
          </label>
          <div className="ia-mandos">
            <h4>Quién lleva cada bando</h4>
            {state.jugadores.map((jug) => (
              <label key={jug} className={`ia-bando p${jug}`}>
                <input
                  type="checkbox"
                  checked={ia[jug] ?? false}
                  onChange={(e) => setIa((v) => ({ ...v, [jug]: e.target.checked }))}
                />
                <span>{jug === 'A' ? 'AZUL' : 'ROJO'} lo lleva la máquina</span>
              </label>
            ))}
            <p className="aviso-fase">
              Con los dos marcados la partida se juega sola, útil para ver si las
              reglas se sostienen.
            </p>
          </div>
          <div className="partida-botones">
            <button className="grande" onClick={() => { nuevaPartida(); setHoja(null); }}>Nueva partida</button>
            <button onClick={() => { nuevaPartida(true); setHoja(null); }} title="Misma semilla: mismos dados">
              Repetir con esta semilla
            </button>
          </div>
        </Hoja>
      )}

      {refuerzo && (
        <div className="hud-pista">
          Suelta la unidad dentro de un puesto parpadeante
          <button onClick={() => setRefuerzo(null)}>Cancelar</button>
        </div>
      )}

      {tirada && (
        <Hoja titulo={tirada.titulo} subtitulo={tirada.exito ? 'Superada' : 'Fallida'} onCerrar={() => setTirada(null)}>
          <div className="dados">
            <div className={`tirada ${tirada.exito ? 'gana' : ''}`}>
              <span className="jugador">1D6 · necesita 4+</span>
              <Dado valor={tirada.dado} color={tirada.exito ? '#22c55e' : '#ef4444'} />
            </div>
          </div>
          <p className="aviso-fase">{tirada.texto}</p>
          <button className="grande" onClick={() => setTirada(null)}>Continuar</button>
        </Hoja>
      )}

      {ganador && ganador.type === 'PartidaTerminada' && (
        <Hoja titulo="Partida terminada" subtitulo={`Gana ${ganador.ganador ?? 'nadie'}`}>
          <button className="grande" onClick={() => nuevaPartida()}>Nueva partida</button>
        </Hoja>
      )}

      {combate && <Combate state={state} combate={combate} onCerrar={() => setCombate(null)} />}
    </div>
  );
}
