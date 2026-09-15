import { Rng } from './rng.ts';
import {
  baseDistance,
  baseSolapaRect,
  centerDistance,
  normalize,
  add,
  recortarPorObstaculos,
  scale,
  type Vec2,
} from './geometry.ts';
import { caminoMasCorto } from './rules/camino.ts';
import { hasCover, lineOfSight } from './rules/los.ts';
import {
  controlTrasTurno,
  dentroDelPuesto,
  libreDeUnidades,
  puedeDesplegarEn,
} from './rules/puestos.ts';
import {
  anguloMuertoBloquea,
  hasAbility,
  resolveMeleeAttack,
  resolveRangedAttack,
  type AttackContext,
} from './rules/combat.ts';
import type { CommandResult, GameEvent } from './events.ts';
import {
  ACTION_COST,
  IGNORA_TRABADO,
  PUNTOS_POR_PUESTO,
  ZONA_CONTROL,
  bloqueaPaso,
  type ActionKind,
  type GameState,
  type MeleeWeapon,
  type PlayerId,
  type Puesto,
  type RangedWeapon,
  type Unit,
  type UnitProfile,
} from './types.ts';

/** Distancia mínima a un enemigo fuera de la carga, en pulgadas. */
/** Carga: 3+ en 1D6. */
const UMBRAL_CARGA = 3;
/** Destrabarse: 4+ en 1D6. */
const UMBRAL_DESTRABE = 4;

export type Command =
  | { type: 'TirarIniciativa' }
  | { type: 'ComenzarActivaciones' }
  | { type: 'ActivarUnidad'; unitId: string }
  | { type: 'Mover'; unitId: string; destino: Vec2 }
  | { type: 'Desplegar'; unitId: string; puestoId: string; posicion: Vec2 }
  | { type: 'Correr'; unitId: string; destino: Vec2 }
  | { type: 'Disparar'; unitId: string; targetId: string; armaNombre: string }
  | { type: 'Cargar'; unitId: string; targetId: string }
  | { type: 'AtacarCaC'; unitId: string; targetId: string; armaNombre: string }
  | { type: 'Destrabarse'; unitId: string }
  | { type: 'TerminarActivacion'; unitId: string }
  | { type: 'TerminarTurno' };

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/**
 * Motor de reglas. No conoce el DOM ni el render: recibe comandos, los valida
 * contra el reglamento y devuelve un estado nuevo más la lista de eventos.
 * Es lo que se reutiliza tal cual en web, móvil y escritorio.
 */
export class Engine {
  private state: GameState;
  private rng: Rng;
  private readonly log: GameEvent[];

  /**
   * `log` permite reconstruir un motor a partir de un estado anterior sin
   * perder el registro: es lo que hace posible deshacer una jugada.
   * El estado del generador aleatorio viaja dentro de `GameState`, así que al
   * restaurar también se restaura la secuencia de dados: repetir la misma
   * acción da el mismo resultado, y no se pueden "rebuscar" tiradas mejores.
   */
  /**
   * `habilidades` enciende o apaga las habilidades de arma y de unidad. Se
   * apagan para jugar solo con los perfiles mientras se afina el resto; el
   * código sigue ahí y sus pruebas también, basta con volver a encenderlas.
   */
  private readonly habilidades: boolean;
  /*
    De quién era cada Cuartel General al empezar. Hace falta para la victoria
    inmediata de Guerra Total: "tomar el CG enemigo" es tomar uno que no fuera
    tuyo de salida, y eso no se puede deducir del estado ya cambiado.
  */
  private readonly cuartelesIniciales: ReadonlyMap<string, PlayerId>;

  constructor(
    initial: GameState,
    log: readonly GameEvent[] = [],
    opciones: { habilidades?: boolean } = {},
  ) {
    this.state = initial;
    this.rng = Rng.restore(initial.rngState);
    this.log = [...log];
    this.habilidades = opciones.habilidades ?? true;
    this.cuartelesIniciales = new Map(
      initial.puestos
        .filter((pm) => pm.esCuartelGeneral && pm.duenio !== null)
        .map((pm) => [pm.id, pm.duenio!] as const),
    );
  }

  getState(): GameState {
    return this.state;
  }

  getLog(): readonly GameEvent[] {
    return this.log;
  }

  private profileOf(unit: Unit): UnitProfile | undefined {
    return this.state.profiles[unit.profileId];
  }

  private unit(id: string): Unit | undefined {
    return this.state.units[id];
  }

  /** Aplica un comando. Si viola una regla, el estado no cambia. */
  execute(cmd: Command): CommandResult {
    const result = this.dispatch(cmd);
    if (result.ok) {
      this.state = { ...this.state, rngState: this.rng.snapshot() };
      this.log.push(...result.events);
    }
    return result;
  }

  private dispatch(cmd: Command): CommandResult {
    switch (cmd.type) {
      case 'ComenzarActivaciones':
        return this.startActivations();
      case 'TirarIniciativa':
        return this.rollInitiative();
      case 'ActivarUnidad':
        return this.activate(cmd.unitId);
      case 'Desplegar':
        return this.deploy(cmd.unitId, cmd.puestoId, cmd.posicion);
      case 'Mover':
        return this.move(cmd.unitId, cmd.destino, 'Mover');
      case 'Correr':
        return this.move(cmd.unitId, cmd.destino, 'Correr');
      case 'Disparar':
        return this.shoot(cmd.unitId, cmd.targetId, cmd.armaNombre);
      case 'Cargar':
        return this.charge(cmd.unitId, cmd.targetId);
      case 'AtacarCaC':
        return this.melee(cmd.unitId, cmd.targetId, cmd.armaNombre);
      case 'Destrabarse':
        return this.disengage(cmd.unitId);
      case 'TerminarActivacion':
        return this.endActivation(cmd.unitId);
      case 'TerminarTurno':
        return this.endTurn();
    }
  }

