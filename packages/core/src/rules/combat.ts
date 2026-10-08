import { resolverCantidad, type Cantidad } from '../dados.ts';
import type { Rng } from '../rng.ts';
import type { Arma, HabilidadArma, TipoUnidad } from '../types.ts';

/**
 * Resolución de un ataque: dados de ataque, salvaciones y daño.
 *
 * Todo pasa en dos pasos. `parametrosAtaque` traduce la situación (arma,
 * cobertura, habilidades, ventaja) a números; `resolverAtaque` tira los dados
 * con esos números. La previsión usa los MISMOS parámetros para calcular
 * probabilidades, así que lo que promete la previsión es lo que luego se tira.
 */

/** En cuerpo a cuerpo fallan el 1 y el 2. */
const CAC_IMPACTA = 3;
/** Con el objetivo en cobertura o Berserker, falla también el 3. */
const CAC_IMPACTA_DIFICIL = 4;
const CRITICO = 6;
const CRITICO_BRUTAL = 5;

/** Ningún umbral pasa de 6+, y el 1 siempre falla. */
const acotar = (v: number): number => Math.min(6, Math.max(2, v));

export const tiene = (arma: Arma, h: HabilidadArma): boolean => arma.habilidades.includes(h);

/** La situación del ataque, tal como la ve el motor. */
export interface Situacion {
  readonly arma: Arma;
  /** Cuántas miniaturas atacan con esta arma. */
  readonly minis: number;
  /** Tipo cuya Salvación se tira: la tropa del objetivo, o el Comandante si va solo. */
  readonly defensor: TipoUnidad;
  /** Tipo que ataca, si puede tener ventaja (el Comandante no la tiene). */
  readonly tipoAtacante: TipoUnidad | null;
  /** Tipo atacado a efectos de ventaja (nadie la tiene contra un Comandante). */
  readonly tipoObjetivo: TipoUnidad | null;
  readonly enCobertura: boolean;
  /** Disparo certero: objetivo a la mitad del alcance o menos. */
  readonly aMitadDeAlcance?: boolean;
  /** Atrincherado: dispara desde detrás de una cobertura. */
  readonly atrincherado?: boolean;
  /** Carga brutal: ataque gratuito de una carga. */
  readonly cargaBrutal?: boolean;
  /** Emplazado: no se ha movido en esta activación. */
  readonly emplazado?: boolean;
  /** El objetivo es Berserker: en CaC se falla con 1, 2 y 3. */
  readonly objetivoBerserker?: boolean;
}

export interface Parametros {
  /** Un término por miniatura atacante, más los dados sueltos que se ganen. */
  readonly cantidades: readonly Cantidad[];
  /** `null`: impacta todo sin superar Precisión (Directo). */
  readonly umbralImpacto: number | null;
  readonly umbralCritico: number;
  readonly implacable: boolean;
  readonly salvacion: number;
  /** Los críticos no se pueden salvar. */
  readonly golpeCritico: boolean;
  readonly danio: number;
  readonly danioCritico: number;
  readonly ventaja: number;
  /** Lo que ha modificado el ataque, para enseñarlo en pantalla. */
  readonly notas: readonly string[];
}

