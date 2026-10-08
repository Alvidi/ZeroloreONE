import { add, baseDistance, centerDistance, normalize, scale, sub, vec, type Vec2 } from './geometry.ts';
import { Rng } from './rng.ts';
import type { CommandResult, GameEvent } from './events.ts';
import { parametrosAtaque, resolverAtaque, tiene, type Situacion } from './rules/combat.ts';
import { repartirDanio } from './rules/danio.ts';
import { prever, type Prevision } from './rules/prevision.ts';
import {
  esCoherente,
  formar,
  motivoSitio,
  recorrido,
  restriccionesPara,
  type Pieza,
  type Restricciones,
} from './rules/formacion.ts';
import { disparaDesdeCobertura, masCercana, unidadEnCobertura, veA } from './rules/los.ts';
import { controlTrasTurno, puedeDesplegarEn, tocaPuesto } from './rules/puestos.ts';
import {
  ACTION_COST,
  DISTANCIA_ENEMIGO,
  PUNTOS_POR_PUESTO,
  anclaDe,
  comandanteDe,
  disparableTrabado,
  movimientoDe,
  tipoDe,
  tropaDe,
  type ActionKind,
  type Arma,
  type GameState,
  type Mini,
  type PlayerId,
  type TipoUnidad,
  type Unidad,
} from './types.ts';

export type Command =
  | { type: 'TirarIniciativa' }
  | { type: 'Desplegar'; reservaId: string; puestoId: string; posiciones: readonly Vec2[] }
  | { type: 'Reforzar'; unidadId: string; reservaId: string; posicion: Vec2 }
  | { type: 'PasarDespliegue'; jugador: PlayerId }
  | { type: 'ActivarUnidad'; unidadId: string }
  | { type: 'Mover'; unidadId: string; posiciones: Readonly<Record<string, Vec2>> }
  | { type: 'Correr'; unidadId: string; posiciones: Readonly<Record<string, Vec2>> }
  | { type: 'Disparar'; unidadId: string; objetivoId: string }
  | { type: 'Cargar'; unidadId: string; objetivoId: string }
  | { type: 'AtacarCaC'; unidadId: string; objetivoId: string }
  | { type: 'Destrabarse'; unidadId: string }
  | { type: 'TerminarActivacion'; unidadId: string }
  | { type: 'TerminarTurno' };

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const ok = (events: GameEvent[]): CommandResult => ({ ok: true, events });

/** Carga: 3+ en 1D6. */
const CARGA_EXITO = 3;
/** Destrabarse: 3+ en 1D6. */
const DESTRABE_EXITO = 3;
/** Explosiva alcanza a las miniaturas enemigas a esta distancia de la impactada. */
const RADIO_EXPLOSIVA = 3;

/** Un grupo que ataca junto con la misma arma: la tropa, el Comandante, o la miniatura suelta. */
interface Grupo {
  readonly parte: 'tropa' | 'comandante' | 'unidad';
  readonly minis: readonly Mini[];
  readonly tipo: TipoUnidad;
  readonly arma: Arma;
}

/**
 * El motor de reglas. Recibe órdenes, comprueba que son legales y devuelve lo
 * que ha pasado. No sabe nada de pantallas: la interfaz web, la IA y los tests
 * hablan con él igual.
 *
 * Si una orden viola una regla, el estado no cambia en absoluto.
 */
export class Engine {
  private state: GameState;
  private rng: Rng;
  private readonly log: GameEvent[];
  /** De quién era cada Cuartel General al empezar: tomar uno ajeno gana. */
  private readonly cuarteles: ReadonlyMap<string, PlayerId>;

  constructor(initial: GameState, log: readonly GameEvent[] = []) {
    this.state = initial;
    this.rng = Rng.restore(initial.rngState);
    this.log = [...log];
    this.cuarteles = new Map(
      initial.puestos.filter((p) => p.esCuartelGeneral && p.duenio !== null).map((p) => [p.id, p.duenio!] as const),
    );
  }

  getState(): GameState {
    return this.state;
  }

  getLog(): readonly GameEvent[] {
    return this.log;
  }

  execute(cmd: Command): CommandResult {
    const antes = this.state;
    const rngAntes = this.rng.snapshot();
    if (this.state.fase === 'Terminada') return fail('La partida ha terminado');
    const r = this.dispatch(cmd);
    if (!r.ok) {
      this.state = antes;
      this.rng = Rng.restore(rngAntes);
      return r;
    }
    this.state = { ...this.state, rngState: this.rng.snapshot() };
    this.log.push(...r.events);
    return r;
  }

  private dispatch(cmd: Command): CommandResult {
    switch (cmd.type) {
      case 'TirarIniciativa':
        return this.tirarIniciativa();
      case 'Desplegar':
        return this.desplegar(cmd.reservaId, cmd.puestoId, cmd.posiciones);
      case 'Reforzar':
        return this.reforzar(cmd.unidadId, cmd.reservaId, cmd.posicion);
      case 'PasarDespliegue':
        return this.pasarDespliegue(cmd.jugador);
      case 'ActivarUnidad':
        return this.activar(cmd.unidadId);
      case 'Mover':
        return this.mover(cmd.unidadId, cmd.posiciones, 'Mover');
      case 'Correr':
        return this.mover(cmd.unidadId, cmd.posiciones, 'Correr');
      case 'Disparar':
        return this.disparar(cmd.unidadId, cmd.objetivoId);
      case 'Cargar':
        return this.cargar(cmd.unidadId, cmd.objetivoId);
      case 'AtacarCaC':
        return this.cuerpoACuerpo(cmd.unidadId, cmd.objetivoId);
      case 'Destrabarse':
        return this.destrabarse(cmd.unidadId);
      case 'TerminarActivacion':
        if (this.state.unidadActiva !== cmd.unidadId) return fail('Esa unidad no está activada');
        return ok(this.cerrarActivacion(cmd.unidadId));
      case 'TerminarTurno':
        return this.terminarTurno();
    }
  }

  // ------------------------------------------------------------- Utilidades

  private unidad(id: string): Unidad | undefined {
    return this.state.unidades[id];
  }

