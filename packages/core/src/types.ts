import type { Vec2 } from './geometry.ts';
import type { Cantidad } from './dados.ts';

/** Tipos de unidad del reglamento. */
export type UnitClass =
  | 'Choque'
  | 'Elite'
  | 'Especialista'
  | 'Comando'
  | 'Asaltante'
  | 'ArmasPesadas'
  | 'Monstruo'
  | 'Vehiculo'
  | 'Artilleria'
  | 'Heroe';

/** Set de armas: reparte la potencia entre las dos armas de la unidad. */
export type WeaponSet = 'Equilibrado' | 'Disparo' | 'Asalto';

/**
 * Tabla "Fuerte contra". Atacar a una clase sobre la que se tiene ventaja
 * suma +1 al daño total final del ataque. Los Héroes no tienen ventaja.
 */
export const CLASS_ADVANTAGE: Readonly<Record<UnitClass, readonly UnitClass[]>> = {
  Choque: ['Especialista'],
  Elite: ['Choque', 'Asaltante'],
  Especialista: ['Elite', 'Vehiculo', 'ArmasPesadas'],
  Comando: ['Heroe', 'Monstruo', 'ArmasPesadas'],
  Asaltante: ['Artilleria'],
  ArmasPesadas: ['Choque', 'Asaltante', 'Especialista', 'Heroe'],
  Monstruo: ['Comando', 'Asaltante'],
  Vehiculo: ['Choque', 'Elite', 'Comando', 'Asaltante'],
  Artilleria: ['Choque', 'Elite', 'Especialista', 'Comando', 'Monstruo'],
  Heroe: [],
};

export const CANNOT_HOLD_OBJECTIVES: readonly UnitClass[] = ['Monstruo', 'Vehiculo', 'Artilleria'];
export const SKIRMISH_EXCLUDED: readonly UnitClass[] = ['Monstruo', 'Vehiculo', 'Artilleria'];

/**
 * Vehículos y Monstruos no quedan bloqueados por estar trabados: pueden usar
 * sus acciones con libertad y pueden ser disparados aunque estén en combate.
 */
export const IGNORA_TRABADO: readonly UnitClass[] = ['Vehiculo', 'Monstruo'];

export type GameMode = 'Escaramuza' | 'GranBatalla';

/**
 * Habilidad de arma. `x` guarda el parámetro de las paramétricas
 * (Brutal X+, Explosiva X) y `objetivo` la clase de las Anti-X.
 */
export interface WeaponAbility {
  readonly nombre: string;
  readonly x?: number;
  readonly objetivo?: UnitClass;
}

export interface RangedWeapon {
  readonly kind: 'disparo';
  readonly nombre: string;
  readonly ataques: Cantidad;
  /** Alcance en pulgadas. */
  readonly distancia: number;
  /** Precisión mínima en 1D6. null si el arma no usa Precisión (Directo, Errática). */
  readonly precision: number | null;
  readonly danio: number;
  readonly danioCritico: number;
  readonly habilidades: readonly WeaponAbility[];
}

export interface MeleeWeapon {
  readonly kind: 'cuerpo_a_cuerpo';
  readonly nombre: string;
  readonly ataques: Cantidad;
  readonly danio: number;
  readonly danioCritico: number;
  readonly habilidades: readonly WeaponAbility[];
}

export type Weapon = RangedWeapon | MeleeWeapon;

/** Habilidad de unidad: depende de la clase y del set. */
export interface UnitAbility {
  readonly nombre: string;
  readonly descripcion: string;
}

export interface UnitProfile {
  readonly id: string;
  readonly nombre: string;
  /**
   * Apodo de la unidad en la tabla de Notion (Miliciano, Devastador, Paladín…).
   * Es el nombre del ROL, no el de un arma.
   */
  readonly rol: string | null;
  readonly clase: UnitClass;
  readonly set: WeaponSet | null;
  /** Movimiento en pulgadas. 0 en Artillería, que no se mueve. */
  readonly movimiento: number;
  readonly vidas: number;
  /** Salvación: resultado mínimo del D6 para bloquear un impacto. */
  readonly salvacion: number;
  /** Velocidad: pulgadas extra al Correr y al Cargar. */
  readonly velocidad: number;
  readonly escuadraMin: number;
  readonly escuadraMax: number;
  readonly valor: number;
  readonly habilidad: UnitAbility | null;
  readonly armas: readonly Weapon[];
  /** Radio de peana en pulgadas. */
  readonly radioPeana: number;
}

export interface Unit {
  readonly id: string;
  readonly profileId: string;
  readonly owner: PlayerId;
  readonly position: Vec2;
  readonly vidas: number;
  readonly activated: boolean;
  readonly accionesRestantes: number;
  readonly accionesUsadas: readonly ActionKind[];
  readonly trabadaCon: readonly string[];
  readonly seMovio: boolean;
  readonly corrio: boolean;
  /** Cargó en esta activación (para Carga brutal). */
  readonly cargo: boolean;
  /**
   * Turno en el que fue destruida, o null si sigue en pie. El cadáver
   * permanece en la mesa hasta el final de ese turno: hay habilidades que
   * actúan sobre las unidades destruidas "durante este turno" (el Nigromante,
   * por ejemplo), así que no puede desaparecer en el acto.
   */
  readonly destruidaEnTurno: number | null;
  /**
   * Objetivo del ataque cuerpo a cuerpo gratuito que concede una carga con
   * éxito. Queda pendiente en vez de resolverse solo, para que el jugador lo
   * lance cuando quiera; no consume acciones.
   */
  readonly ataqueGratuitoContra: string | null;
}

