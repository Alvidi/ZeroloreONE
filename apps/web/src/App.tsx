import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OBJETOS } from '@zerolore/data';
import {
  COHERENCIA,
  Engine,
  Rng,
  anclaDe,
  centerDistance,
  comandanteDe,
  puedeDesplegarEn,
  siguienteJugada,
  vidasDe,
  type ActionKind,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerId,
  type Unidad,
  type Vec2,
} from '@zerolore/core';
import { Tablero } from './tablero/Tablero.tsx';
import type { DatosEscena, Escena, PiezaFantasma } from './tablero/escena.ts';
import { Marcador } from './hud/Marcador.tsx';
import { Rueda } from './hud/Rueda.tsx';
import { Prevision } from './hud/Prevision.tsx';
import { Panel, FichaDetalle, type Carta } from './hud/Panel.tsx';
import { Duelo, type DueloProps, type LadoDuelo } from './hud/Duelo.tsx';
import { TiradaRapida } from './hud/TiradaRapida.tsx';
import { Menu, type Modalidad } from './hud/Menu.tsx';
import { Armeria, type Rival } from './hud/Armeria.tsx';
import {
  ESTILOS,
  PRESUPUESTO_INICIAL,
  aLista,
  cargarLista,
  guardarLista,
  listaAleatoria,
  listaDeEstilo,
  listaInicial,
  type Fila,
} from './ejercito.ts';
import { rotulo } from './hud/nombres.ts';
import { TiradaIniciativa } from './TiradaIniciativa.tsx';
import { Hoja } from './Hoja.tsx';
import {
  accionesDe,
  alcances,
  colocarDespliegue,
  colocarMovimiento,
  cadenaDe,
  coberturasDelTiro,
  comandanteCercano,
  consulta,
  huecoDeRefuerzo,
  motivoActivar,
  objetivosPara,
  piezasCadena,
  revisarColocacion,
  trayectorias,
  type Colocacion,
  type ColocacionDespliegue,
  type Desplazamiento,
  type Eslabon,
  type PiezaCadena,
} from './juego.ts';
import { CSS_JUGADOR, HUMANO, MAQUINA, NOMBRE_JUGADOR, TIPOS, nuevaPartida, semillaNueva } from './partida.ts';
import type { EntradaLista } from '@zerolore/core';

/**
 * Las dos listas de la partida: la tuya, y la del rival según lo elegido. La
 * del rival al azar sale de la semilla, para que "otra partida igual" lo sea.
 */
function listasDePartida(filas: readonly Fila[], presupuesto: number, rival: Rival, semilla: number): Record<PlayerId, EntradaLista[]> {
  const estilo = ESTILOS.find((e) => e.id === rival);
  const rng = new Rng(semilla ^ 0x9e3779b9);
  const suya = rival === 'azar' ? listaAleatoria(presupuesto, () => rng.next()) : estilo ? listaDeEstilo(estilo, presupuesto) : filas;
  return { A: aLista(filas), B: aLista(suya) };
}

// ------------------------------------------------------------------ Ritmo

/** Pausa entre jugadas de la máquina: lo justo para poder seguirlas. */
const MS_IA = 520;
/** Lo que se tarda en tirar la iniciativa y en cerrar el turno solos. */
const MS_TURNO = 450;
/** Y en cerrar una activación que ya no puede hacer nada. */
const MS_CERRAR = 650;

// ------------------------------------------------------------------ Modos

type Apuntable = 'Disparar' | 'Cargar' | 'AtacarCaC';

type Modo =
  | { readonly k: 'nada' }
  | {
      readonly k: 'mover';
      readonly accion: Desplazamiento;
      readonly colocacion: Colocacion | null;
      readonly fijado: boolean;
      /** La miniatura que se arrastra: si es el Comandante, tira de toda la formación. */
      readonly arrastre: string | null;
      /** La formación al empezar a arrastrar, para que el Comandante la lleve sin deformarla. */
      readonly molde: Readonly<Record<string, Vec2>> | null;
    }
  | { readonly k: 'apuntar'; readonly accion: Apuntable; readonly objetivo: string | null }
  | { readonly k: 'desplegar'; readonly reservaId: string; readonly colocacion: ColocacionDespliegue | null }
  | {
      readonly k: 'reforzar';
      readonly reservaId: string;
      readonly unidadId: string | null;
      readonly posicion: Vec2 | null;
      /** Si está sobre un Comandante que no la admite, por qué. */
      readonly rechazo: string | null;
    };

/** Lo que se está enseñando por encima de la mesa, uno detrás de otro. */
type Paso = { readonly id: number } & (
  | { readonly k: 'iniciativa'; readonly tiradas: Readonly<Record<string, number>>; readonly orden: readonly string[]; readonly despues: GameState }
  | { readonly k: 'duelo'; readonly props: Omit<DueloProps, 'onTerminar'>; readonly durante: GameState; readonly despues: GameState }
  | { readonly k: 'tirada'; readonly titulo: string; readonly valor: number; readonly necesita: number; readonly color: string; readonly durante: GameState; readonly despues: GameState }
  | { readonly k: 'fin'; readonly ganador: PlayerId | null; readonly motivo: string; readonly despues: GameState });

let contadorPasos = 0;
const conId = <T extends object>(p: T): T & { id: number } => ({ ...p, id: ++contadorPasos });

const MODO_NADA: Modo = { k: 'nada' };

/** Las cartas del prototipo: se ven en su sitio; sus efectos llegan en el siguiente paso. */
const MANO_INICIAL = ['botiquin', 'botas-ligeras', 'super-golpe'];