  private tipo(id: string): TipoUnidad {
    return this.state.tipos[id]!;
  }

  private parchear(id: string, cambio: Partial<Unidad>): void {
    const u = this.state.unidades[id];
    if (!u) return;
    this.state = { ...this.state, unidades: { ...this.state.unidades, [id]: { ...u, ...cambio } } };
  }

  private sumarPuntos(jugador: PlayerId, puntos: number, motivo: string): GameEvent {
    const total = (this.state.puntos[jugador] ?? 0) + puntos;
    this.state = { ...this.state, puntos: { ...this.state.puntos, [jugador]: total } };
    return { type: 'PuntosGanados', jugador, puntos, motivo, total };
  }

  // ------------------------------------------------------------- Iniciativa

  /** Al empezar cada turno cada jugador tira 1D6: el más alto abre. */
  private tirarIniciativa(): CommandResult {
    if (this.state.fase !== 'Iniciativa') return fail('No toca tirar Iniciativa');

    let tiradas: Record<PlayerId, number> = {};
    let orden: PlayerId[] = [];
    for (let intento = 0; intento < 50 && orden.length === 0; intento++) {
      tiradas = {};
      for (const j of this.state.jugadores) tiradas[j] = this.rng.d6();
      const valores = Object.values(tiradas);
      // Empate: se repite.
      if (new Set(valores).size === valores.length) {
        orden = [...this.state.jugadores].sort((a, b) => (tiradas[b] ?? 0) - (tiradas[a] ?? 0));
      }
    }
    if (orden.length === 0) return fail('No se pudo deshacer el empate');

    this.state = {
      ...this.state,
      fase: 'Despliegue',
      ordenIniciativa: orden,
      jugadorActivo: orden[0] ?? null,
      unidadActiva: null,
      puestosUsados: [],
      reforzados: [],
      desplieguePasado: {},
    };
    const events: GameEvent[] = [{ type: 'IniciativaTirada', turno: this.state.turno, tiradas, orden }];
    // Si nadie puede desplegar nada, se pasa directo a jugar.
    if (!this.puedeDesplegarAlgo(orden[0]!)) events.push(...this.pasarVezDespliegue());
    return ok(events);
  }

  // ------------------------------------------------------------- Despliegue

  /** ¿Le queda algo que sacar este turno? */
  puedeDesplegarAlgo(j: PlayerId): boolean {
    if (this.state.desplieguePasado[j]) return false;
    const suyas = this.state.reserva.filter((r) => r.owner === j);
    if (suyas.length === 0) return false;
    if (this.state.puestos.some((p) => puedeDesplegarEn(this.state, p, j))) return true;
    return Object.values(this.state.unidades).some(
      (u) => u.owner === j && suyas.some((r) => this.motivoRefuerzo(u, r.id) === null),
    );
  }

  private pasarVezDespliegue(): GameEvent[] {
    const orden = this.state.ordenIniciativa;
    const desde = this.state.jugadorActivo ? orden.indexOf(this.state.jugadorActivo) : -1;
    for (let i = 1; i <= orden.length; i++) {
      const j = orden[(desde + i + orden.length) % orden.length]!;
      if (this.puedeDesplegarAlgo(j)) {
        this.state = { ...this.state, jugadorActivo: j };
        return [];
      }
    }
    return this.abrirActivaciones();
  }

  private abrirActivaciones(): GameEvent[] {
    this.state = { ...this.state, fase: 'Activaciones', jugadorActivo: null };
    const events: GameEvent[] = [{ type: 'ActivacionesAbiertas', turno: this.state.turno }];
    const primero = this.state.ordenIniciativa.find((j) => this.tieneSinActivar(j));
    if (!primero) {
      this.state = { ...this.state, fase: 'FinDeTurno' };
      events.push({ type: 'TurnoTerminado', turno: this.state.turno });
      return events;
    }
    this.state = { ...this.state, jugadorActivo: primero };
    return events;
  }

  private desplegar(reservaId: string, puestoId: string, posiciones: readonly Vec2[]): CommandResult {
    if (this.state.fase !== 'Despliegue') return fail('No es el momento de desplegar');
    const entrada = this.state.reserva.find((r) => r.id === reservaId);
    if (!entrada) return fail(`${reservaId} no está en Reserva`);
    if (entrada.owner !== this.state.jugadorActivo) return fail(`No es la vez de ${entrada.owner}`);
    if (this.state.desplieguePasado[entrada.owner]) return fail('Ya has terminado de desplegar');

    const puesto = this.state.puestos.find((p) => p.id === puestoId);
    if (!puesto) return fail(`No existe el puesto ${puestoId}`);
    if (puesto.duenio !== entrada.owner) return fail('Ese puesto no es tuyo');
    if (this.state.puestosUsados.includes(puesto.id)) return fail('Por ese puesto ya ha entrado una unidad este turno');
    if (!puedeDesplegarEn(this.state, puesto, entrada.owner)) return fail('Hay enemigos en el puesto');
    if (posiciones.length !== entrada.minis.length) return fail('Falta colocar alguna miniatura');

    const iAncla = Math.max(0, entrada.minis.findIndex((m) => m.esComandante));
    const tAncla = this.tipo(entrada.minis[iAncla]!.tipoId);
    if (!tocaPuesto(puesto, posiciones[iAncla]!, tAncla.radioPeana)) {
      return fail(entrada.minis.length > 1 ? 'El Comandante tiene que tocar el puesto' : 'Tiene que tocar el puesto');
    }

    const R = restriccionesPara(this.state, entrada.owner, null, DISTANCIA_ENEMIGO);
    const colocadas: { centro: Vec2; radio: number }[] = [];
    for (let i = 0; i < entrada.minis.length; i++) {
      const t = this.tipo(entrada.minis[i]!.tipoId);
      const motivo = motivoSitio(posiciones[i]!, t.radioPeana, R, colocadas);
      if (motivo) return fail(`No cabe: ${motivo}`);
      colocadas.push({ centro: posiciones[i]!, radio: t.radioPeana });
    }
    if (!esCoherente(colocadas)) return fail('La escuadra tiene que quedar en coherencia (1")');

    const minis: Mini[] = entrada.minis.map((m, i) => ({
      id: `${entrada.id}.${i}`,
      tipoId: m.tipoId,
      posicion: posiciones[i]!,
      vidas: this.tipo(m.tipoId).vidas,
      esComandante: m.esComandante,
    }));
    const unidad: Unidad = {
      id: entrada.id,
      owner: entrada.owner,
      minis,
      activada: false,
      accionesRestantes: 0,
      accionesUsadas: [],
      trabadaCon: [],
      seMovio: false,
      corrio: false,
      cargo: false,
      ataqueGratuitoContra: null,
      resistenteUsado: false,
    };
    this.state = {
      ...this.state,
      unidades: { ...this.state.unidades, [unidad.id]: unidad },
      reserva: this.state.reserva.filter((r) => r.id !== reservaId),
      puestosUsados: [...this.state.puestosUsados, puesto.id],
    };
    return ok([
      { type: 'UnidadDesplegada', unidadId: unidad.id, owner: unidad.owner, puestoId },
      ...this.pasarVezDespliegue(),
    ]);
  }

