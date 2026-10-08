import type { Rect, Vec2 } from './geometry.ts';
import type { Cantidad } from './dados.ts';

export type PlayerId = string;

// ------------------------------------------------------------------- Armas

export type HabilidadArma =
  | 'Fiable'
  | 'Brutal'
  | 'Perforante'
  | 'Golpe crítico'
  | 'Directo'
  | 'Implacable'
  | 'Explosiva'
  | 'Disparo certero';

export interface ArmaDisparo {
  readonly kind: 'disparo';
  readonly ataques: Cantidad;
  /** Alcance en pulgadas. */
  readonly distancia: number;
  /** Umbral para impactar. `null` cuando el arma no tira Precisión (Directo). */
  readonly precision: number | null;
  readonly danio: number;
  readonly danioCritico: number;
  readonly habilidades: readonly HabilidadArma[];
}

export interface ArmaCaC {
  readonly kind: 'cac';
  readonly ataques: Cantidad;
  readonly danio: number;
  readonly danioCritico: number;
  readonly habilidades: readonly HabilidadArma[];
}

export type Arma = ArmaDisparo | ArmaCaC;

// ------------------------------------------------------------ Tipos de unidad

/** Ventaja de tipo: +bonus al daño total contra ese tipo, una vez por ataque. */
export interface Ventaja {
  readonly tipoId: string;
  readonly bonus: number;
}

/** Perfil de un tipo de unidad tal como lo publica el catálogo. */
export interface TipoUnidad {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly esComandante: boolean;
  /** `null`: no puede moverse (Artillería). */
  readonly movimiento: number | null;
  readonly velocidad: number;
  readonly vidas: number;
  readonly salvacion: number;
  /** Cuántas de este tipo puede llevar un Comandante. `null`: no forma escuadra. */
  readonly escuadra: number | null;
  readonly valor: number;
  readonly habilidad: string;
  readonly ventajas: readonly Ventaja[];
  readonly disparo: ArmaDisparo | null;
  readonly cac: ArmaCaC | null;
  /** Radio de la peana en pulgadas, sacado de la tabla de peanas recomendadas. */
  readonly radioPeana: number;
  /** Altura aproximada en pulgadas. Solo cuenta para la cobertura. */
  readonly altura: number;
}

// ---------------------------------------------------------------- Miniaturas

/**
 * Una miniatura sobre la mesa. Las reglas miden casi todo por miniatura
 * —distancias, visión, control de puestos—, así que la posición vive aquí y no
 * en la unidad.
 */
export interface Mini {
  readonly id: string;
  readonly tipoId: string;
  readonly posicion: Vec2;
  readonly vidas: number;
  readonly esComandante: boolean;
}

/**
 * La unidad es lo que se activa: una miniatura sola o una escuadra, que es un
 * Comandante con miniaturas de un único tipo. Solo guarda las miniaturas vivas;
 * cuando se queda sin ninguna, deja de existir.
 */
export interface Unidad {
  readonly id: string;
  readonly owner: PlayerId;
  readonly minis: readonly Mini[];
  /** Ya jugó este turno. */
  readonly activada: boolean;
  readonly accionesRestantes: number;
  readonly accionesUsadas: readonly ActionKind[];
  /** Ids de las unidades enemigas con las que está en combate. */
  readonly trabadaCon: readonly string[];
  readonly seMovio: boolean;
  readonly corrio: boolean;
  readonly cargo: boolean;
  /** Tras una carga con éxito: el ataque cuerpo a cuerpo gratuito pendiente. */
  readonly ataqueGratuitoContra: string | null;
  /** Resistente: ya ha reducido daño este turno. */
  readonly resistenteUsado: boolean;
}

/** Lo que espera en Reserva: un Comandante con su escuadra, o una miniatura suelta. */
export interface EnReserva {
  readonly id: string;
  readonly owner: PlayerId;
  readonly minis: readonly { readonly tipoId: string; readonly esComandante: boolean }[];
}

// --------------------------------------------------------------- Escenografía

/**
 * Qué hace un elemento de escenografía. Las tres propiedades del reglamento
 * (dejar pasar, dejar ver, dar cobertura) solo se dan en estas combinaciones.
 *
 *  - `bloqueo`:    muro, edificio. Ni se atraviesa ni se ve a través.
 *  - `obstaculo`:  agua, zanja. No se atraviesa, pero no estorba al disparo.
 *  - `cobertura`:  murete, seto. Se atraviesa y se dispara a través; cubre a
 *                  quien esté pegado si la trayectoria del tiro lo cruza.
 */
export type TipoTerreno = 'bloqueo' | 'obstaculo' | 'cobertura';

export interface Terrain {
  readonly id: string;
  readonly rect: Rect;
  /** En pulgadas. Para cubrir debe superar la mitad de la miniatura. */
  readonly altura: number;
  readonly tipo: TipoTerreno;
}

export const bloqueaVision = (t: Terrain): boolean => t.tipo === 'bloqueo';
export const bloqueaPaso = (t: Terrain): boolean => t.tipo !== 'cobertura';
export const esCobertura = (t: Terrain): boolean => t.tipo === 'cobertura';

/**
 * Puesto de mando. Es a la vez objetivo a conquistar y el único sitio desde el
 * que se despliega. El Cuartel General es un puesto más, pero cada jugador
 * tiene el suyo y tomar el del rival gana la partida.
 */
export interface Puesto {
  readonly id: string;
  readonly centro: Vec2;
  readonly radio: number;
  readonly esCuartelGeneral: boolean;
  readonly duenio: PlayerId | null;
}

// --------------------------------------------------------------------- Turno

export type ActionKind = 'Mover' | 'Correr' | 'Disparar' | 'Cargar' | 'AtacarCaC' | 'Destrabarse';