export type PlayerId = string;

export type ActionKind =
  | 'Mover'
  | 'Disparar'
  | 'Correr'
  | 'Cargar'
  | 'AtacarCaC'
  | 'Destrabarse';

export const ACTION_COST: Readonly<Record<ActionKind, number>> = {
  Mover: 1,
  Disparar: 1,
  Correr: 2,
  Cargar: 2,
  AtacarCaC: 2,
  Destrabarse: 1,
};

/**
 * Qué hace un elemento de escenografía. Las tres propiedades del reglamento
 * (dejar pasar, dejar ver, dar cobertura) no son independientes: solo se dan
 * en estas tres combinaciones, así que se modelan como un tipo y no como
 * flags sueltos que permitirían estados imposibles.
 *
 *  - `bloqueo`:    muro, edificio. Ni se atraviesa ni se ve a través. Pegarse
 *                  a él no da cobertura: al otro lado nadie te ve, y desde el
 *                  lado en que sí te ven no hay nada que te tape.
 *  - `obstaculo`:  agua, zanja, lava. No se puede atravesar al mover, pero no
 *                  estorba al disparo y nunca da cobertura.
 *  - `cobertura`:  murete, seto, ruinas bajas. Se atraviesa y se dispara a
 *                  través; da cobertura a quien esté pegado si la trayectoria
 *                  del tiro la cruza.
 */
/**
 * Puntos que aporta cada puesto de mando controlado al final del turno. Es lo
 * que convierte la mesa en una partida: sin esto solo se gana aniquilando.
 */
export const PUNTOS_POR_PUESTO = 5;

/**
 * Zona de control, en pulgadas. No se puede terminar un movimiento —ni entrar
 * de refuerzo— a esta distancia o menos de un ENEMIGO, salvo al Cargar. Con
 * las unidades propias no hay separación mínima, solo no solaparse.
 */
export const ZONA_CONTROL = 1;

export type TipoTerreno = 'bloqueo' | 'obstaculo' | 'cobertura';

export interface Terrain {
  readonly id: string;
  readonly rect: import('./geometry.ts').Rect;
  /** En pulgadas. Solo cuenta para la cobertura: debe superar media miniatura. */
  readonly altura: number;
  readonly tipo: TipoTerreno;
}

/** Corta la línea de visión y, por tanto, el disparo. */
export function bloqueaVision(t: Terrain): boolean {
  return t.tipo === 'bloqueo';
}

/** No se puede atravesar ni terminar el movimiento dentro. */
export function bloqueaPaso(t: Terrain): boolean {
  return t.tipo !== 'cobertura';
}

/** Candidato a dar cobertura; que la dé o no depende ya de la trayectoria. */
export function esCobertura(t: Terrain): boolean {
  return t.tipo === 'cobertura';
}

/**
 * Puesto de mando: posición estratégica del campo de batalla. Son a la vez
 * objetivos a conquistar y los ÚNICOS puntos desde los que se despliega.
 * El Cuartel General es un puesto normal a efectos de control y despliegue,
 * salvo que cada jugador tiene obligatoriamente el suyo.
 */
export interface Puesto {
  readonly id: string;
  readonly centro: import('./geometry.ts').Vec2;
  /** Radio del token, en pulgadas. */
  readonly radio: number;
  readonly esCuartelGeneral: boolean;
  /** Quién lo controla ahora mismo; `null` si no lo controla nadie. */
  readonly duenio: PlayerId | null;
}

/** Unidad que todavía no ha entrado al campo de batalla. */
export interface EnReserva {
  readonly id: string;
  readonly profileId: string;
  readonly owner: PlayerId;
}

export type Phase = 'Iniciativa' | 'Activaciones' | 'FinDeTurno';

export interface GameState {
  readonly mode: GameMode;
  readonly turno: number;
  readonly fase: Phase;
  readonly jugadores: readonly PlayerId[];
  readonly ordenIniciativa: readonly PlayerId[];
  readonly jugadorActivo: PlayerId | null;
  readonly unidadActiva: string | null;
  readonly units: Readonly<Record<string, Unit>>;
  readonly profiles: Readonly<Record<string, UnitProfile>>;
  readonly terrain: readonly Terrain[];
  readonly puestos: readonly Puesto[];
  /*
    La reserva vive aparte de `units` a propósito: así todas las reglas que
    recorren el campo de batalla —visión, objetivos, control, fin de turno—
    siguen valiendo sin filtrar por "¿está desplegada?" en cada sitio.
  */
  readonly reserva: readonly EnReserva[];
  /** Puntos de victoria por jugador. */
  readonly puntos: Readonly<Record<PlayerId, number>>;
  /**
   * Quién ha metido ya su refuerzo este turno. Entra UNA unidad por jugador y
   * turno: si no, el primer turno se vacía la reserva entera y la partida se
   * juega antes de empezar.
   */
  readonly refuerzoUsado: Readonly<Record<PlayerId, boolean>>;
  /** Turnos acordados antes de empezar. Al agotarse gana quien más puntos tenga. */
  readonly turnosTotales: number;
  readonly rngState: number;
}