  // ---------------------------------------------------------------- Iniciativa

  /** Fase de Iniciativa: cada jugador tira 1D6, el más alto activa primero. */
  private rollInitiative(): CommandResult {
    if (this.state.fase !== 'Iniciativa') return fail('No es la Fase de Iniciativa');
    // Una tirada por turno: repetirla cambiaría el orden a mitad de despliegue.
    if (this.state.ordenIniciativa.length > 0) return fail('La Iniciativa ya está tirada');

    let tiradas: Record<PlayerId, number> = {};
    let orden: PlayerId[] = [];

    // En caso de empate se repite la tirada.
    for (let intento = 0; intento < 50; intento++) {
      tiradas = {};
      for (const p of this.state.jugadores) tiradas[p] = this.rng.d6();
      const valores = Object.values(tiradas);
      if (new Set(valores).size === valores.length) {
        orden = [...this.state.jugadores].sort((a, b) => (tiradas[b] ?? 0) - (tiradas[a] ?? 0));
        break;
      }
    }
    if (orden.length === 0) return fail('No se pudo deshacer el empate de Iniciativa');

    // Al inicio del turno todas las unidades vuelven a estar sin activar.
    const units: Record<string, Unit> = {};
    for (const [id, u] of Object.entries(this.state.units)) {
      units[id] = {
        ...u,
        activated: false,
        accionesRestantes: 0,
        accionesUsadas: [],
        seMovio: false,
        corrio: false,
        cargo: false,
        ataqueGratuitoContra: null,
      };
    }

    /*
      La tirada NO abre todavía las activaciones: sigue siendo Fase de
      Iniciativa, que es cuando entran los refuerzos desde Reserva empezando
      por quien ganó la tirada. Las activaciones las abre `ComenzarActivaciones`.
    */
    this.state = {
      ...this.state,
      units,
      ordenIniciativa: orden,
      jugadorActivo: orden[0] ?? null,
      unidadActiva: null,
    };

    return {
      ok: true,
      events: [
        { type: 'TurnoIniciado', turno: this.state.turno },
        { type: 'IniciativaTirada', tiradas, orden },
      ],
    };
  }

  // --------------------------------------------------------------- Activación

  private activate(unitId: string): CommandResult {
    if (this.state.fase !== 'Activaciones') return fail('No es la Fase de Activaciones');
    if (this.state.unidadActiva) return fail(`La unidad ${this.state.unidadActiva} sigue activada`);

    const u = this.unit(unitId);
    if (!u) return fail(`No existe la unidad ${unitId}`);
    if (u.vidas <= 0) return fail('La unidad está destruida');
    if (u.activated) return fail('La unidad ya se activó este turno');
    if (u.owner !== this.state.jugadorActivo) {
      return fail(`No es el turno de ${u.owner}, activa ${this.state.jugadorActivo}`);
    }

    this.patchUnit(unitId, {
      accionesRestantes: 2,
      accionesUsadas: [],
      seMovio: false,
      corrio: false,
      cargo: false,
      ataqueGratuitoContra: null,
    });
    this.state = { ...this.state, unidadActiva: unitId };

    return { ok: true, events: [{ type: 'UnidadActivada', unitId, jugador: u.owner }] };
  }

  /** Comprueba las reglas comunes a toda acción y devuelve el error si las viola. */
  private checkAction(unitId: string, accion: ActionKind): string | null {
    if (this.state.unidadActiva !== unitId) return 'La unidad no está activada';
    const u = this.unit(unitId);
    if (!u) return `No existe la unidad ${unitId}`;
    if (u.vidas <= 0) return 'La unidad está destruida';

    // El ataque gratuito de la carga no cuesta acciones ni cuenta como usada.
    const esGratuito = accion === 'AtacarCaC' && u.ataqueGratuitoContra !== null;
    const coste = esGratuito ? 0 : ACTION_COST[accion];
    if (u.accionesRestantes < coste) {
      return `Acciones insuficientes: ${accion} cuesta ${coste} y quedan ${u.accionesRestantes}`;
    }
    if (!esGratuito && u.accionesUsadas.includes(accion)) {
      return `No se puede repetir ${accion} en la misma activación`;
    }
    // Una unidad trabada solo puede Atacar cuerpo a cuerpo o Destrabarse.
    // Vehículos y Monstruos son la excepción: usan sus acciones con libertad.
    if (
      u.trabadaCon.length > 0 &&
      accion !== 'AtacarCaC' &&
      accion !== 'Destrabarse' &&
      !this.ignoraTrabado(u)
    ) {
      const arma = accion === 'Disparar' ? this.multiusoWeapon(u) : null;
      if (!arma) return 'La unidad está trabada: solo puede Atacar cuerpo a cuerpo o Destrabarse';
    }
    return null;
  }

  /** Un arma con Multiuso permite disparar estando trabado. */
  private multiusoWeapon(u: Unit): RangedWeapon | null {
    if (!this.habilidades) return null;
    const p = this.profileOf(u);
    if (!p) return null;
    for (const w of p.armas) {
      if (w.kind === 'disparo' && hasAbility(w.habilidades, 'Multiuso')) return w;
    }
    return null;
  }