export const ACTION_COST: Readonly<Record<ActionKind, number>> = {
  Mover: 1,
  Disparar: 1,
  Correr: 2,
  Cargar: 2,
  AtacarCaC: 2,
  Destrabarse: 1,
};

/**
 * Cada turno: se tira la iniciativa, se despliega, y se alternan activaciones.
 *
 * - `Iniciativa`: falta la tirada del turno.
 * - `Despliegue`: por orden de iniciativa, cada jugador saca una unidad por
 *   puesto que controle y refuerza a sus Comandantes.
 * - `Activaciones`: el grueso del turno.
 * - `FinDeTurno`: momentáneo; se cuentan puestos y puntos.
 * - `Terminada`: alguien ha ganado.
 */
export type Phase = 'Iniciativa' | 'Despliegue' | 'Activaciones' | 'FinDeTurno' | 'Terminada';

export interface GameState {
  readonly turno: number;
  readonly turnosTotales: number;
  readonly fase: Phase;
  readonly jugadores: readonly PlayerId[];
  readonly ordenIniciativa: readonly PlayerId[];
  readonly jugadorActivo: PlayerId | null;
  readonly unidadActiva: string | null;
  readonly unidades: Readonly<Record<string, Unidad>>;
  readonly tipos: Readonly<Record<string, TipoUnidad>>;
  readonly terreno: readonly Terrain[];
  readonly puestos: readonly Puesto[];
  readonly reserva: readonly EnReserva[];
  readonly puntos: Readonly<Record<PlayerId, number>>;
  /** Puestos por los que ya ha entrado una unidad este turno: uno por puesto. */
  readonly puestosUsados: readonly string[];
  /** Comandantes que ya han recibido su refuerzo este turno. */
  readonly reforzados: readonly string[];
  /** Quién ha dicho ya que no despliega más este turno. */
  readonly desplieguePasado: Readonly<Record<PlayerId, boolean>>;
  readonly ganador: PlayerId | null;
  /** Tamaño de la mesa en pulgadas. */
  readonly mesa: { readonly ancho: number; readonly alto: number };
  readonly rngState: number;
}

// ---------------------------------------------------------------- Constantes

/** Puntos por cada puesto controlado al final de cada turno. */
export const PUNTOS_POR_PUESTO = 5;

/** Fuera de una carga, nadie puede acabar a menos de esto de un enemigo. */
export const DISTANCIA_ENEMIGO = 1;

/** Coherencia: cada miniatura de una escuadra a esto o menos de otra. */
export const COHERENCIA = 1;

// ------------------------------------------------------- Reglas por tipo

/** No aportan Valor al control de puestos: los ocupan pero no los conquistan. */
const SIN_VALOR_EN_PUESTOS = new Set(['vehiculo-ligero', 'vehiculo-pesado', 'monstruo', 'artilleria', 'titan']);
/** Demasiado grandes para que nada los tape. */
const SIN_COBERTURA = new Set(['vehiculo-ligero', 'vehiculo-pesado', 'monstruo', 'titan']);
/** Se les puede disparar aunque estén trabados. */
const DISPARABLES_TRABADOS = new Set(['vehiculo-ligero', 'vehiculo-pesado', 'monstruo']);

export const aportaValorEnPuestos = (t: TipoUnidad): boolean => !SIN_VALOR_EN_PUESTOS.has(t.id);
export const puedeTenerCobertura = (t: TipoUnidad): boolean => !SIN_COBERTURA.has(t.id);
export const disparableTrabado = (t: TipoUnidad): boolean => DISPARABLES_TRABADOS.has(t.id);

// ------------------------------------------------------- Consultas de unidad

/** El Comandante, o la única miniatura si va sola. Desde ella se mueve todo. */
export function anclaDe(u: Unidad): Mini {
  return u.minis.find((m) => m.esComandante) ?? u.minis[0]!;
}

export const comandanteDe = (u: Unidad): Mini | undefined => u.minis.find((m) => m.esComandante);

/** Las miniaturas que no son el Comandante: la escuadra propiamente dicha. */
export const tropaDe = (u: Unidad): Mini[] => u.minis.filter((m) => !m.esComandante);

/**
 * El tipo de la unidad a efectos de reglas: el de su tropa si la tiene, o el
 * de la miniatura suelta. Un Comandante solo es de tipo Comandante, y contra él
 * no hay ventaja de tipo.
 */
export function tipoDe(state: GameState, u: Unidad): TipoUnidad {
  const tropa = tropaDe(u)[0];
  return state.tipos[(tropa ?? anclaDe(u)).tipoId]!;
}

/**
 * Movimiento y Velocidad con los que se mueve la unidad. Un Comandante que
 * lidera una escuadra usa los del tipo que comanda; si se queda solo, los suyos.
 */
export function movimientoDe(state: GameState, u: Unidad): { movimiento: number | null; velocidad: number } {
  const t = tipoDe(state, u);
  return { movimiento: t.movimiento, velocidad: t.velocidad };
}

/** Valor total que aporta la unidad viva: el de cada miniatura que sigue en pie. */
export function valorDe(state: GameState, u: Unidad): number {
  return u.minis.reduce((s, m) => s + (state.tipos[m.tipoId]?.valor ?? 0), 0);
}

/** Vidas totales y máximas, sumando todas las miniaturas. */
export function vidasDe(state: GameState, u: Unidad): { actuales: number; maximas: number } {
  let actuales = 0;
  let maximas = 0;
  for (const m of u.minis) {
    actuales += m.vidas;
    maximas += state.tipos[m.tipoId]?.vidas ?? 0;
  }
  return { actuales, maximas };
}

export type { Vec2, Rect };