  /** Por qué este Comandante no puede recibir esa miniatura. `null` si puede. */
  motivoRefuerzo(u: Unidad, reservaId: string): string | null {
    const entrada = this.state.reserva.find((r) => r.id === reservaId);
    if (!entrada || entrada.owner !== u.owner) return 'no está en tu Reserva';
    if (!comandanteDe(u)) return 'solo los Comandantes reciben refuerzos';
    if (this.state.reforzados.includes(u.id)) return 'ya ha recibido su refuerzo este turno';
    if (u.trabadaCon.length > 0) return 'está trabado en combate';
    if (entrada.minis.length !== 1 || entrada.minis[0]!.esComandante) return 'solo entra una miniatura suelta';
    const t = this.tipo(entrada.minis[0]!.tipoId);
    if (t.escuadra === null) return `${t.nombre} no forma escuadras`;
    const tropa = tropaDe(u);
    if (tropa.length > 0 && tropa[0]!.tipoId !== t.id) return `la escuadra es de ${this.tipo(tropa[0]!.tipoId).nombre}`;
    if (tropa.length >= t.escuadra) return 'la escuadra está completa';
    return null;
  }

  private reforzar(unidadId: string, reservaId: string, posicion: Vec2): CommandResult {
    if (this.state.fase !== 'Despliegue') return fail('No es el momento de desplegar');
    const u = this.unidad(unidadId);
    if (!u) return fail(`No existe ${unidadId}`);
    if (u.owner !== this.state.jugadorActivo) return fail(`No es la vez de ${u.owner}`);
    if (this.state.desplieguePasado[u.owner]) return fail('Ya has terminado de desplegar');
    const motivo = this.motivoRefuerzo(u, reservaId);
    if (motivo) return fail(`No puede reforzar: ${motivo}`);

    const entrada = this.state.reserva.find((r) => r.id === reservaId)!;
    const t = this.tipo(entrada.minis[0]!.tipoId);
    const R = restriccionesPara(this.state, u.owner, u.id, DISTANCIA_ENEMIGO);
    const propias = u.minis.map((m) => ({ centro: m.posicion, radio: this.tipo(m.tipoId).radioPeana }));
    const sitio = motivoSitio(posicion, t.radioPeana, R, propias);
    if (sitio) return fail(`No cabe: ${sitio}`);
    if (!esCoherente([...propias, { centro: posicion, radio: t.radioPeana }])) {
      return fail('Tiene que entrar en coherencia con la escuadra (1")');
    }

    const nueva: Mini = { id: `${u.id}.${entrada.id}`, tipoId: t.id, posicion, vidas: t.vidas, esComandante: false };
    this.parchear(u.id, { minis: [...u.minis, nueva] });
    this.state = {
      ...this.state,
      reserva: this.state.reserva.filter((r) => r.id !== reservaId),
      reforzados: [...this.state.reforzados, u.id],
    };
    return ok([{ type: 'MiniaturaReforzada', unidadId: u.id, miniId: nueva.id }, ...this.pasarVezDespliegue()]);
  }

  private pasarDespliegue(jugador: PlayerId): CommandResult {
    if (this.state.fase !== 'Despliegue') return fail('No es el momento de desplegar');
    if (jugador !== this.state.jugadorActivo) return fail(`No es la vez de ${jugador}`);
    this.state = { ...this.state, desplieguePasado: { ...this.state.desplieguePasado, [jugador]: true } };
    return ok([{ type: 'DesplieguePasado', jugador }, ...this.pasarVezDespliegue()]);
  }

  // ------------------------------------------------------------- Activación

  private tieneSinActivar(j: PlayerId): boolean {
    return Object.values(this.state.unidades).some((u) => u.owner === j && !u.activada && u.minis.length > 0);
  }

  private activar(unidadId: string): CommandResult {
    if (this.state.fase !== 'Activaciones') return fail('No es momento de activar');
    if (this.state.unidadActiva) return fail(`${this.state.unidadActiva} sigue activada`);
    const u = this.unidad(unidadId);
    if (!u) return fail(`No existe ${unidadId}`);
    if (u.activada) return fail('Ya se activó este turno');
    if (u.owner !== this.state.jugadorActivo) return fail(`Le toca a ${this.state.jugadorActivo}`);
    this.parchear(unidadId, {
      accionesRestantes: 2,
      accionesUsadas: [],
      seMovio: false,
      corrio: false,
      cargo: false,
      ataqueGratuitoContra: null,
    });
    this.state = { ...this.state, unidadActiva: unidadId };
    return ok([{ type: 'UnidadActivada', unidadId, jugador: u.owner }]);
  }