  /** Vehículos y Monstruos no quedan bloqueados por estar trabados. */
  private ignoraTrabado(u: Unit): boolean {
    const p = this.profileOf(u);
    return !!p && IGNORA_TRABADO.includes(p.clase);
  }

  /** Nombre de la habilidad de unidad, para consultarla sin repetir código. */
  private habilidadDe(u: Unit): string | null {
    if (!this.habilidades) return null;
    return this.profileOf(u)?.habilidad?.nombre ?? null;
  }

  /**
   * Efectos de las habilidades de unidad que modifican la resolución de un
   * ataque. Se calculan aquí y se pasan al combate como contexto.
   */
  private contextoAtaque(
    atacante: Unit,
    objetivo: Unit,
    distancia: number,
    enCobertura: boolean,
    tipo: 'disparo' | 'cac',
  ): AttackContext {
    const hab = this.habilidadDe(atacante);
    const habObjetivo = this.habilidadDe(objetivo);
    const ctx: {
      habilidadesArma: boolean;
      distancia: number;
      enCobertura: boolean;
      dadosExtra?: number;
      precisionMejorada?: number;
      repetirFallos?: boolean;
      defensorBerserker?: boolean;
    } = { habilidadesArma: this.habilidades, distancia, enCobertura };

    if (tipo === 'disparo') {
      // Certero y Emplazado premian quedarse quieto.
      if (hab === 'Certero' && !atacante.seMovio) ctx.precisionMejorada = 1;
      if (hab === 'Emplazado' && !atacante.seMovio) ctx.dadosExtra = 1;
      if (hab === 'Tirador') ctx.repetirFallos = true;
    } else {
      if (hab === 'Carga brutal' && atacante.cargo) ctx.dadosExtra = 1;
      if (habObjetivo === 'Berserker') ctx.defensorBerserker = true;
    }
    return ctx;
  }

  private spend(unitId: string, accion: ActionKind): GameEvent {
    const u = this.unit(unitId)!;
    if (accion === 'AtacarCaC' && u.ataqueGratuitoContra !== null) {
      // Gratuito: se consume el derecho, no las acciones.
      this.patchUnit(unitId, { ataqueGratuitoContra: null });
      return { type: 'AccionUsada', unitId, accion, coste: 0 };
    }
    const coste = ACTION_COST[accion];
    this.patchUnit(unitId, {
      accionesRestantes: u.accionesRestantes - coste,
      accionesUsadas: [...u.accionesUsadas, accion],
    });
    return { type: 'AccionUsada', unitId, accion, coste };
  }

  // --------------------------------------------------------------- Movimiento

  /**
   * Busca dónde plantar al atacante en contacto con su objetivo: se prueba la
   * línea recta y, si está ocupada, se va rodeando al objetivo a un lado y a
   * otro. Devuelve también el camino, que es lo que cuesta llegar.
   */
  private huecoParaCargar(
    u: Unit,
    p: UnitProfile,
    t: Unit,
    tp: UnitProfile,
    bloqueantes: readonly import('./geometry.ts').Rect[],
    alcance: number,
  ): { contacto: Vec2; camino: NonNullable<ReturnType<typeof caminoMasCorto>> } | null {
    const separacion = p.radioPeana + tp.radioPeana;
    const base = Math.atan2(u.position.y - t.position.y, u.position.x - t.position.x);
    let mejor: { contacto: Vec2; camino: NonNullable<ReturnType<typeof caminoMasCorto>> } | null = null;

    for (let paso = 0; paso <= 12; paso += 1) {
      for (const signo of paso === 0 ? [1] : [1, -1]) {
        const ang = base + signo * paso * (Math.PI / 12);
        const contacto = add(t.position, scale({ x: Math.cos(ang), y: Math.sin(ang) }, separacion));
        if (bloqueantes.some((r) => baseSolapaRect(contacto, p.radioPeana, r))) continue;
        if (this.pisaAAlguien(contacto, p.radioPeana, [u.id, t.id])) continue;
        const camino = caminoMasCorto(u.position, contacto, p.radioPeana, bloqueantes);
        if (!camino) continue;
        if (camino.longitud <= alcance + 1e-9) return { contacto, camino };
        // Sin alcance, pero sirve para dar el motivo exacto del rechazo.
        if (!mejor || camino.longitud < mejor.camino.longitud) mejor = { contacto, camino };
      }
    }
    return mejor;
  }

  /** ¿Hay alguna miniatura viva solapando esa posición? */
  private pisaAAlguien(pos: Vec2, radio: number, salvo: readonly string[]): boolean {
    return Object.values(this.state.units).some((otra) => {
      if (salvo.includes(otra.id) || otra.vidas <= 0) return false;
      const op = this.profileOf(otra);
      return !!op && centerDistance(pos, otra.position) < radio + op.radioPeana - 1e-9;
    });
  }

  /**
   * De quién es un Cuartel General "de fábrica". Se deduce de la partida: cada
   * jugador empieza controlando el suyo, así que se guarda al arrancar.
   */
  private duenioOriginalDelCG(pm: Puesto): PlayerId | null {
    return this.cuartelesIniciales.get(pm.id) ?? null;
  }

  /** Cierra la ventana de refuerzos y abre las activaciones. */
  private startActivations(): CommandResult {
    if (this.state.fase !== 'Iniciativa') return fail('No es la Fase de Iniciativa');
    if (this.state.ordenIniciativa.length === 0) return fail('Falta tirar Iniciativa');
    this.state = { ...this.state, fase: 'Activaciones' };
    return { ok: true, events: [] };
  }