export function App() {
  const [semilla, setSemilla] = useState(semillaNueva);
  // La lista se recuerda entre visitas: es lo que vas afinando partida tras partida.
  const [ejercito, setEjercito] = useState<{ filas: Fila[]; presupuesto: number; rival: Rival }>(() => {
    const guardada = cargarLista();
    return guardada && guardada.filas.length > 0
      ? { ...guardada, rival: 'espejo' }
      : { filas: listaInicial(), presupuesto: PRESUPUESTO_INICIAL, rival: 'espejo' };
  });
  const motor = useRef<Engine>(new Engine(nuevaPartida(semilla, listasDePartida(ejercito.filas, ejercito.presupuesto, ejercito.rival, semilla))));
  const [estado, setEstado] = useState<GameState>(() => motor.current.getState());
  const [vista, setVista] = useState<GameState>(estado);
  const [guion, setGuion] = useState<Paso[]>([]);
  const guionRef = useRef<Paso[]>([]);
  const ponerGuion = useCallback((g: Paso[]): void => {
    guionRef.current = g;
    setGuion(g);
  }, []);
  const [modo, setModo] = useState<Modo>(MODO_NADA);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [maquinas, setMaquinas] = useState<Record<PlayerId, boolean>>({ A: false, B: true });
  const [ajustes, setAjustes] = useState(false);
  const [pantalla, setPantalla] = useState<'menu' | 'armeria' | 'partida'>('menu');
  const [empezada, setEmpezada] = useState(false);
  const [rapido, setRapidoEstado] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zerolore.rapido') === '1';
    } catch {
      return false;
    }
  });
  const setRapido = (v: boolean): void => {
    setRapidoEstado(v);
    try {
      localStorage.setItem('zerolore.rapido', v ? '1' : '0');
    } catch {
      // Sin almacenamiento solo se pierde la preferencia.
    }
  };
  /** Las animaciones y las pausas de la IA se multiplican por esto. */
  const ritmo = rapido ? 0.45 : 1;
  const [avisos, setAvisos] = useState<{ id: number; texto: string; tipo: string }[]>([]);
  const escena = useRef<Escena | null>(null);
  const [, setTic] = useState(0);
  const ocupado = guion.length > 0;

  // Las capas HTML (rueda, botones) se colocan con la escena: hay que repintar al redimensionar.
  useEffect(() => {
    const f = (): void => setTic((n) => n + 1);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  const avisar = useCallback((texto: string, tipo = 'info'): void => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a.slice(-3), { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 2600);
  }, []);

  // ---------------------------------------------------------------- Motor

  /** Ejecuta una orden y prepara lo que haya que animar. */
  const ejecutar = useCallback((cmd: Command): boolean => {
    const antes = motor.current.getState();
    const r = motor.current.execute(cmd);
    if (!r.ok) {
      avisar(r.reason, 'error');
      return false;
    }
    const despues = motor.current.getState();
    setEstado(despues);
    const pasos = guionDe(antes, despues, r.events);
    for (const ev of r.events) {
      if (ev.type === 'PuestoConquistado' && ev.jugador) avisar(`${NOMBRE_JUGADOR[ev.jugador]} toma ${ev.puestoId}`, 'puesto');
    }
    if (pasos.length === 0) setVista(despues);
    else {
      const primero = pasos[0]!;
      setVista('durante' in primero ? primero.durante : despues);
      ponerGuion([...guionRef.current, ...pasos]);
    }
    return true;
  }, [avisar, ponerGuion]);

  // Solo en desarrollo: acceso al motor desde la consola para depurar.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zl: unknown }).__zl = { motor, ejecutar, siguienteJugada, escena };
  }, [ejecutar]);

  const avanzarGuion = useCallback((): void => {
    const [hecho, ...resto] = guionRef.current;
    if (!hecho) return;
    const sig = resto[0];
    setVista(sig && 'durante' in sig ? sig.durante : hecho.despues);
    ponerGuion(resto);
  }, [ponerGuion]);

  /**
   * Contra la máquina se pasa antes por la armería, a montar la lista. Máquina
   * contra máquina arranca ya, con tu lista guardada contra el rival elegido:
   * así ves a la IA jugar con tu propio ejército.
   */
  const empezar = (m: Modalidad): void => {
    if (m === 'humano-maquina') {
      setMaquinas({ A: false, B: true });
      setPantalla('armeria');
      return;
    }
    setMaquinas({ A: true, B: true });
    nueva();
    setEmpezada(true);
    setPantalla('partida');
  };

  const cambiarEjercito = (filas: Fila[], presupuesto: number, rival: Rival): void => {
    setEjercito({ filas, presupuesto, rival });
    guardarLista(filas, presupuesto);
  };

  const nueva = (misma = false): void => {
    const s = misma ? semilla : semillaNueva();
    setSemilla(s);
    motor.current = new Engine(nuevaPartida(s, listasDePartida(ejercito.filas, ejercito.presupuesto, ejercito.rival, s)));
    const e = motor.current.getState();
    setEstado(e);
    setVista(e);
    ponerGuion([]);
    setModo(MODO_NADA);
    setSeleccion(null);
  };

  // ------------------------------------------------- Lo que va solo y la IA

  useEffect(() => {
    if (ocupado || pantalla !== 'partida') return undefined;
    const s = estado;
    let t: ReturnType<typeof setTimeout> | undefined;
    const despues = (ms: number, f: () => void): void => { t = setTimeout(f, ms); };

    if (s.fase === 'Terminada') return undefined;
    if (s.fase === 'Iniciativa') despues(MS_TURNO * ritmo, () => ejecutar({ type: 'TirarIniciativa' }));
    else if (s.fase === 'FinDeTurno') despues(MS_TURNO * ritmo, () => ejecutar({ type: 'TerminarTurno' }));
    else if (s.jugadorActivo && maquinas[s.jugadorActivo]) {
      const j = s.jugadorActivo;
      despues(MS_IA * ritmo, () => {
        const jugada = siguienteJugada(motor.current.getState(), j);
        const actual = motor.current.getState();
        if (jugada) {
          if (!ejecutar(jugada.cmd) && actual.unidadActiva) ejecutar({ type: 'TerminarActivacion', unidadId: actual.unidadActiva });
        } else if (actual.unidadActiva) {
          ejecutar({ type: 'TerminarActivacion', unidadId: actual.unidadActiva });
        }
      });
    } else if (s.unidadActiva) {
      // Turno del humano con una unidad a medias.
      const u = s.unidades[s.unidadActiva];
      if (u?.ataqueGratuitoContra) {
        // El golpe de la carga no se decide: llega solo.
        const objetivo = u.ataqueGratuitoContra;
        despues(250, () => ejecutar({ type: 'AtacarCaC', unidadId: u.id, objetivoId: objetivo }));
      } else if (u && modo.k === 'nada' && accionesDe(s, u.id).every((a) => !a.disponible)) {
        despues(MS_CERRAR, () => ejecutar({ type: 'TerminarActivacion', unidadId: u.id }));
      }
    }
    return () => clearTimeout(t);
  }, [estado, ocupado, maquinas, modo.k, ejecutar, pantalla, ritmo]);

  // Al acabar la activación o cambiar de turno, se limpia lo que estuviera a medias.
  useEffect(() => {
    if (estado.jugadorActivo !== HUMANO && modo.k !== 'nada') setModo(MODO_NADA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.jugadorActivo]);

  // ------------------------------------------------------------ Acciones

  const turnoHumano = estado.jugadorActivo === HUMANO && !maquinas[HUMANO] && !ocupado;
  const unidadSel = seleccion ? estado.unidades[seleccion] : undefined;

  const asegurarActiva = (unidadId: string): boolean => {
    if (motor.current.getState().unidadActiva === unidadId) return true;
    return ejecutar({ type: 'ActivarUnidad', unidadId });
  };

  const elegirAccion = (kind: ActionKind): void => {
    if (!unidadSel) return;
    if (kind === 'Mover' || kind === 'Correr') {
      setModo({ k: 'mover', accion: kind, colocacion: null, fijado: false, arrastre: null, molde: null });
    } else if (kind === 'Destrabarse') {
      if (asegurarActiva(unidadSel.id)) ejecutar({ type: 'Destrabarse', unidadId: unidadSel.id });
    } else {
      const objetivos = objetivosPara(estado, unidadSel.id, kind);
      setModo({ k: 'apuntar', accion: kind, objetivo: objetivos.length === 1 ? objetivos[0]! : null });
    }
  };

  const terminarActivacion = (): void => {
    if (!unidadSel) return;
    if (asegurarActiva(unidadSel.id)) ejecutar({ type: 'TerminarActivacion', unidadId: unidadSel.id });
    setModo(MODO_NADA);
  };

  const confirmarMovimiento = (): void => {
    if (modo.k !== 'mover' || !modo.colocacion || !unidadSel) return;
    if (modo.colocacion.motivo) {
      avisar(modo.colocacion.motivo, 'error');
      return;
    }
    const posiciones = modo.colocacion.posiciones;
    if (modo.accion === 'Recolocar') {
      if (ejecutar({ type: 'Recolocar', unidadId: unidadSel.id, posiciones })) setModo(MODO_NADA);
      return;
    }
    if (asegurarActiva(unidadSel.id) && ejecutar({ type: modo.accion, unidadId: unidadSel.id, posiciones })) setModo(MODO_NADA);
  };

  const confirmarAtaque = (): void => {
    if (modo.k !== 'apuntar' || !modo.objetivo || !unidadSel) return;
    const objetivoId = modo.objetivo;
    if (!asegurarActiva(unidadSel.id)) return;
    const cmd: Command =
      modo.accion === 'Disparar' ? { type: 'Disparar', unidadId: unidadSel.id, objetivoId }
        : modo.accion === 'Cargar' ? { type: 'Cargar', unidadId: unidadSel.id, objetivoId }
          : { type: 'AtacarCaC', unidadId: unidadSel.id, objetivoId };
    if (ejecutar(cmd)) setModo(MODO_NADA);
  };

  const cancelar = (): void => {
    if (modo.k !== 'nada') setModo(MODO_NADA);
    else setSeleccion(null);
  };

  // -------------------------------------------------------- Despliegue

  const puedeDesplegarReserva = (reservaId: string): boolean => {
    if (!turnoHumano || estado.fase !== 'Despliegue') return false;
    const r = estado.reserva.find((x) => x.id === reservaId);
    if (!r || r.owner !== HUMANO) return false;
    const e = new Engine(estado);
    const porPuesto = estado.puestos.some((p) => puedeDesplegarEn(estado, p, HUMANO));
    const porRefuerzo = Object.values(estado.unidades).some((u) => e.motivoRefuerzo(u, reservaId) === null);
    // Un soldado suelto se deja coger si hay algún Comandante tuyo en mesa,
    // aunque no lo admita: al soltarlo encima se explica por qué no cabe.
    const suelta = r.minis.length === 1 && !r.minis[0]!.esComandante;
    const hayComandante = suelta && Object.values(estado.unidades).some((u) => u.owner === HUMANO && comandanteDe(u));
    return porPuesto || porRefuerzo || hayComandante;
  };

  const cogerReserva = (reservaId: string): void => {
    if (!puedeDesplegarReserva(reservaId)) return;
    const r = estado.reserva.find((x) => x.id === reservaId)!;
    const suelta = r.minis.length === 1 && !r.minis[0]!.esComandante;
    const hayPuesto = estado.puestos.some((p) => puedeDesplegarEn(estado, p, HUMANO));
    // Una miniatura suelta sin puesto libre solo puede ir de refuerzo.
    setModo(suelta && !hayPuesto
      ? { k: 'reforzar', reservaId, unidadId: null, posicion: null, rechazo: null }
      : { k: 'desplegar', reservaId, colocacion: null });
  };

  // ------------------------------------------------------------ Ratón

  /**
   * En el despliegue inicial, pulsar una miniatura propia y arrastrar abre el
   * ajuste de la formación. Se espera a que el ratón se mueva un poco: un clic
   * sin arrastrar solo selecciona.
   */
  const arranque = useRef<{ unidadId: string; miniId: string; p: Vec2 } | null>(null);

  /** La colocación al arrastrar una miniatura: el Comandante lleva a toda la escuadra. */
  const arrastrarA = (u: Unidad, accion: Desplazamiento, miniId: string, molde: Readonly<Record<string, Vec2>>, p: Vec2): Colocacion => {
    if (miniId === anclaDe(u).id && u.minis.length > 1) return colocarMovimiento(estado, u.id, accion, p, molde);
    return revisarColocacion(estado, u.id, accion, { ...molde, [miniId]: p });
  };

  const eventos = {
    alPulsar: (p: Vec2, miniId: string | null, unidadId: string | null, boton: number): void => {
      if (ocupado) return;
      if (boton === 2) {
        cancelar();
        return;
      }
      if (modo.k === 'mover') {
        if (modo.fijado && modo.colocacion && miniId && unidadSel && miniId.startsWith(`${unidadSel.id}.`)) {
          setModo({ ...modo, arrastre: miniId, molde: modo.colocacion.posiciones });
          return;
        }
        if (unidadSel && modo.accion !== 'Recolocar') {
          setModo({ ...modo, colocacion: colocarMovimiento(estado, unidadSel.id, modo.accion, p), fijado: true, arrastre: null });
        }
        return;
      }
      if (modo.k === 'apuntar') {
        // Se coge el objetivo válido más cercano al clic: las peanas son pequeñas
        // y fallar por un píxel no debería tirar la acción. Cancelar es con ↩ o clic derecho.
        const validos = unidadSel ? objetivosPara(estado, unidadSel.id, modo.accion) : [];
        const elegido = unidadId && validos.includes(unidadId) ? unidadId : objetivoCercano(estado, validos, p);
        if (elegido) setModo({ ...modo, objetivo: elegido });
        return;
      }
      if (modo.k === 'desplegar' || modo.k === 'reforzar') return; // se resuelve al soltar
      const u = unidadId ? estado.unidades[unidadId] : undefined;
      if (u && miniId && turnoHumano && u.owner === HUMANO && new Engine(estado).motivoRecolocar(u, null) === null) {
        arranque.current = { unidadId: u.id, miniId, p };
      }
      setSeleccion(unidadId);
    },

    alMover: (p: Vec2 | null, unidadBajo: string | null): void => {
      setHover(unidadBajo);
      if (!p || ocupado) return;
      const a = arranque.current;
      if (a && modo.k === 'nada' && centerDistance(a.p, p) > 0.3) {
        arranque.current = null;
        const u = estado.unidades[a.unidadId];
        if (u) {
          const molde = Object.fromEntries(u.minis.map((m) => [m.id, m.posicion]));
          setSeleccion(u.id);
          setModo({ k: 'mover', accion: 'Recolocar', colocacion: arrastrarA(u, 'Recolocar', a.miniId, molde, p), fijado: true, arrastre: a.miniId, molde });
        }
        return;
      }
      if (modo.k === 'mover' && unidadSel) {
        if (modo.arrastre && modo.molde) {
          setModo({ ...modo, colocacion: arrastrarA(unidadSel, modo.accion, modo.arrastre, modo.molde, p) });
        } else if (!modo.fijado) {
          setModo({ ...modo, colocacion: colocarMovimiento(estado, unidadSel.id, modo.accion, p) });
        }
      } else if (modo.k === 'desplegar') {
        setModo({ ...modo, colocacion: colocarDespliegue(estado, modo.reservaId, p) });
      } else if (modo.k === 'reforzar') {
        const r = estado.reserva.find((x) => x.id === modo.reservaId);
        const c = r ? comandanteCercano(estado, modo.reservaId, p) : null;
        if (c && c.motivo === null && r) {
          setModo({ ...modo, unidadId: c.u.id, posicion: huecoDeRefuerzo(estado, c.u, r.minis[0]!.tipoId, p), rechazo: null });
        } else {
          // Sobre un Comandante que no la admite, el fantasma va en rojo bajo el cursor.
          setModo({ ...modo, unidadId: null, posicion: c ? p : null, rechazo: c?.motivo ?? null });
        }
      }
    },

    alSoltar: (p: Vec2): void => {
      arranque.current = null;
      if (ocupado) return;
      if (modo.k === 'mover' && modo.arrastre) {
        setModo({ ...modo, arrastre: null, molde: null });
      } else if (modo.k === 'desplegar') {
        const c = colocarDespliegue(estado, modo.reservaId, p);
        if (c?.valida && c.puestoId) {
          if (ejecutar({ type: 'Desplegar', reservaId: modo.reservaId, puestoId: c.puestoId, posiciones: c.posiciones })) setModo(MODO_NADA);
        } else {
          // Suelta en mal sitio: ¿era un refuerzo para un Comandante?
          const r = estado.reserva.find((x) => x.id === modo.reservaId);
          const c = r && r.minis.length === 1 ? comandanteCercano(estado, modo.reservaId, p) : null;
          if (c && c.motivo !== null) {
            avisar(`Aquí no puedes: ${c.motivo}`, 'error');
          } else if (c && r) {
            const sitio = huecoDeRefuerzo(estado, c.u, r.minis[0]!.tipoId, p);
            if (sitio && ejecutar({ type: 'Reforzar', unidadId: c.u.id, reservaId: modo.reservaId, posicion: sitio })) setModo(MODO_NADA);
          }
        }
      } else if (modo.k === 'reforzar') {
        if (modo.unidadId && modo.posicion) {
          if (ejecutar({ type: 'Reforzar', unidadId: modo.unidadId, reservaId: modo.reservaId, posicion: modo.posicion })) setModo(MODO_NADA);
        } else if (modo.rechazo) {
          avisar(`Aquí no puedes: ${modo.rechazo}`, 'error');
          setModo({ ...modo, posicion: null, rechazo: null });
        }
      }
    },
  };

  // --------------------------------------------------- Qué pinta la mesa

  const objetivos = modo.k === 'apuntar' && unidadSel ? objetivosPara(estado, unidadSel.id, modo.accion) : [];
  const objetivoMarcado =
    modo.k === 'apuntar' ? (modo.objetivo ?? (hover && objetivos.includes(hover) ? hover : null)) : null;
  const modoAtaque = modo.k === 'apuntar' ? (modo.accion === 'Disparar' ? 'disparo' : modo.accion === 'Cargar' ? 'carga' : 'cac') : null;

  const datos: DatosEscena = useMemo(() => {
    let fantasma: DatosEscena['fantasma'] = null;
    if (modo.k === 'mover' && modo.colocacion && unidadSel) {
      fantasma = {
        owner: unidadSel.owner,
        piezas: unidadSel.minis.map((m): PiezaFantasma => ({
          id: m.id,
          tipoId: m.tipoId,
          esComandante: m.esComandante,
          posicion: modo.colocacion!.posiciones[m.id] ?? m.posicion,
          valida: !modo.colocacion!.malas.has(m.id),
        })),
      };
    } else if (modo.k === 'desplegar' && modo.colocacion) {
      const r = estado.reserva.find((x) => x.id === modo.reservaId);
      if (r) {
        fantasma = {
          owner: r.owner,
          piezas: r.minis.map((m, i) => ({
            id: `${r.id}.${i}`,
            tipoId: m.tipoId,
            esComandante: m.esComandante,
            posicion: modo.colocacion!.posiciones[i]!,
            valida: modo.colocacion!.valida,
          })),
        };
      }
    } else if (modo.k === 'reforzar' && modo.posicion) {
      const r = estado.reserva.find((x) => x.id === modo.reservaId);
      if (r) fantasma = { owner: r.owner, piezas: [{ id: r.id, tipoId: r.minis[0]!.tipoId, esComandante: false, posicion: modo.posicion, valida: modo.rechazo === null }] };
    }

    let auraMovimiento: DatosEscena['auraMovimiento'] = null;
    if (modo.k === 'mover' && unidadSel && modo.accion !== 'Recolocar') {
      const e = consulta(estado, unidadSel.id);
      const u = e.getState().unidades[unidadSel.id]!;
      auraMovimiento = {
        centro: anclaDe(u).posicion,
        radio: e.alcanceDe(u, 'Mover'),
        radioCorrer: modo.accion === 'Correr' ? e.alcanceDe(u, 'Correr') : null,
      };
    }

    let auraAlcance: DatosEscena['auraAlcance'] = null;
    if (modo.k === 'apuntar' && modo.accion === 'Disparar' && unidadSel) auraAlcance = alcances(estado, unidadSel.id);
    else if (modo.k === 'nada' && hover && estado.unidades[hover]?.owner !== HUMANO) auraAlcance = alcances(estado, hover);
    else if (modo.k === 'nada' && unidadSel) auraAlcance = alcances(estado, unidadSel.id);

    // La cadena de coherencia: quién engancha con quién mientras se coloca algo.
    const zonaDe = (piezas: readonly PiezaCadena[]) => piezas.map((q) => ({ centro: q.centro, radio: q.radio + COHERENCIA }));
    let cadena: DatosEscena['cadena'] = null;
    if (modo.k === 'mover' && modo.colocacion && unidadSel && unidadSel.minis.length > 1) {
      const piezas = piezasCadena(unidadSel, modo.colocacion.posiciones);
      const ancla = anclaDe(unidadSel).id;
      // Arrastrando un soldado se ve la pulgada de los demás: dónde puede caer.
      const zona = modo.arrastre && modo.arrastre !== ancla ? zonaDe(piezas.filter((q) => q.id !== modo.arrastre)) : [];
      cadena = { owner: unidadSel.owner, eslabones: cadenaDe(piezas, ancla, modo.arrastre), zona };
    } else if (modo.k === 'reforzar') {
      const r = estado.reserva.find((x) => x.id === modo.reservaId);
      if (r) {
        const e = new Engine(estado);
        const eslabones: Eslabon[] = [];
        const zona: { centro: Vec2; radio: number }[] = [];
        // Todos los Comandantes que la admiten enseñan su pulgada; el elegido, el enganche nuevo.
        for (const u of Object.values(estado.unidades)) {
          if (u.owner !== r.owner || e.motivoRefuerzo(u, r.id) !== null) continue;
          const propias = piezasCadena(u);
          zona.push(...zonaDe(propias));
          const elegido = u.id === modo.unidadId && modo.posicion;
          const nueva: PiezaCadena[] = elegido
            ? [{ id: '·nueva', centro: modo.posicion!, radio: TIPOS[r.minis[0]!.tipoId]!.radioPeana }]
            : [];
          eslabones.push(...cadenaDe([...propias, ...nueva], anclaDe(u).id, elegido ? '·nueva' : null));
        }
        cadena = { owner: r.owner, eslabones, zona };
      }
    } else if (modo.k === 'nada' && estado.fase === 'Despliegue' && unidadSel && unidadSel.minis.length > 1) {
      cadena = { owner: unidadSel.owner, eslabones: cadenaDe(piezasCadena(unidadSel), anclaDe(unidadSel).id, null), zona: [] };
    }

    const despliegue = estado.fase === 'Despliegue' && estado.jugadorActivo === HUMANO;
    // Recolocando, el puesto que el Comandante no puede dejar de tocar.
    const puestosRecolocar = modo.k === 'mover' && modo.accion === 'Recolocar'
      ? estado.puestos.filter((p) => p.duenio === HUMANO && estado.puestosUsados.includes(p.id)).map((p) => p.id)
      : [];
    return {
      estado: vista,
      humano: HUMANO,
      seleccion,
      hover,
      objetivos,
      objetivo: objetivoMarcado,
      puestosResaltados: despliegue
        ? [...estado.puestos.filter((p) => puedeDesplegarEn(estado, p, HUMANO)).map((p) => p.id), ...puestosRecolocar]
        : [],
      fantasma,
      ocultarUnidad: modo.k === 'mover' && modo.colocacion ? seleccion : null,
      auraMovimiento,
      auraAlcance: ocupado ? null : auraAlcance,
      trayectorias: objetivoMarcado && unidadSel && modoAtaque ? trayectorias(estado, unidadSel.id, objetivoMarcado, modoAtaque) : [],
      coberturas: objetivoMarcado && unidadSel && modoAtaque === 'disparo' ? coberturasDelTiro(estado, unidadSel.id, objetivoMarcado) : [],
      cadena: ocupado ? null : cadena,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, estado, modo, seleccion, hover, ocupado]);

  // ---------------------------------------------------- Capas por encima

  const aPantalla = (p: Vec2): { x: number; y: number } | null => escena.current?.aPantalla(p) ?? null;

  const rueda = (() => {
    if (!turnoHumano || modo.k !== 'nada' || !unidadSel || estado.fase !== 'Activaciones') return null;
    if (unidadSel.owner !== HUMANO) return null;
    const activa = estado.unidadActiva === unidadSel.id;
    if (!activa && motivoActivar(estado, unidadSel, HUMANO) !== null) return null;
    if (unidadSel.ataqueGratuitoContra) return null;
    const ancla = anclaDe(unidadSel);
    const pos = aPantalla(ancla.posicion);
    if (!pos) return null;
    const restantes = activa ? unidadSel.accionesRestantes : 2;
    return (
      <Rueda
        x={pos.x}
        y={pos.y}
        radio={TIPOS[ancla.tipoId]!.radioPeana * (escena.current?.pulgada ?? 20)}
        acciones={accionesDe(estado, unidadSel.id)}
        puedeTerminar
        restantes={restantes}
        onElegir={elegirAccion}
        onTerminar={terminarActivacion}
      />
    );
  })();

  const confirmarMover = (() => {
    if (modo.k !== 'mover' || !modo.fijado || !modo.colocacion || !unidadSel) return null;
    // A la derecha de la formación, para no tapar ninguna miniatura que se quiera ajustar.
    const puntos = Object.values(modo.colocacion.posiciones);
    if (puntos.length === 0) return null;
    const maxX = Math.max(...puntos.map((q) => q.x)) + 1.2;
    const midY = (Math.min(...puntos.map((q) => q.y)) + Math.max(...puntos.map((q) => q.y))) / 2;
    const pos = aPantalla({ x: maxX, y: midY });
    if (!pos) return null;
    const vale = !modo.colocacion.motivo;
    return (
      <div className="confirmar-mover" style={{ left: pos.x, top: pos.y }}>
        <button className={`si ${vale ? '' : 'apagada'}`} onClick={confirmarMovimiento} title={vale ? 'Confirmar' : (modo.colocacion.motivo ?? '')}>✓</button>
        <button className="no" onClick={() => setModo(MODO_NADA)} title="Cancelar">↩</button>
        {!vale && <span className="motivo">{modo.colocacion.motivo}</span>}
      </div>
    );
  })();

  const etiquetaHover = (() => {
    if (!hover || ocupado || modo.k === 'mover') return null;
    const u = vista.unidades[hover];
    if (!u) return null;
    const pos = aPantalla(anclaDe(u).posicion);
    if (!pos) return null;
    const r = rotulo(u);
    const v = vidasDe(vista, u);
    return (
      <div className="etiqueta-unidad" style={{ left: pos.x, top: pos.y - (TIPOS[anclaDe(u).tipoId]!.radioPeana * (escena.current?.pulgada ?? 20)) - 34, ['--equipo' as string]: CSS_JUGADOR[u.owner] }}>
        <b>{r.titulo}</b>{r.detalle && <i> {r.detalle}</i>} <span>{v.actuales}/{v.maximas}</span>
      </div>
    );
  })();

  /*
    Lo que flota sobre la mesa, abajo en el centro: la previsión si se apunta,
    la ficha de lo que se mira si no. Y arriba, una pista corta de qué hacer.
    Nada de esto ocupa sitio fijo: aparece cuando hace falta.
  */
  const info = (() => {
    if (modo.k === 'apuntar' && unidadSel && objetivoMarcado && modoAtaque) {
      const e = consulta(estado, unidadSel.id);
      const pr = e.prevision(unidadSel.id, objetivoMarcado, modoAtaque);
      const o = estado.unidades[objetivoMarcado];
      if (pr && o) {
        return (
          <Prevision
            estado={estado}
            atacante={unidadSel}
            objetivo={o}
            modo={modoAtaque}
            prevision={pr}
            onConfirmar={modo.objetivo ? confirmarAtaque : null}
            onCancelar={() => setModo({ ...modo, objetivo: null })}
          />
        );
      }
    }
    if (modo.k !== 'nada' || ocupado) return null;
    const mirada = (hover && estado.unidades[hover]) || unidadSel;
    return mirada ? <FichaDetalle estado={estado} u={mirada} /> : null;
  })();

  const pista = (() => {
    if (ocupado) return null;
    if (modo.k === 'apuntar' && !objetivoMarcado) return modo.accion === 'Cargar' ? 'Elige a quién cargar' : 'Elige objetivo';
    if (modo.k === 'mover' && modo.accion === 'Recolocar') {
      return 'Arrastra al Comandante y la escuadra le sigue; arrastra un soldado para colocarlo a mano. Confirma con ✓';
    }
    if (modo.k === 'mover') {
      return modo.fijado
        ? 'Arrastra al Comandante para llevar la formación, o un soldado para ajustarlo. Confirma con ✓'
        : 'Lleva al Comandante a su sitio y haz clic';
    }
    if (modo.k === 'desplegar') return 'Suelta la unidad tocando un puesto que palpite';
    if (modo.k === 'reforzar') return modo.rechazo ? `Aquí no: ${modo.rechazo}` : 'Suéltala junto a tu Comandante para sumarla a su escuadra';
    if (estado.fase === 'Despliegue' && turnoHumano) {
      const hayPuesto = estado.puestos.some((p) => puedeDesplegarEn(estado, p, HUMANO));
      return hayPuesto
        ? 'Arrastra una unidad de tu Reserva a un puesto'
        : 'Arrastra soldados hasta tu Comandante; arrastra la escuadra para recolocarla. Pulsa Listo al terminar';
    }
    return null;
  })();

  const cartas: Carta[] = useMemo(() => {
    const lista = (OBJETOS as { objetos: { id: string; nombre: string; descripcion: string; accion: string }[] }).objetos;
    return MANO_INICIAL.flatMap((id) => {
      const o = lista.find((x) => x.id === id);
      return o ? [{ id: o.id, nombre: o.nombre, descripcion: o.descripcion, accion: o.accion, jugable: false }] : [];
    });
  }, []);

  // ---------------------------------------------------------------- Pintar

  const paso = guion[0];
  if (pantalla === 'armeria') {
    return (
      <Armeria
        filas={ejercito.filas}
        presupuesto={ejercito.presupuesto}
        rival={ejercito.rival}
        onCambiar={cambiarEjercito}
        onVolver={() => setPantalla('menu')}
        onJugar={() => {
          nueva();
          setEmpezada(true);
          setPantalla('partida');
        }}
      />
    );
  }
  if (pantalla === 'menu') {
    return (
      <Menu
        rapido={rapido}
        onRapido={setRapido}
        onEmpezar={empezar}
        onSeguir={empezada && estado.fase !== 'Terminada' ? () => setPantalla('partida') : null}
      />
    );
  }
  return (
    <div className={`app turno-${estado.jugadorActivo ?? 'nadie'}`} style={{ ['--turno' as string]: estado.jugadorActivo ? CSS_JUGADOR[estado.jugadorActivo] : '#475569' }}>
      {/* El marcador enseña lo que se ve, no lo que ya ha pasado: si no, canta el resultado del dado. */}
      <Marcador estado={vista} maquinas={maquinas} onAjustes={() => setAjustes(true)} />

      <main className="mesa" onContextMenu={(e) => e.preventDefault()}>
        <Tablero datos={datos} eventos={eventos} alMontar={(e) => { escena.current = e; setTic((n) => n + 1); }} />
        {rueda}
        {confirmarMover}
        {etiquetaHover}
        <div className="avisos">
          {avisos.map((a) => <div key={a.id} className={`aviso ${a.tipo}`}>{a.texto}</div>)}
        </div>
        {pista && <div className="pista-flotante">{pista}</div>}
        {info && <div className="info-flotante">{info}</div>}
        {estado.fase === 'Despliegue' && !turnoHumano && !ocupado && (
          <div className="banner">Despliega {NOMBRE_JUGADOR[estado.jugadorActivo ?? MAQUINA]}</div>
        )}
      </main>

      <Panel
        estado={estado}
        jugador={HUMANO}
        seleccion={seleccion}
        cartas={cartas}
        reservaEnMano={modo.k === 'desplegar' || modo.k === 'reforzar' ? modo.reservaId : null}
        puedeDesplegar={puedeDesplegarReserva}
        puedePasar={turnoHumano && estado.fase === 'Despliegue'}
        onSeleccionar={(id) => { setSeleccion(id); setModo(MODO_NADA); }}
        onCogerReserva={cogerReserva}
        onPasar={() => ejecutar({ type: 'PasarDespliegue', jugador: HUMANO })}
        onCarta={() => avisar('El equipamiento llega en el siguiente paso')}
      />

      {paso?.k === 'iniciativa' && (
        <IniciativaSola key={paso.id} paso={paso} jugadores={estado.jugadores} ritmo={ritmo} onTerminar={avanzarGuion} />
      )}
      {paso?.k === 'duelo' && <Duelo key={paso.id} {...paso.props} ritmo={ritmo} onTerminar={avanzarGuion} />}
      {paso?.k === 'tirada' && (
        <TiradaRapida key={paso.id} titulo={paso.titulo} valor={paso.valor} necesita={paso.necesita} color={paso.color} ritmo={ritmo} onTerminar={avanzarGuion} />
      )}
      {paso?.k === 'fin' && (
        <Hoja titulo="Partida terminada" subtitulo={paso.ganador ? `Gana ${NOMBRE_JUGADOR[paso.ganador]}` : 'Empate'}>
          <p className="fin-motivo">{paso.motivo}</p>
          <p className="fin-puntos">Azul {estado.puntos.A ?? 0} · Rojo {estado.puntos.B ?? 0}</p>
          <div className="partida-botones">
            <button className="grande" onClick={() => nueva()}>Otra partida igual</button>
            <button onClick={() => setPantalla('menu')}>Volver al menú</button>
          </div>
        </Hoja>
      )}

      {ajustes && (
        <Hoja titulo="Partida" subtitulo={`Semilla ${semilla}`} onCerrar={() => setAjustes(false)}>
          <div className="ia-mandos">
            {(['A', 'B'] as const).map((j) => (
              <label key={j} className={`ia-bando p${j}`}>
                <input type="checkbox" checked={maquinas[j] ?? false} onChange={(e) => setMaquinas((m) => ({ ...m, [j]: e.target.checked }))} />
                <span>{NOMBRE_JUGADOR[j]} lo lleva la máquina</span>
              </label>
            ))}
          </div>
          <label className="ia-bando">
            <input type="checkbox" checked={rapido} onChange={(e) => setRapido(e.target.checked)} />
            <span>Ritmo rápido</span>
          </label>
          <div className="partida-botones">
            <button className="grande" onClick={() => { nueva(); setAjustes(false); }}>Nueva partida</button>
            <button onClick={() => { nueva(true); setAjustes(false); }}>Repetir con esta semilla</button>
            <button onClick={() => { setAjustes(false); setPantalla('menu'); }}>Volver al menú</button>
          </div>
        </Hoja>
      )}
    </div>
  );
}

/** De entre los objetivos válidos, el que tenga una miniatura a 1,5" o menos del punto. */
function objetivoCercano(estado: GameState, validos: readonly string[], p: Vec2): string | null {
  let mejor: string | null = null;
  let d = 1.5;
  for (const id of validos) {
    for (const m of estado.unidades[id]?.minis ?? []) {
      const dm = Math.hypot(m.posicion.x - p.x, m.posicion.y - p.y) - (TIPOS[m.tipoId]?.radioPeana ?? 0.5);
      if (dm < d) {
        d = dm;
        mejor = id;
      }
    }
  }
  return mejor;
}

/** La tirada de iniciativa se cierra sola en cuanto se ha visto quién empieza. */
function IniciativaSola({ paso, jugadores, ritmo, onTerminar }: {
  paso: Extract<Paso, { k: 'iniciativa' }>;
  jugadores: readonly string[];
  ritmo: number;
  onTerminar: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onTerminar, 2900 * ritmo);
    return () => clearTimeout(t);
  }, [onTerminar, ritmo]);
  return <TiradaIniciativa tiradas={paso.tiradas} orden={paso.orden} jugadores={jugadores} ritmo={ritmo} onContinuar={onTerminar} />;
}