  /** Comprueba las reglas comunes a toda acción. Devuelve el motivo si no se puede. */
  motivoAccion(unidadId: string, accion: ActionKind): string | null {
    if (this.state.unidadActiva !== unidadId) return 'la unidad no está activada';
    const u = this.unidad(unidadId);
    if (!u) return 'la unidad no existe';
    const coste = ACTION_COST[accion];
    if (u.accionesRestantes < coste) return `${accion} cuesta ${coste} y quedan ${u.accionesRestantes}`;
    if (u.accionesUsadas.includes(accion)) return `${accion} ya se ha hecho en esta activación`;
    if (u.corrio && (accion === 'Disparar' || accion === 'AtacarCaC' || accion === 'Cargar')) {
      return 'después de correr no se puede atacar';
    }
    const t = tipoDe(this.state, u);
    if ((accion === 'Mover' || accion === 'Correr' || accion === 'Cargar') && movimientoDe(this.state, u).movimiento === null) {
      return `${t.nombre} no puede moverse`;
    }
    if (u.trabadaCon.length > 0) {
      const libre = accion === 'AtacarCaC' || accion === 'Destrabarse' ||
        (accion === 'Disparar' && t.habilidad === 'Fuego de apoyo');
      if (!libre) return 'trabada en combate: solo puede atacar o destrabarse';
    }
    if (accion === 'AtacarCaC' && u.trabadaCon.length === 0) return 'no está trabada con nadie';
    if (accion === 'Destrabarse' && u.trabadaCon.length === 0) return 'no está trabada';
    return null;
  }

  private gastar(unidadId: string, accion: ActionKind, coste = ACTION_COST[accion]): GameEvent {
    const u = this.unidad(unidadId)!;
    this.parchear(unidadId, {
      accionesRestantes: Math.max(0, u.accionesRestantes - coste),
      accionesUsadas: [...u.accionesUsadas, accion],
    });
    return { type: 'AccionUsada', unidadId, accion, coste };
  }

  private cerrarActivacion(unidadId: string): GameEvent[] {
    if (this.unidad(unidadId)) {
      this.parchear(unidadId, { activada: true, accionesRestantes: 0, ataqueGratuitoContra: null });
    }
    this.state = { ...this.state, unidadActiva: null };
    return [{ type: 'ActivacionTerminada', unidadId }, ...this.pasarVez()];
  }

  /** La vez pasa al siguiente que tenga algo sin activar. Si nadie, se acaba el turno. */
  private pasarVez(): GameEvent[] {
    if (this.state.fase !== 'Activaciones') return [];
    const orden = this.state.ordenIniciativa;
    const desde = this.state.jugadorActivo ? orden.indexOf(this.state.jugadorActivo) : -1;
    for (let i = 1; i <= orden.length; i++) {
      const j = orden[(desde + i + orden.length) % orden.length]!;
      if (this.tieneSinActivar(j)) {
        this.state = { ...this.state, jugadorActivo: j };
        return [];
      }
    }
    this.state = { ...this.state, fase: 'FinDeTurno', jugadorActivo: null, unidadActiva: null };
    return [{ type: 'TurnoTerminado', turno: this.state.turno }];
  }

  // ------------------------------------------------------------- Movimiento

  /** Hasta dónde puede llegar cada miniatura con esta acción. */
  alcanceDe(u: Unidad, accion: 'Mover' | 'Correr' | 'Cargar'): number {
    const { movimiento, velocidad } = movimientoDe(this.state, u);
    if (movimiento === null) return 0;
    return accion === 'Mover' ? movimiento : movimiento + velocidad;
  }

  /**
   * Valida un conjunto de posiciones finales para la unidad. Lo usa el motor al
   * mover y la interfaz para pintar en rojo lo que no vale.
   */
  motivoPosiciones(
    u: Unidad,
    posiciones: Readonly<Record<string, Vec2>>,
    alcance: number | null,
    margenEnemigo: number | null,
  ): string | null {
    const R = restriccionesPara(this.state, u.owner, u.id, margenEnemigo);
    const colocadas: { centro: Vec2; radio: number }[] = [];
    for (const m of u.minis) {
      const p = posiciones[m.id];
      if (!p) return 'falta colocar alguna miniatura';
      const t = this.tipo(m.tipoId);
      if (alcance !== null) {
        const r = recorrido(m.posicion, p, t.radioPeana, R.terreno);
        if (r === null) return 'no hay camino hasta ahí';
        if (r > alcance + 1e-6) return `una miniatura se pasa: ${r.toFixed(1)}" de ${alcance}"`;
      }
      const motivo = motivoSitio(p, t.radioPeana, R, colocadas);
      if (motivo) return motivo;
      colocadas.push({ centro: p, radio: t.radioPeana });
    }
    if (!esCoherente(colocadas)) return 'la escuadra rompería la coherencia (1")';
    return null;
  }

  private mover(unidadId: string, posiciones: Readonly<Record<string, Vec2>>, accion: 'Mover' | 'Correr'): CommandResult {
    const motivo = this.motivoAccion(unidadId, accion);
    if (motivo) return fail(motivo);
    const u = this.unidad(unidadId)!;
    // Fuera de una carga nadie acaba a menos de 1" de un enemigo, ni andando ni corriendo.
    const error = this.motivoPosiciones(u, posiciones, this.alcanceDe(u, accion), DISTANCIA_ENEMIGO);
    if (error) return fail(error);

    const desde: Record<string, Vec2> = {};
    const hasta: Record<string, Vec2> = {};
    for (const m of u.minis) {
      desde[m.id] = m.posicion;
      hasta[m.id] = posiciones[m.id]!;
    }
    const gasto = this.gastar(unidadId, accion);
    this.parchear(unidadId, {
      minis: u.minis.map((m) => ({ ...m, posicion: posiciones[m.id]! })),
      seMovio: true,
      corrio: accion === 'Correr' || u.corrio,
    });
    return ok([gasto, { type: 'UnidadMovida', unidadId, desde, hasta, corriendo: accion === 'Correr' }]);
  }

  /** Las piezas de la unidad, listas para `formar`. */
  piezasDe(u: Unidad): Pieza[] {
    const ancla = anclaDe(u);
    return u.minis.map((m) => ({
      id: m.id,
      radio: this.tipo(m.tipoId).radioPeana,
      desde: m.posicion,
      esAncla: m.id === ancla.id,
    }));
  }

  // ---------------------------------------------------------------- Disparo