  // ---------------------------------------------------------------- Refuerzos

  /**
   * Saca una unidad de la Reserva y la pone en mesa pegada a un puesto de
   * mando. Es gratis y no gasta acciones: los refuerzos entran en la Fase de
   * Iniciativa, antes de que nadie active.
   */
  private deploy(unitId: string, puestoId: string, posicion: Vec2): CommandResult {
    if (this.state.fase !== 'Iniciativa') {
      return fail('Los refuerzos solo entran en la Fase de Iniciativa');
    }

    const entrada = this.state.reserva.find((r) => r.id === unitId);
    if (!entrada) return fail(`La unidad ${unitId} no está en reserva`);
    if (this.state.refuerzoUsado[entrada.owner]) {
      return fail('Ya has metido tu refuerzo este turno');
    }
    const p = this.state.profiles[entrada.profileId];
    if (!p) return fail('Perfil no encontrado');

    const puesto = this.state.puestos.find((x) => x.id === puestoId);
    if (!puesto) return fail(`No existe el puesto ${puestoId}`);
    if (puesto.duenio !== entrada.owner) return fail('El puesto no está bajo tu control');
    if (!puedeDesplegarEn(this.state, puesto, entrada.owner)) {
      return fail('Hay enemigos en el puesto: no se puede desplegar');
    }
    if (!dentroDelPuesto(posicion, p.radioPeana, puesto)) {
      return fail('La peana debe caber entera dentro del puesto');
    }
    if (!libreDeUnidades(this.state, posicion, p.radioPeana, 0)) {
      return fail('Ahí ya hay una miniatura');
    }
    const encima = this.state.terrain.find((t) => baseSolapaRect(posicion, p.radioPeana, t.rect));
    if (encima) return fail(`No se puede desplegar sobre ${encima.id}`);
    const cerca = this.enemyWithinDe(entrada.owner, posicion, p.radioPeana, ZONA_CONTROL);
    if (cerca) return fail(`No se puede desplegar a ${ZONA_CONTROL}\" o menos del enemigo ${cerca}`);

    const unidad: Unit = {
      id: entrada.id,
      profileId: entrada.profileId,
      owner: entrada.owner,
      position: posicion,
      vidas: p.vidas,
      activated: false,
      accionesRestantes: 2,
      accionesUsadas: [],
      trabadaCon: [],
      seMovio: false,
      corrio: false,
      cargo: false,
      destruidaEnTurno: null,
      ataqueGratuitoContra: null,
    };
    this.state = {
      ...this.state,
      units: { ...this.state.units, [unidad.id]: unidad },
      reserva: this.state.reserva.filter((r) => r.id !== unitId),
      refuerzoUsado: { ...this.state.refuerzoUsado, [entrada.owner]: true },
    };
    return { ok: true, events: [{ type: 'UnidadDesplegada', unitId, puestoId, posicion }] };
  }

  private move(unitId: string, destino: Vec2, accion: 'Mover' | 'Correr'): CommandResult {
    const err = this.checkAction(unitId, accion);
    if (err) return fail(err);

    const u = this.unit(unitId)!;
    const p = this.profileOf(u);
    if (!p) return fail('Perfil no encontrado');
    if (p.clase === 'Artilleria') return fail('La Artillería no puede moverse');

    const permitido = accion === 'Correr' ? p.movimiento + p.velocidad : p.movimiento;
    /*
      La distancia que cuenta es la RECORRIDA, no la línea recta: con un muro
      delante se puede ir hasta su esquina y girar, y eso cuesta lo que mide el
      rodeo. Antes se medía en recto y además se exigía que el recto estuviera
      limpio, así que pegado a una esquina no se podía ir a ninguna parte.
    */
    const camino = caminoMasCorto(
      u.position,
      destino,
      p.radioPeana,
      this.state.terrain.filter(bloqueaPaso).map((t) => t.rect),
    );
    if (!camino) return fail('No hay camino hasta ahí: la escenografía lo corta');
    const recorrido = camino.longitud;
    if (recorrido > permitido + 1e-9) {
      return fail(`Movimiento excedido: ${recorrido.toFixed(2)}" supera ${permitido}"`);
    }

    // No se puede terminar a 1" o menos de un enemigo, salvo al Cargar.
    const conflicto = this.enemyWithin(unitId, destino, p.radioPeana, ZONA_CONTROL);
    if (conflicto) {
      return fail(`No se puede terminar a ${ZONA_CONTROL}" o menos del enemigo ${conflicto}`);
    }

    /*
      La escenografía se valida aquí y no solo en la interfaz: el núcleo es el
      que manda sobre las reglas, y así cualquier cliente futuro las hereda.
    */
    /*
      Ni encima de otra miniatura. No estaba comprobado: con varias unidades
      yendo al mismo sitio acababan apiladas una sobre otra.
    */
    const pisada = Object.values(this.state.units).find((otra) => {
      if (otra.id === unitId || otra.vidas <= 0) return false;
      const op = this.profileOf(otra);
      if (!op) return false;
      // Entre centros: `baseDistance` se queda en 0 al solapar y no distingue.
      return centerDistance(destino, otra.position) < p.radioPeana + op.radioPeana - 1e-9;
    });
    if (pisada) return fail(`No se puede terminar el movimiento encima de ${pisada.id}`);

    const dentro = this.state.terrain.find((t) => baseSolapaRect(destino, p.radioPeana, t.rect));
    if (dentro) return fail(`No se puede terminar el movimiento sobre ${dentro.id}`);

    const desde = u.position;
    const events: GameEvent[] = [this.spend(unitId, accion)];
    this.patchUnit(unitId, {
      position: destino,
      seMovio: true,
      corrio: accion === 'Correr',
    });
    events.push({ type: 'UnidadMovida', unitId, desde, hasta: destino, distancia: recorrido });
    return { ok: true, events };
  }