// --------------------------------------------------------------- El guion

/**
 * Convierte lo que ha pasado en una orden en lo que hay que enseñar: la
 * tirada de iniciativa, el cara a cara de un ataque, la tirada de una carga,
 * el final de la partida. Lo que no necesita espectáculo no genera paso.
 */
function guionDe(antes: GameState, despues: GameState, events: readonly GameEvent[]): Paso[] {
  const pasos: Paso[] = [];
  const ataques = events.filter((e): e is Extract<GameEvent, { type: 'AtaqueResuelto' }> => e.type === 'AtaqueResuelto');

  for (const ev of events) {
    if (ev.type === 'IniciativaTirada') pasos.push(conId({ k: 'iniciativa' as const, tiradas: ev.tiradas, orden: ev.orden, despues }));
    if (ev.type === 'CargaResuelta') {
      const u = antes.unidades[ev.unidadId];
      pasos.push(conId({
        k: 'tirada' as const,
        titulo: 'Carga',
        valor: ev.dado,
        necesita: 3,
        color: u ? CSS_JUGADOR[u.owner] ?? '#e5e7eb' : '#e5e7eb',
        durante: antes,
        despues,
      }));
    }
    if (ev.type === 'DestrabeResuelto') {
      const u = antes.unidades[ev.unidadId];
      pasos.push(conId({
        k: 'tirada' as const,
        titulo: 'Destrabarse',
        valor: ev.dado,
        necesita: 3,
        color: u ? CSS_JUGADOR[u.owner] ?? '#e5e7eb' : '#e5e7eb',
        durante: antes,
        despues,
      }));
    }
  }

  if (ataques.length > 0) {
    const primero = ataques[0]!;
    const atacante = antes.unidades[primero.atacanteId];
    const defensor = antes.unidades[primero.objetivoId];
    if (atacante && defensor) {
      const partes = ataques.map((a) => {
        const i = events.indexOf(a);
        const danio = events.slice(i + 1).find(
          (e): e is Extract<GameEvent, { type: 'DanioRecibido' }> => e.type === 'DanioRecibido' && e.unidadId === a.objetivoId,
        );
        const siguienteAtaque = events.slice(i + 1).findIndex((e) => e.type === 'AtaqueResuelto');
        const indiceDanio = danio ? events.indexOf(danio) : -1;
        const valido = danio && (siguienteAtaque === -1 || indiceDanio < i + 1 + siguienteAtaque);
        return { ataque: a, danio: valido ? danio : null };
      });
      const explosiva = events.reduce((s, e) => s + (e.type === 'ExplosivaAlcanza' ? e.danio : 0), 0);
      pasos.push(conId({
        k: 'duelo' as const,
        props: {
          atacante: lado(antes, primero.atacanteId),
          defensor: lado(antes, primero.objetivoId),
          partes,
          explosiva,
          destruido: events.some((e) => e.type === 'UnidadDestruida' && e.unidadId === primero.objetivoId),
        },
        durante: antes,
        despues,
      }));
    }
  }

  const fin = events.find((e): e is Extract<GameEvent, { type: 'PartidaTerminada' }> => e.type === 'PartidaTerminada');
  if (fin) pasos.push(conId({ k: 'fin' as const, ganador: fin.ganador, motivo: fin.motivo, despues }));
  return pasos;
}

function lado(estado: GameState, unidadId: string): LadoDuelo {
  const u = estado.unidades[unidadId]!;
  const r = rotulo(u);
  const v = vidasDe(estado, u);
  return {
    owner: u.owner,
    nombre: r.titulo,
    detalle: r.detalle,
    tipoId: r.tipoId,
    minis: u.minis.length,
    vidas: v.actuales,
    vidasMax: v.maximas,
  };
}