  /** Los grupos de la unidad que pueden atacar con un arma de este tipo. */
  private grupos(u: Unidad, kind: 'disparo' | 'cac'): Grupo[] {
    const out: Grupo[] = [];
    const tropa = tropaDe(u);
    const comandante = comandanteDe(u);
    const armaDe = (t: TipoUnidad): Arma | null => (kind === 'disparo' ? t.disparo : t.cac);
    if (tropa.length > 0) {
      const t = this.tipo(tropa[0]!.tipoId);
      const arma = armaDe(t);
      if (arma) out.push({ parte: comandante ? 'tropa' : 'unidad', minis: tropa, tipo: t, arma });
    }
    if (comandante) {
      const t = this.tipo(comandante.tipoId);
      const arma = armaDe(t);
      if (arma) out.push({ parte: tropa.length > 0 ? 'comandante' : 'unidad', minis: [comandante], tipo: t, arma });
    }
    return out;
  }

  /**
   * Las miniaturas del grupo que llegan al objetivo: con el objetivo dentro del
   * alcance de su arma, midiendo desde cada una, y viéndolo. Cada una dispara
   * por su cuenta, así que en una escuadra lejana solo tiran las que alcanzan.
   */
  tiradoresContra(u: Unidad, g: Grupo, objetivo: Unidad): Mini[] {
    if (g.arma.kind !== 'disparo') return [];
    const alcance = g.arma.distancia;
    const sinVision = g.tipo.habilidad === 'Fuego indirecto' || g.tipo.habilidad === 'Poder mental';
    const ignorar = new Set([u.id, objetivo.id]);
    return g.minis.filter((m) => {
      const r = this.tipo(m.tipoId).radioPeana;
      return objetivo.minis.some((o) => {
        const ro = this.tipo(o.tipoId).radioPeana;
        if (baseDistance(m.posicion, r, o.posicion, ro) > alcance + 1e-9) return false;
        return sinVision || veA(this.state, m, o, ignorar);
      });
    });
  }

  /** Por qué esta unidad no puede disparar a esa. `null` si puede. */
  motivoDisparo(unidadId: string, objetivoId: string): string | null {
    const m = this.motivoAccion(unidadId, 'Disparar');
    if (m) return m;
    const u = this.unidad(unidadId)!;
    const o = this.unidad(objetivoId);
    if (!o || o.owner === u.owner) return 'objetivo no válido';
    if (o.trabadaCon.length > 0 && !disparableTrabado(tipoDe(this.state, o))) {
      return 'está trabado en combate: no se le puede disparar';
    }
    const grupos = this.grupos(u, 'disparo');
    if (grupos.length === 0) return 'no tiene arma a distancia';
    if (!grupos.some((g) => this.tiradoresContra(u, g, o).length > 0)) return 'fuera de alcance o sin visión';
    return null;
  }

  /** Situaciones de ataque de cada grupo, para resolver y para prever. */
  situacionesDisparo(u: Unidad, o: Unidad): { grupo: Grupo; minis: Mini[]; situacion: Situacion }[] {
    const out: { grupo: Grupo; minis: Mini[]; situacion: Situacion }[] = [];
    for (const g of this.grupos(u, 'disparo')) {
      const minis = this.tiradoresContra(u, g, o);
      if (minis.length === 0 || g.arma.kind !== 'disparo') continue;
      const arma = g.arma;
      const ignoraCobertura = g.tipo.habilidad === 'Poder mental';
      const cerca = minis.some((m) =>
        o.minis.some(
          (x) =>
            baseDistance(m.posicion, this.tipo(m.tipoId).radioPeana, x.posicion, this.tipo(x.tipoId).radioPeana) <=
            arma.distancia / 2 + 1e-9,
        ),
      );
      const atrincheradas = g.tipo.habilidad === 'Atrincherado'
        ? minis.filter((m) => {
            const blanco = masCercana(o.minis, m.posicion);
            return blanco ? disparaDesdeCobertura(this.state, m, blanco.posicion) : false;
          }).length
        : 0;
      out.push({
        grupo: g,
        minis,
        situacion: {
          ...this.base(g, o),
          minis: minis.length,
          enCobertura: !ignoraCobertura && unidadEnCobertura(this.state, minis, o),
          aMitadDeAlcance: cerca,
          atrincherado: atrincheradas * 2 >= minis.length && atrincheradas > 0,
          emplazado: g.tipo.habilidad === 'Emplazado' && !u.seMovio,
        },
      });
    }
    return out;
  }

  /** Lo común a cualquier ataque de un grupo contra una unidad. */
  private base(g: Grupo, o: Unidad): Omit<Situacion, 'enCobertura'> {
    const defensor = tipoDe(this.state, o);
    return {
      arma: g.arma,
      minis: g.minis.length,
      defensor,
      // El Comandante no tiene ventaja de tipo, y nadie la tiene contra él.
      tipoAtacante: g.parte === 'comandante' || g.tipo.esComandante ? null : g.tipo,
      tipoObjetivo: defensor.esComandante ? null : defensor,
    };
  }

  private disparar(unidadId: string, objetivoId: string): CommandResult {
    const motivo = this.motivoDisparo(unidadId, objetivoId);
    if (motivo) return fail(motivo);
    const u = this.unidad(unidadId)!;
    const o = this.unidad(objetivoId)!;
    const events: GameEvent[] = [this.gastar(unidadId, 'Disparar')];

    for (const { grupo, minis, situacion } of this.situacionesDisparo(u, o)) {
      const objetivo = this.unidad(objetivoId);
      if (!objetivo) break; // ya ha caído con la primera parte
      const tirada = resolverAtaque(this.rng, parametrosAtaque(situacion));
      events.push({
        type: 'AtaqueResuelto',
        atacanteId: unidadId,
        objetivoId,
        arma: 'disparo',
        parte: grupo.parte,
        minis: minis.length,
        enCobertura: situacion.enCobertura,
        gratuito: false,
        tirada,
      });
      const desde = anclaDe(u).posicion;
      const impactada = masCercana(objetivo.minis, desde);
      events.push(...this.danar(objetivoId, tirada.total, unidadId, desde));
      if (tiene(grupo.arma, 'Explosiva') && tirada.total > 0 && impactada) {
        events.push(...this.explosiva(unidadId, impactada, grupo.arma.danio));
      }
      if (this.state.fase === 'Terminada') break;
    }
    return ok(events);
  }