  /** Id del primer enemigo a `margen` pulgadas o menos de la posición dada. */
  private enemyWithin(unitId: string, pos: Vec2, radius: number, margen: number): string | null {
    const u = this.unit(unitId)!;
    return this.enemyWithinDe(u.owner, pos, radius, margen, unitId);
  }

  /** Igual, pero por bando: sirve también para una unidad que aún no está en mesa. */
  private enemyWithinDe(
    owner: PlayerId,
    pos: Vec2,
    radius: number,
    margen: number,
    excluir?: string,
  ): string | null {
    for (const other of Object.values(this.state.units)) {
      if (other.id === excluir || other.owner === owner || other.vidas <= 0) continue;
      const op = this.profileOf(other);
      if (!op) continue;
      if (baseDistance(pos, radius, other.position, op.radioPeana) <= margen) return other.id;
    }
    return null;
  }

  // ------------------------------------------------------------------ Disparo

  private shoot(unitId: string, targetId: string, armaNombre: string): CommandResult {
    const err = this.checkAction(unitId, 'Disparar');
    if (err) return fail(err);

    const u = this.unit(unitId)!;
    const p = this.profileOf(u);
    const t = this.unit(targetId);
    if (!p) return fail('Perfil del atacante no encontrado');
    if (!t) return fail(`No existe el objetivo ${targetId}`);
    if (t.vidas <= 0) return fail('El objetivo ya está destruido');
    if (t.owner === u.owner) return fail('No se puede disparar a una unidad aliada');
    const tp = this.profileOf(t);
    if (!tp) return fail('Perfil del objetivo no encontrado');

    if (u.corrio) return fail('La unidad corrió: no puede atacar esta activación');

    const arma = p.armas.find((w) => w.kind === 'disparo' && w.nombre === armaNombre) as
      | RangedWeapon
      | undefined;
    if (!arma) return fail(`El arma a distancia "${armaNombre}" no está en el perfil`);

    // Atacante trabado: necesita Multiuso, salvo Vehículos y Monstruos.
    if (u.trabadaCon.length > 0 && !this.ignoraTrabado(u)) {
      if (!this.habilidades || !hasAbility(arma.habilidades, 'Multiuso')) {
        return fail('Trabada: solo se puede disparar con un arma con Multiuso');
      }
      if (!u.trabadaCon.includes(targetId)) {
        return fail('Multiuso solo permite disparar a la unidad con la que se combate');
      }
    }

    // Objetivo trabado: no puede ser disparado desde fuera del combate.
    // Excepción: Vehículos y Monstruos sí pueden serlo.
    if (t.trabadaCon.length > 0 && !this.ignoraTrabado(t) && !t.trabadaCon.includes(unitId)) {
      return fail('El objetivo está trabado en cuerpo a cuerpo: no puede ser disparado desde fuera');
    }

    // Terror: nadie puede dispararle a 12" o menos.
    if (this.habilidadDe(t) === 'Terror') {
      const d = baseDistance(u.position, p.radioPeana, t.position, tp.radioPeana);
      if (d <= 12) return fail('Terror: no se puede disparar a esta unidad a 12" o menos');
    }

    const distancia = baseDistance(u.position, p.radioPeana, t.position, tp.radioPeana);
    if (distancia > arma.distancia) {
      return fail(`Fuera de alcance: ${distancia.toFixed(2)}" supera ${arma.distancia}"`);
    }
    if (this.habilidades && anguloMuertoBloquea(arma, distancia)) {
      return fail(
        `Ángulo muerto: no puede disparar por debajo de ${(arma.distancia / 2).toFixed(1)}"`,
      );
    }

    if (!this.habilidades || !hasAbility(arma.habilidades, 'Parabólica')) {
      const los = lineOfSight(this.state, u, p, t, tp);
      if (!los.visible) return fail('Sin línea de visión al objetivo');
    }

    const enCobertura = hasCover(this.state, u, p, t, tp);
    const resultado = resolveRangedAttack(
      this.rng,
      arma,
      p,
      tp,
      this.contextoAtaque(u, t, distancia, enCobertura, 'disparo'),
    );

    const events: GameEvent[] = [this.spend(unitId, 'Disparar')];
    events.push({ type: 'DisparoResuelto', attackerId: unitId, targetId, arma: arma.nombre, resultado });
    events.push(...this.applyDamage(targetId, resultado.danioTotal, unitId));
    if (resultado.danioRetroceso > 0) {
      events.push(...this.applyDamage(unitId, resultado.danioRetroceso));
    }
    return { ok: true, events };
  }

  // -------------------------------------------------------------------- Carga