export function parametrosAtaque(s: Situacion): Parametros {
  const { arma } = s;
  const notas: string[] = [];
  const cantidades: Cantidad[] = Array.from({ length: s.minis }, () => arma.ataques);

  if (arma.kind === 'disparo' && s.aMitadDeAlcance && tiene(arma, 'Disparo certero')) {
    cantidades.push(1);
    notas.push('Disparo certero +1 dado');
  }
  if (s.emplazado) {
    cantidades.push(1);
    notas.push('Emplazado +1 dado');
  }
  if (arma.kind === 'cac' && s.cargaBrutal) {
    cantidades.push(1);
    notas.push('Carga brutal +1 dado');
  }

  let umbralImpacto: number | null;
  if (arma.kind === 'disparo') {
    if (tiene(arma, 'Directo') || arma.precision === null) {
      umbralImpacto = null;
      notas.push('Directo: impacta sin tirar Precisión');
    } else {
      let p = arma.precision;
      if (s.atrincherado) {
        p -= 1;
        notas.push('Atrincherado: Precisión mejorada en 1');
      }
      umbralImpacto = acotar(p);
    }
  } else {
    const dificil = s.enCobertura || s.objetivoBerserker;
    umbralImpacto = dificil ? CAC_IMPACTA_DIFICIL : CAC_IMPACTA;
    if (s.enCobertura) notas.push('En cobertura: falla con 1, 2 y 3');
    else if (s.objetivoBerserker) notas.push('Berserker: falla con 1, 2 y 3');
  }

  const umbralCritico = tiene(arma, 'Brutal') ? CRITICO_BRUTAL : CRITICO;
  if (umbralCritico === CRITICO_BRUTAL) notas.push('Brutal: crítico con 5+');

  let salvacion = s.defensor.salvacion;
  if (arma.kind === 'disparo' && s.enCobertura) {
    salvacion -= 1;
    notas.push('Cobertura: Salvación +1');
  }
  if (tiene(arma, 'Perforante')) {
    salvacion += 1;
    notas.push('Perforante: Salvación −1');
  }
  salvacion = acotar(salvacion);

  const implacable = tiene(arma, 'Implacable');
  if (implacable) notas.push('Implacable: repite los fallos');
  const golpeCritico = tiene(arma, 'Golpe crítico');
  if (golpeCritico) notas.push('Golpe crítico: los críticos no se salvan');

  let ventaja = 0;
  if (s.tipoAtacante && s.tipoObjetivo) {
    ventaja = s.tipoAtacante.ventajas.find((v) => v.tipoId === s.tipoObjetivo!.id)?.bonus ?? 0;
    if (ventaja > 0) notas.push(`Ventaja contra ${s.tipoObjetivo.nombre} +${ventaja}`);
  }

  return {
    cantidades,
    umbralImpacto,
    umbralCritico,
    implacable,
    salvacion,
    golpeCritico,
    danio: arma.danio,
    danioCritico: arma.danioCritico,
    ventaja,
    notas,
  };
}

/** Todo lo que pasó en una tirada, para poder animarla dado a dado. */
export interface TiradaAtaque {
  readonly parametros: Parametros;
  readonly numeroDeDados: number;
  readonly dados: readonly number[];
  /** Implacable: los dados que fallaron, vueltos a tirar, en el mismo orden. */
  readonly repetidos: readonly number[];
  readonly impactos: number;
  readonly criticos: number;
  readonly salvacionesNormales: readonly number[];
  readonly salvacionesCriticos: readonly number[];
  readonly bloqueados: number;
  readonly danioBase: number;
  readonly danioCritico: number;
  readonly ventaja: number;
  readonly total: number;
}

export function resolverAtaque(rng: Rng, p: Parametros): TiradaAtaque {
  const numeroDeDados = p.cantidades.reduce<number>((s, c) => s + resolverCantidad(rng, c), 0);
  const dados = rng.roll(numeroDeDados);

  const impacta = (d: number): boolean => p.umbralImpacto === null || d >= p.umbralImpacto;
  const fallos = dados.filter((d) => !impacta(d)).length;
  const repetidos = p.implacable ? rng.roll(fallos) : [];

  let impactos = 0;
  let criticos = 0;
  for (const d of [...dados.filter(impacta), ...repetidos.filter(impacta)]) {
    if (d >= p.umbralCritico) criticos++;
    else impactos++;
  }

  // Un 1 natural siempre falla la salvación; el umbral ya está acotado a 2+.
  const salva = (d: number): boolean => d >= p.salvacion;
  const salvacionesNormales = rng.roll(impactos);
  const salvacionesCriticos = p.golpeCritico ? [] : rng.roll(criticos);
  const bloqNormales = salvacionesNormales.filter(salva).length;
  const bloqCriticos = salvacionesCriticos.filter(salva).length;

  const danioBase = (impactos - bloqNormales) * p.danio;
  const danioCritico = (criticos - bloqCriticos) * p.danioCritico;
  const bruto = danioBase + danioCritico;
  const ventaja = bruto > 0 ? p.ventaja : 0;

  return {
    parametros: p,
    numeroDeDados,
    dados,
    repetidos,
    impactos,
    criticos,
    salvacionesNormales,
    salvacionesCriticos,
    bloqueados: bloqNormales + bloqCriticos,
    danioBase,
    danioCritico,
    ventaja,
    total: bruto + ventaja,
  };
}