  /**
   * Explosiva: las miniaturas enemigas a 3" de la impactada sufren el daño base,
   * sin salvación. No hay fuego amigo. Si caen varias de la misma escuadra, su
   * daño se suma en un único total.
   */
  private explosiva(atacanteId: string, impactada: Mini, danio: number): GameEvent[] {
    const atacante = this.unidad(atacanteId);
    if (!atacante) return [];
    const rImp = this.tipo(impactada.tipoId).radioPeana;
    const events: GameEvent[] = [];
    for (const u of Object.values(this.state.unidades)) {
      if (u.owner === atacante.owner) continue;
      const alcanzadas = u.minis.filter(
        (m) => m.id !== impactada.id &&
          baseDistance(m.posicion, this.tipo(m.tipoId).radioPeana, impactada.posicion, rImp) <= RADIO_EXPLOSIVA + 1e-9,
      );
      if (alcanzadas.length === 0) continue;
      const total = alcanzadas.length * danio;
      events.push({ type: 'ExplosivaAlcanza', atacanteId, unidadId: u.id, minis: alcanzadas.length, danio: total });
      events.push(...this.danar(u.id, total, atacanteId, impactada.posicion));
      if (this.state.fase === 'Terminada') break;
    }
    return events;
  }

  // ------------------------------------------------------------------ Daño

  /** Aplica daño a una unidad: Resistente, reparto entre miniaturas y bajas. */
  private danar(unidadId: string, total: number, porId: string | null, desde: Vec2 | null): GameEvent[] {
    const u = this.unidad(unidadId);
    if (!u || total <= 0) return [];
    const events: GameEvent[] = [];

    let danio = total;
    let reducido = 0;
    if (tipoDe(this.state, u).habilidad === 'Resistente' && !u.resistenteUsado) {
      reducido = Math.min(danio, this.rng.d3());
      danio -= reducido;
      this.parchear(unidadId, { resistenteUsado: true });
    }

    const actual = this.unidad(unidadId)!;
    const { vivas, muertas } = repartirDanio(actual, danio, desde);
    events.push({ type: 'DanioRecibido', unidadId, danio, reducido, muertas: muertas.map((m) => m.id), porId });

    const atacante = porId ? this.unidad(porId) : undefined;
    if (atacante && muertas.length > 0) {
      const valor = muertas.reduce((s, m) => s + this.tipo(m.tipoId).valor, 0);
      events.push(this.sumarPuntos(atacante.owner, valor, 'bajas'));
    }

    if (vivas.length > 0) {
      this.parchear(unidadId, { minis: vivas });
      return events;
    }

    // Sin miniaturas en pie: la unidad desaparece y suelta a quien tuviera trabado.
    const unidades: Record<string, Unidad> = {};
    for (const [id, otra] of Object.entries(this.state.unidades)) {
      if (id === unidadId) continue;
      unidades[id] = otra.trabadaCon.includes(unidadId)
        ? {
            ...otra,
            trabadaCon: otra.trabadaCon.filter((x) => x !== unidadId),
            ataqueGratuitoContra: otra.ataqueGratuitoContra === unidadId ? null : otra.ataqueGratuitoContra,
          }
        : otra;
    }
    this.state = {
      ...this.state,
      unidades,
      unidadActiva: this.state.unidadActiva === unidadId ? null : this.state.unidadActiva,
    };
    events.push({ type: 'UnidadDestruida', unidadId, owner: u.owner, porId });

    // Como en Advance Wars: quien se queda sin nada sobre la mesa, pierde.
    const sinMesa = !Object.values(this.state.unidades).some((x) => x.owner === u.owner);
    if (sinMesa) events.push(...this.terminar(this.rival(u.owner), `${u.owner} se ha quedado sin unidades en mesa`));
    return events;
  }

  private rival(j: PlayerId): PlayerId | null {
    const vivos = this.state.jugadores.filter((x) => x !== j);
    return vivos.length === 1 ? vivos[0]! : null;
  }

  private terminar(ganador: PlayerId | null, motivo: string): GameEvent[] {
    this.state = { ...this.state, fase: 'Terminada', ganador, jugadorActivo: null, unidadActiva: null };
    return [{ type: 'PartidaTerminada', ganador, motivo }];
  }

  // -------------------------------------------------------- Cuerpo a cuerpo

  /**
   * Dónde quedaría el ancla al cargar contra esa unidad: el punto en contacto
   * más barato de alcanzar, o `null` si no llega.
   */
  sitioDeCarga(u: Unidad, o: Unidad): { sitio: Vec2; contra: Mini; distancia: number } | null {
    const ancla = anclaDe(u);
    const rA = this.tipo(ancla.tipoId).radioPeana;
    const alcance = this.alcanceDe(u, 'Cargar');
    const R = restriccionesPara(this.state, u.owner, u.id, null);
    let mejor: { sitio: Vec2; contra: Mini; distancia: number } | null = null;
    for (const m of o.minis) {
      const rM = this.tipo(m.tipoId).radioPeana;
      // Primero el punto de contacto en línea recta; luego alrededor.
      const recto = normalize(sub(ancla.posicion, m.posicion));
      const angulos = [Math.atan2(recto.y, recto.x)];
      for (let k = 0; k < 24; k++) angulos.push((k / 24) * Math.PI * 2);
      for (const a of angulos) {
        const sitio = add(m.posicion, scale(vec(Math.cos(a), Math.sin(a)), rA + rM + 0.001));
        if (motivoSitio(sitio, rA, R) !== null) continue;
        const d = recorrido(ancla.posicion, sitio, rA, R.terreno);
        if (d === null || d > alcance + 1e-6) continue;
        if (!mejor || d < mejor.distancia) mejor = { sitio, contra: m, distancia: d };
      }
    }
    return mejor;
  }