  private charge(unitId: string, targetId: string): CommandResult {
    const err = this.checkAction(unitId, 'Cargar');
    if (err) return fail(err);

    const u = this.unit(unitId)!;
    const p = this.profileOf(u);
    const t = this.unit(targetId);
    if (!p || !t) return fail('Unidad u objetivo no encontrados');
    if (t.owner === u.owner) return fail('No se puede cargar contra un aliado');
    const tp = this.profileOf(t);
    if (!tp) return fail('Perfil del objetivo no encontrado');

    const alcance = p.movimiento + p.velocidad;

    /*
      La carga es un movimiento como cualquier otro: ni atraviesa lo que bloquea
      el paso ni se mide en línea recta. Puede doblar por una esquina, y lo que
      cuenta para el alcance es el recorrido real.
    */
    const bloqueantes = this.state.terrain.filter(bloqueaPaso).map((x) => x.rect);
    /*
      El punto de contacto no tiene por qué ser el de la línea recta: si ahí ya
      hay otra miniatura se rodea al objetivo hasta encontrar hueco. Sin esto la
      carga apilaba al atacante encima de un tercero.
    */
    const sitio = this.huecoParaCargar(u, p, t, tp, bloqueantes, alcance);
    if (!sitio) return fail('No hay sitio libre para trabar con el objetivo');
    const { contacto, camino } = sitio;
    if (camino.longitud > alcance + 1e-9) {
      return fail(`Carga fuera de alcance: ${camino.longitud.toFixed(2)}" supera ${alcance}"`);
    }
    const dir = normalize({ x: contacto.x - t.position.x, y: contacto.y - t.position.y });

    const events: GameEvent[] = [this.spend(unitId, 'Cargar')];
    const dado = this.rng.d6();
    const exito = dado >= UMBRAL_CARGA;

    /*
      Al fallar la carga la miniatura se frena a 1" del objetivo. Si ahí hay
      alguien, se queda donde estaba: mejor no haber avanzado que acabar encima
      de un tercero.
    */
    const frenada = add(t.position, scale(dir, p.radioPeana + tp.radioPeana + ZONA_CONTROL));
    const destino = exito
      ? contacto
      : this.pisaAAlguien(frenada, p.radioPeana, [unitId, targetId])
        ? u.position
        : frenada;

    this.patchUnit(unitId, { position: destino, seMovio: true, cargo: exito });
    events.push({ type: 'CargaResuelta', unitId, targetId, dado, exito });

    if (!exito) {
      // Se frena a 1" y su activación termina.
      this.patchUnit(unitId, { accionesRestantes: 0 });
      events.push(...this.finishActivation(unitId));
      return { ok: true, events };
    }

    // Éxito: quedan trabadas y queda pendiente un ataque gratuito, que el
    // jugador lanza cuando quiera. La activación NO termina aquí: si acabara,
    // no habría ocasión de hacer ese ataque.
    this.engage(unitId, targetId);
    events.push({ type: 'UnidadesTrabadas', a: unitId, b: targetId });

    // Atropello: al trabar durante la carga, el objetivo sufre 1D3 automáticos.
    if (this.habilidadDe(u) === 'Atropello') {
      const d = this.rng.d3();
      events.push(...this.applyDamage(targetId, d, unitId));
    }

    const objetivoVivo = this.unit(targetId);
    if (objetivoVivo && objetivoVivo.vidas > 0) {
      this.patchUnit(unitId, { ataqueGratuitoContra: targetId });
      events.push({ type: 'AtaqueGratuitoPendiente', unitId, targetId });
      return { ok: true, events };
    }

    events.push(...this.finishActivation(unitId));
    return { ok: true, events };
  }

  // ------------------------------------------------------------ Cuerpo a cuerpo

  private melee(unitId: string, targetId: string, armaNombre: string): CommandResult {
    const err = this.checkAction(unitId, 'AtacarCaC');
    if (err) return fail(err);

    const u = this.unit(unitId)!;
    const p = this.profileOf(u);
    const t = this.unit(targetId);
    if (!p || !t) return fail('Unidad u objetivo no encontrados');
    const tp = this.profileOf(t);
    if (!tp) return fail('Perfil del objetivo no encontrado');
    const arma = p.armas.find((w) => w.kind === 'cuerpo_a_cuerpo' && w.nombre === armaNombre) as
      | MeleeWeapon
      | undefined;
    if (!arma) return fail(`El arma de cuerpo a cuerpo "${armaNombre}" no está en el perfil`);

    // Alcance permite golpear a cualquier enemigo a 3" o menos, trabado o no.
    const distancia = baseDistance(u.position, p.radioPeana, t.position, tp.radioPeana);
    const conAlcance = this.habilidades && hasAbility(arma.habilidades, 'Alcance');
    if (!u.trabadaCon.includes(targetId)) {
      if (!conAlcance) return fail('Solo se puede atacar a una unidad trabada');
      if (distancia > 3) return fail(`Alcance: el objetivo está a ${distancia.toFixed(2)}", más de 3"`);
    }

    const events: GameEvent[] = [this.spend(unitId, 'AtacarCaC')];

    // Barrido ataca a todas las unidades trabadas con esta, una por una.
    const objetivos = this.habilidades && hasAbility(arma.habilidades, 'Barrido')
      ? [...new Set([targetId, ...u.trabadaCon])]
      : [targetId];
    if (objetivos.length > 1) {
      events.push({ type: 'BarridoDeclarado', unitId, objetivos });
    }

    for (const oid of objetivos) {
      const o = this.unit(oid);
      const op = o ? this.profileOf(o) : undefined;
      if (!o || !op || o.vidas <= 0) continue;
      const cobertura = hasCover(this.state, u, p, o, op);
      const d = baseDistance(u.position, p.radioPeana, o.position, op.radioPeana);
      const resultado = resolveMeleeAttack(
        this.rng,
        arma,
        p,
        op,
        this.contextoAtaque(u, o, d, cobertura, 'cac'),
      );
      events.push({ type: 'CaCResuelto', attackerId: unitId, targetId: oid, arma: arma.nombre, resultado });
      events.push(...this.applyDamage(oid, resultado.danioTotal, unitId));
      if (resultado.danioRetroceso > 0) {
        events.push(...this.applyDamage(unitId, resultado.danioRetroceso));
      }
    }

    events.push(...this.finishActivation(unitId));
    return { ok: true, events };
  }

  private disengage(unitId: string): CommandResult {
    const err = this.checkAction(unitId, 'Destrabarse');
    if (err) return fail(err);

    const u = this.unit(unitId)!;
    if (u.trabadaCon.length === 0) return fail('La unidad no está trabada');

    // Anclado: los enemigos trabados con esa unidad no pueden destrabarse.
    const anclado = u.trabadaCon.some((id) => {
      const o = this.unit(id);
      return !!o && this.habilidadDe(o) === 'Anclado';
    });
    const porrazo = this.habilidadDe(u) === 'Porrazo';
    if (anclado && !porrazo) {
      return fail('Anclado: no puede destrabarse de esa unidad');
    }

    const events: GameEvent[] = [this.spend(unitId, 'Destrabarse')];
    // Porrazo permite destrabarse sin efectuar el chequeo.
    const dado = porrazo ? 6 : this.rng.d6();
    const exito = porrazo || dado >= UMBRAL_DESTRABE;
    events.push({ type: 'DestrabeResuelto', unitId, dado, exito });

    if (exito) {
      // Una única tirada separa de todas las unidades con las que combate.
      for (const otherId of u.trabadaCon) this.disengagePair(unitId, otherId);
      this.patchUnit(unitId, { trabadaCon: [] });
    } else {
      this.patchUnit(unitId, { accionesRestantes: 0 });
      events.push(...this.finishActivation(unitId));
    }
    return { ok: true, events };
  }

  // ------------------------------------------------------------------- Estado

  /**
   * `causanteId` es quien inflige el daño: si la baja es suya, se apunta el
   * Valor de la unidad destruida. Los retrocesos de un arma inestable pasan sin
   * causante — matarte solo no da puntos a nadie.
   */
  private applyDamage(unitId: string, danio: number, causanteId?: string): GameEvent[] {
    if (danio <= 0) return [];
    const u = this.unit(unitId);
    if (!u) return [];
    const vidas = Math.max(0, u.vidas - danio);
    this.patchUnit(unitId, { vidas });
    const events: GameEvent[] = [{ type: 'DanioAplicado', unitId, danio, vidasRestantes: vidas }];
    if (vidas === 0) {
      this.patchUnit(unitId, { destruidaEnTurno: this.state.turno });
      // Al morir deja de estar trabada con nadie.
      for (const otherId of u.trabadaCon) this.disengagePair(unitId, otherId);
      this.patchUnit(unitId, { trabadaCon: [] });
      events.push({ type: 'UnidadDestruida', unitId });

      // Puntos por la baja: vale lo que costaba la unidad.
      const causante = causanteId ? this.unit(causanteId) : undefined;
      const perfil = this.profileOf(u);
      if (causante && perfil && causante.owner !== u.owner) {
        const total = (this.state.puntos[causante.owner] ?? 0) + perfil.valor;
        this.state = {
          ...this.state,
          puntos: { ...this.state.puntos, [causante.owner]: total },
        };
        events.push({
          type: 'PuntosGanados', jugador: causante.owner, puntos: perfil.valor, total,
        });
      }
    }
    return events;
  }

  private engage(a: string, b: string): void {
    const ua = this.unit(a);
    const ub = this.unit(b);
    if (!ua || !ub) return;
    if (!ua.trabadaCon.includes(b)) this.patchUnit(a, { trabadaCon: [...ua.trabadaCon, b] });
    const ub2 = this.unit(b)!;
    if (!ub2.trabadaCon.includes(a)) this.patchUnit(b, { trabadaCon: [...ub2.trabadaCon, a] });
  }

  private disengagePair(a: string, b: string): void {
    const ub = this.unit(b);
    if (ub) this.patchUnit(b, { trabadaCon: ub.trabadaCon.filter((id) => id !== a) });
  }

  private endActivation(unitId: string): CommandResult {
    if (this.state.unidadActiva !== unitId) return fail('Esa unidad no está activada');
    return { ok: true, events: this.finishActivation(unitId) };
  }

  /** Cierra la activación y pasa el turno al siguiente jugador con unidades. */
  private finishActivation(unitId: string): GameEvent[] {
    this.patchUnit(unitId, { activated: true, accionesRestantes: 0, ataqueGratuitoContra: null });
    this.state = { ...this.state, unidadActiva: null };
    const events: GameEvent[] = [{ type: 'ActivacionTerminada', unitId }];

    const siguiente = this.nextPlayer();
    if (siguiente === null) {
      // Todas las unidades activadas: fin de turno.
      this.state = { ...this.state, fase: 'FinDeTurno', jugadorActivo: null };
      events.push({ type: 'TurnoTerminado', turno: this.state.turno });
    } else {
      this.state = { ...this.state, jugadorActivo: siguiente };
    }
    return events;
  }