  /** Por qué no puede cargar contra esa unidad. `null` si puede. */
  motivoCarga(unidadId: string, objetivoId: string): string | null {
    const m = this.motivoAccion(unidadId, 'Cargar');
    if (m) return m;
    const u = this.unidad(unidadId)!;
    const o = this.unidad(objetivoId);
    if (!o || o.owner === u.owner) return 'objetivo no válido';
    if (tipoDe(this.state, o).habilidad === 'Superioridad' && tipoDe(this.state, u).id !== 'titan') {
      return 'solo otro Titán puede trabar a un Titán';
    }
    if (!this.sitioDeCarga(u, o)) return `fuera de alcance de carga (${this.alcanceDe(u, 'Cargar')}")`;
    return null;
  }

  private cargar(unidadId: string, objetivoId: string): CommandResult {
    const motivo = this.motivoCarga(unidadId, objetivoId);
    if (motivo) return fail(motivo);
    const u = this.unidad(unidadId)!;
    const o = this.unidad(objetivoId)!;
    const { sitio, contra } = this.sitioDeCarga(u, o)!;
    const alcance = this.alcanceDe(u, 'Cargar');
    const piezas = this.piezasDe(u);

    // Se comprueba que la escuadra cabe ANTES de tirar: no tiene sentido tirar una carga imposible.
    const llegada = formar(piezas, sitio, restriccionesPara(this.state, u.owner, u.id, null), alcance);
    if (!llegada) return fail('No hay sitio para la escuadra al llegar');

    const desde: Record<string, Vec2> = {};
    for (const m of u.minis) desde[m.id] = m.posicion;
    const events: GameEvent[] = [this.gastar(unidadId, 'Cargar')];
    const dado = this.rng.d6();
    const exito = dado >= CARGA_EXITO;

    if (exito) {
      this.parchear(unidadId, {
        minis: u.minis.map((m) => ({ ...m, posicion: llegada[m.id]! })),
        seMovio: true,
        cargo: true,
      });
      events.push({ type: 'CargaResuelta', unidadId, objetivoId, dado, exito, desde, hasta: llegada });
      // Queda trabada con el objetivo y con cualquier otra unidad enemiga que toque.
      const tocadas = this.enContacto(this.unidad(unidadId)!);
      if (!tocadas.includes(objetivoId)) tocadas.push(objetivoId);
      for (const id of tocadas) events.push(...this.trabar(unidadId, id));
      this.parchear(unidadId, { ataqueGratuitoContra: objetivoId });
      events.push({ type: 'AtaqueGratuitoPendiente', unidadId, objetivoId });
      return ok(events);
    }

    // La carga se frena: el ancla se queda a 1" del objetivo, sin trabar.
    const rA = this.tipo(anclaDe(u).tipoId).radioPeana;
    const rC = this.tipo(contra.tipoId).radioPeana;
    const dir = normalize(sub(sitio, contra.posicion));
    const freno = add(contra.posicion, scale(dir, rC + rA + DISTANCIA_ENEMIGO + 0.01));
    const atras = formar(piezas, freno, restriccionesPara(this.state, u.owner, u.id, DISTANCIA_ENEMIGO), alcance);
    const hasta = atras ?? desde;
    this.parchear(unidadId, { minis: u.minis.map((m) => ({ ...m, posicion: hasta[m.id]! })), seMovio: true });
    events.push({ type: 'CargaResuelta', unidadId, objetivoId, dado, exito, desde, hasta });
    events.push(...this.cerrarActivacion(unidadId));
    return ok(events);
  }

  /** Unidades enemigas en contacto de peana con esta. */
  private enContacto(u: Unidad): string[] {
    const out: string[] = [];
    for (const o of Object.values(this.state.unidades)) {
      if (o.owner === u.owner) continue;
      const toca = u.minis.some((m) =>
        o.minis.some(
          (x) =>
            baseDistance(m.posicion, this.tipo(m.tipoId).radioPeana, x.posicion, this.tipo(x.tipoId).radioPeana) <= 0.01,
        ),
      );
      if (toca) out.push(o.id);
    }
    return out;
  }

  private trabar(a: string, b: string): GameEvent[] {
    const ua = this.unidad(a);
    const ub = this.unidad(b);
    if (!ua || !ub || ua.trabadaCon.includes(b)) return [];
    this.parchear(a, { trabadaCon: [...ua.trabadaCon, b] });
    this.parchear(b, { trabadaCon: [...ub.trabadaCon, a] });
    return [{ type: 'UnidadesTrabadas', a, b }];
  }

  /** Por qué no puede atacar en CaC a esa unidad. `null` si puede. */
  motivoCaC(unidadId: string, objetivoId: string): string | null {
    const u = this.unidad(unidadId);
    if (!u) return 'la unidad no existe';
    if (this.state.unidadActiva !== unidadId) return 'la unidad no está activada';
    if (u.ataqueGratuitoContra === objetivoId) return null;
    const m = this.motivoAccion(unidadId, 'AtacarCaC');
    if (m) return m;
    if (!u.trabadaCon.includes(objetivoId)) return 'solo se ataca a quien está trabado contigo';
    return null;
  }

  /** Situaciones de cada grupo atacando en CaC: todas las miniaturas participan. */
  situacionesCaC(u: Unidad, o: Unidad, gratuito: boolean): { grupo: Grupo; situacion: Situacion }[] {
    const defensor = tipoDe(this.state, o);
    const cobertura = unidadEnCobertura(this.state, u.minis, o);
    return this.grupos(u, 'cac').map((g) => ({
      grupo: g,
      situacion: {
        ...this.base(g, o),
        enCobertura: cobertura,
        objetivoBerserker: defensor.habilidad === 'Berserker',
        cargaBrutal: gratuito && g.tipo.habilidad === 'Carga brutal',
      },
    }));
  }