  /**
   * Los jugadores alternan activaciones. Si a un jugador no le quedan unidades
   * sin activar, se salta y sigue el siguiente que sí tenga.
   */
  private nextPlayer(): PlayerId | null {
    const orden = this.state.ordenIniciativa;
    const actual = this.state.jugadorActivo;
    const start = actual ? orden.indexOf(actual) : -1;
    for (let i = 1; i <= orden.length; i++) {
      const candidato = orden[(start + i + orden.length) % orden.length];
      if (candidato && this.hasPendingUnits(candidato)) return candidato;
    }
    return null;
  }

  private hasPendingUnits(player: PlayerId): boolean {
    return Object.values(this.state.units).some(
      (u) => u.owner === player && !u.activated && u.vidas > 0,
    );
  }

  private endTurn(): CommandResult {
    if (this.state.fase !== 'FinDeTurno') return fail('El turno aún no ha terminado');

    /*
      Un bando sigue vivo si le queda algo EN MESA o EN RESERVA: con todas las
      unidades esperando a desplegar, el tablero está vacío y sin esto la
      partida se daría por terminada en el primer fin de turno.
    */
    const vivos = new Set([
      ...Object.values(this.state.units).filter((u) => u.vidas > 0).map((u) => u.owner),
      ...this.state.reserva.map((r) => r.owner),
    ]);
    if (vivos.size <= 1) {
      const ganador = [...vivos][0] ?? null;
      this.state = { ...this.state, fase: 'FinDeTurno' };
      return { ok: true, events: [{ type: 'PartidaTerminada', ganador }] };
    }

    // Al empezar el turno siguiente se retiran los cadáveres del anterior.
    const nuevoTurno = this.state.turno + 1;
    const events: GameEvent[] = [];
    const units: Record<string, Unit> = {};
    for (const [id, u] of Object.entries(this.state.units)) {
      if (u.destruidaEnTurno !== null && u.destruidaEnTurno < nuevoTurno) {
        events.push({ type: 'UnidadRetirada', unitId: id });
        continue;
      }
      units[id] = u;
    }

    /*
      Control de los puestos: se resuelve antes de pasar de turno, con las
      unidades tal como quedaron. Los cadáveres ya no cuentan porque `ocupantes`
      solo mira unidades vivas.
    */
    const puestos = this.state.puestos.map((puesto) => {
      const duenio = controlTrasTurno({ ...this.state, units }, puesto);
      if (duenio === puesto.duenio) return puesto;
      events.push({
        type: 'PuestoConquistado',
        puestoId: puesto.id,
        jugador: duenio,
        anterior: puesto.duenio,
      });
      return { ...puesto, duenio };
    });

    /*
      El orden de Iniciativa describe el turno que acaba, así que se borra: el
      turno nuevo empieza por su propia tirada. Sin esto la interfaz se saltaba
      la tirada del turno 2 y arrancaba activando con el orden viejo.
    */
    /*
      Puntuación: cada puesto controlado al cerrar el turno suma. Se cuenta
      DESPUÉS de resolver el control, así que el que acabas de conquistar ya
      puntúa este mismo turno.
    */
    const puntos: Record<string, number> = { ...this.state.puntos };
    for (const pm of puestos) {
      if (!pm.duenio) continue;
      puntos[pm.duenio] = (puntos[pm.duenio] ?? 0) + PUNTOS_POR_PUESTO;
    }
    for (const jugador of this.state.jugadores) {
      const antes = this.state.puntos[jugador] ?? 0;
      const ahora = puntos[jugador] ?? 0;
      if (ahora !== antes) {
        events.push({ type: 'PuntosGanados', jugador, puntos: ahora - antes, total: ahora });
      }
    }

    /*
      Victorias de Guerra Total. Se comprueban con el control ya resuelto:
        1. Tomar el Cuartel General enemigo gana en el acto.
        2. Al agotarse los turnos acordados, gana quien más puntos lleve.
    */
    const conquistador = puestos.find(
      (pm) => pm.esCuartelGeneral && pm.duenio !== null && pm.duenio !== this.duenioOriginalDelCG(pm),
    );
    if (conquistador) {
      this.state = { ...this.state, units, puestos, puntos, fase: 'FinDeTurno' };
      events.push({ type: 'PuestoConquistado', puestoId: conquistador.id, jugador: conquistador.duenio, anterior: null });
      events.push({ type: 'PartidaTerminada', ganador: conquistador.duenio });
      return { ok: true, events };
    }
    if (nuevoTurno > this.state.turnosTotales) {
      const ganador = this.state.jugadores.reduce<PlayerId | null>((mejor, j) => {
        if (mejor === null) return j;
        const suyos = puntos[j] ?? 0;
        const otros = puntos[mejor] ?? 0;
        if (suyos > otros) return j;
        return suyos === otros ? null : mejor;
      }, null);
      this.state = { ...this.state, units, puestos, puntos, fase: 'FinDeTurno' };
      events.push({ type: 'PartidaTerminada', ganador });
      return { ok: true, events };
    }

    this.state = {
      ...this.state,
      units,
      puestos,
      puntos,
      turno: nuevoTurno,
      fase: 'Iniciativa',
      refuerzoUsado: {},
      ordenIniciativa: [],
      jugadorActivo: null,
      unidadActiva: null,
    };
    return { ok: true, events };
  }

  private patchUnit(id: string, patch: Partial<Unit>): void {
    const current = this.state.units[id];
    if (!current) return;
    this.state = {
      ...this.state,
      units: { ...this.state.units, [id]: { ...current, ...patch } },
    };
  }
}