  private cuerpoACuerpo(unidadId: string, objetivoId: string): CommandResult {
    const motivo = this.motivoCaC(unidadId, objetivoId);
    if (motivo) return fail(motivo);
    const u = this.unidad(unidadId)!;
    const o = this.unidad(objetivoId);
    if (!o) return fail('El objetivo ya no está');
    const gratuito = u.ataqueGratuitoContra === objetivoId;

    const events: GameEvent[] = [];
    if (gratuito) this.parchear(unidadId, { ataqueGratuitoContra: null });
    else events.push(this.gastar(unidadId, 'AtacarCaC'));

    for (const { grupo, situacion } of this.situacionesCaC(u, o, gratuito)) {
      if (!this.unidad(objetivoId)) break;
      const tirada = resolverAtaque(this.rng, parametrosAtaque(situacion));
      events.push({
        type: 'AtaqueResuelto',
        atacanteId: unidadId,
        objetivoId,
        arma: 'cac',
        parte: grupo.parte,
        minis: grupo.minis.length,
        enCobertura: situacion.enCobertura,
        gratuito,
        tirada,
      });
      events.push(...this.danar(objetivoId, tirada.total, unidadId, anclaDe(u).posicion));
      if (this.state.fase === 'Terminada') break;
    }
    return ok(events);
  }

  private destrabarse(unidadId: string): CommandResult {
    const motivo = this.motivoAccion(unidadId, 'Destrabarse');
    if (motivo) return fail(motivo);
    const u = this.unidad(unidadId)!;
    const anclado = u.trabadaCon.some((id) => {
      const o = this.unidad(id);
      return o && tipoDe(this.state, o).habilidad === 'Anclado';
    });
    if (anclado) return fail('Está trabada con una unidad con Anclado: no puede destrabarse');

    const events: GameEvent[] = [this.gastar(unidadId, 'Destrabarse')];
    const dado = this.rng.d6();
    const exito = dado >= DESTRABE_EXITO;
    events.push({ type: 'DestrabeResuelto', unidadId, dado, exito });
    if (!exito) {
      // Pierde todas sus acciones y la activación termina.
      events.push(...this.cerrarActivacion(unidadId));
      return ok(events);
    }
    for (const id of u.trabadaCon) {
      const o = this.unidad(id);
      if (o) this.parchear(id, { trabadaCon: o.trabadaCon.filter((x) => x !== unidadId) });
    }
    this.parchear(unidadId, { trabadaCon: [] });
    return ok(events);
  }

  // -------------------------------------------------------------- Previsión

  /**
   * Qué cabe esperar de un ataque antes de hacerlo. Usa las mismas situaciones
   * que la resolución, así que la interfaz y la IA ven las cuentas de verdad.
   *
   * Para una carga se prevé el ataque gratuito que vendría si prende, con la
   * cobertura que tenga el objetivo desde donde está ahora la unidad.
   */
  prevision(unidadId: string, objetivoId: string, modo: 'disparo' | 'cac' | 'carga'): Prevision | null {
    const u = this.unidad(unidadId);
    const o = this.unidad(objetivoId);
    if (!u || !o) return null;
    const situaciones = modo === 'disparo'
      ? this.situacionesDisparo(u, o).map((x) => x.situacion)
      : this.situacionesCaC(u, o, modo === 'carga' || u.ataqueGratuitoContra === objetivoId).map((x) => x.situacion);
    if (situaciones.length === 0) return null;
    const resistente = tipoDe(this.state, o).habilidad === 'Resistente' && !o.resistenteUsado;
    return prever(situaciones.map(parametrosAtaque), o, anclaDe(u).posicion, resistente);
  }

  // ----------------------------------------------------------- Fin de turno

  private terminarTurno(): CommandResult {
    if (this.state.fase !== 'FinDeTurno') return fail('El turno no ha terminado');
    const events: GameEvent[] = [];

    // Control de puestos con las unidades tal como han quedado.
    const puestos = this.state.puestos.map((p) => {
      const duenio = controlTrasTurno(this.state, p);
      if (duenio === p.duenio) return p;
      events.push({ type: 'PuestoConquistado', puestoId: p.id, jugador: duenio, anterior: p.duenio });
      return { ...p, duenio };
    });
    this.state = { ...this.state, puestos };

    for (const j of this.state.jugadores) {
      const n = puestos.filter((p) => p.duenio === j).length;
      if (n > 0) events.push(this.sumarPuntos(j, n * PUNTOS_POR_PUESTO, 'puestos'));
    }

    // Tomar el Cuartel General enemigo gana en el acto.
    const tomado = puestos.find((p) => p.esCuartelGeneral && p.duenio !== null && this.cuarteles.get(p.id) !== p.duenio);
    if (tomado) return ok([...events, ...this.terminar(tomado.duenio, `ha tomado el Cuartel General ${tomado.id}`)]);

    // Al agotar los turnos gana quien más puntos tenga.
    if (this.state.turno >= this.state.turnosTotales) {
      const orden = [...this.state.jugadores].sort((a, b) => (this.state.puntos[b] ?? 0) - (this.state.puntos[a] ?? 0));
      const primero = orden[0] ?? null;
      const empate = orden.length > 1 && (this.state.puntos[orden[0]!] ?? 0) === (this.state.puntos[orden[1]!] ?? 0);
      return ok([...events, ...this.terminar(empate ? null : primero, 'se acabaron los turnos')]);
    }

    const unidades: Record<string, Unidad> = {};
    for (const [id, u] of Object.entries(this.state.unidades)) {
      unidades[id] = {
        ...u,
        activada: false,
        accionesRestantes: 0,
        accionesUsadas: [],
        seMovio: false,
        corrio: false,
        cargo: false,
        ataqueGratuitoContra: null,
        resistenteUsado: false,
      };
    }
    this.state = {
      ...this.state,
      unidades,
      turno: this.state.turno + 1,
      fase: 'Iniciativa',
      ordenIniciativa: [],
      jugadorActivo: null,
      unidadActiva: null,
      puestosUsados: [],
      reforzados: [],
      desplieguePasado: {},
    };
    return ok(events);
  }
}

/** Distancia de peana a peana entre las dos miniaturas más cercanas de dos unidades. */
export function distanciaEntre(state: GameState, a: Unidad, b: Unidad): number {
  let d = Infinity;
  for (const m of a.minis) {
    const rm = state.tipos[m.tipoId]!.radioPeana;
    for (const x of b.minis) {
      d = Math.min(d, baseDistance(m.posicion, rm, x.posicion, state.tipos[x.tipoId]!.radioPeana));
    }
  }
  return d;
}

export { centerDistance };
