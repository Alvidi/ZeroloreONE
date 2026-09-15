import type { Rng } from '../rng.ts';
import { resolverCantidad } from '../dados.ts';
import {
  CLASS_ADVANTAGE,
  type MeleeWeapon,
  type RangedWeapon,
  type UnitClass,
  type UnitProfile,
  type WeaponAbility,
} from '../types.ts';

/**
 * Con las habilidades apagadas solo sobreviven las que definen cómo impacta
 * el arma. Las demás son modificadores y se ignoran.
 */
const ESTRUCTURALES = ['Directo', 'Errática'];
const SIN_MODIFICADORES = (ab: readonly WeaponAbility[]): readonly WeaponAbility[] =>
  ab.filter((a) => ESTRUCTURALES.includes(a.nombre));

/** Crítico por defecto: un 6 natural. Brutal X+ lo rebaja. */
const CRIT_BASE = 6;
/** En cuerpo a cuerpo no hay Precisión: 1 y 2 fallan, 3+ impacta. */
const MELEE_HIT = 3;
/** Con el objetivo en cobertura, el atacante en CaC falla también con 3. */
const MELEE_HIT_COVER = 4;

export const hasAbility = (ab: readonly WeaponAbility[], nombre: string): boolean =>
  ab.some((a) => a.nombre === nombre);

export const getAbility = (
  ab: readonly WeaponAbility[],
  nombre: string,
): WeaponAbility | undefined => ab.find((a) => a.nombre === nombre);

export const hasClassAdvantage = (atacante: UnitClass, objetivo: UnitClass): boolean =>
  CLASS_ADVANTAGE[atacante].includes(objetivo);

/**
 * Efectos que vienen de fuera del arma (habilidades de unidad, equipamiento).
 * El motor los calcula y los pasa aquí para que la resolución siga siendo una
 * función pura del arma, los perfiles y este contexto.
 */
export interface AttackContext {
  /**
   * Aplicar las habilidades de arma que modifican la resolución (Brutal,
   * Perforante, Anti-X, Inestable, Explosiva). Por defecto sí. Directo y
   * Errática quedan siempre fuera del interruptor: no son modificadores, son
   * la forma en que esas armas impactan, y sin ellas no funcionarían.
   */
  readonly habilidadesArma?: boolean | undefined;
  /** Distancia de peana a peana en pulgadas. */
  readonly distancia: number;
  /** El objetivo se beneficia de cobertura. */
  readonly enCobertura: boolean;
  /** Dados de ataque adicionales (Emplazado, Carga brutal). */
  readonly dadosExtra?: number;
  /** Mejora de Precisión: resta al umbral (Certero). */
  readonly precisionMejorada?: number;
  /** Repetir tiradas de Precisión fallidas (Tirador, Munición certera). */
  readonly repetirFallos?: boolean;
  /** El defensor tiene Berserker: el atacante falla también con 3 en CaC. */
  readonly defensorBerserker?: boolean;
}

export interface AttackResult {
  readonly dadosAtaque: readonly number[];
  readonly dadosRepetidos: readonly number[];
  readonly numeroDeAtaques: number;
  readonly impactos: number;
  readonly criticos: number;
  readonly dadosSalvacion: readonly number[];
  readonly impactosBloqueados: number;
  readonly danioBase: number;
  readonly danioCritico: number;
  readonly bonusAntiX: number;
  readonly bonusVentajaClase: number;
  readonly danioTotal: number;
  /** Daño que se inflige el propio atacante por Inestable. */
  readonly danioRetroceso: number;
  /** Miniaturas adicionales que puede elegir el atacante por Explosiva X. */
  readonly explosivaObjetivos: number;
  readonly umbralImpacto: number | null;
  readonly umbralSalvacion: number;
  /** Salvación impresa en la ficha, antes de modificadores. */
  readonly salvacionBase: number;
  /** El defensor se beneficiaba de cobertura en este ataque. */
  readonly enCobertura: boolean;
  readonly umbralCritico: number;
  readonly notas: readonly string[];
}

/**
 * Tope de los umbrales de D6. El reglamento fija el máximo en 6+ tanto para
 * Salvación como para Precisión: nunca se puede necesitar más de un 6.
 */
const capThreshold = (v: number): number => Math.min(6, Math.max(1, v));

/** Anti-X: +1D3 de daño contra la clase indicada, si el ataque hizo daño. */
function bonusAnti(
  rng: Rng,
  ab: readonly WeaponAbility[],
  objetivo: UnitClass,
  hizoDanio: boolean,
  notas: string[],
): number {
  if (!hizoDanio) return 0;
  const anti = ab.find((a) => a.nombre === 'Anti-X' && a.objetivo === objetivo);
  if (!anti) return 0;
  const extra = rng.d3();
  notas.push(`Anti-${objetivo}: +${extra} de daño extra (1D3)`);
  return extra;
}

/** Ventaja de clase: +1 al daño total final si el ataque infligió daño. */
function bonusVentaja(
  atacante: UnitProfile,
  objetivo: UnitProfile,
  hizoDanio: boolean,
  notas: string[],
): number {
  if (!hizoDanio || !hasClassAdvantage(atacante.clase, objetivo.clase)) return 0;
  notas.push(`Ventaja de clase de ${atacante.clase} sobre ${objetivo.clase}: +1 al daño total`);
  return 1;
}

/** Inestable: 1D6 tras el ataque; con 1 o 2 el portador sufre el mismo daño. */
function retrocesoInestable(
  rng: Rng,
  ab: readonly WeaponAbility[],
  danioInfligido: number,
  notas: string[],
): number {
  if (!hasAbility(ab, 'Inestable') || danioInfligido <= 0) return 0;
  const d = rng.d6();
  if (d > 2) {
    notas.push(`Inestable: 1D6=${d}, sin retroceso`);
    return 0;
  }
  notas.push(`Inestable: 1D6=${d}, el portador sufre los mismos ${danioInfligido} de daño`);
  return danioInfligido;
}

/** Secuencia de ataque a distancia del reglamento. */
export function resolveRangedAttack(
  rng: Rng,
  weapon: RangedWeapon,
  attacker: UnitProfile,
  target: UnitProfile,
  ctx: AttackContext,
): AttackResult {
  const notas: string[] = [];
  const conHabilidades = ctx.habilidadesArma ?? true;
  const ab = conHabilidades ? weapon.habilidades : SIN_MODIFICADORES(weapon.habilidades);

  // --- Paso 2: número de dados de ataque ---
  let numeroDeAtaques = resolverCantidad(rng, weapon.ataques) + (ctx.dadosExtra ?? 0);
  if (typeof weapon.ataques !== 'number') {
    notas.push(`Ataques variables: se tiran ${numeroDeAtaques} dados`);
  }
  if (ctx.dadosExtra) notas.push(`+${ctx.dadosExtra} dado(s) de ataque por habilidad de unidad`);

  // --- Precisión ---
  const directo = hasAbility(ab, 'Directo');
  let umbralImpacto: number | null = weapon.precision;

  if (directo) {
    umbralImpacto = null;
    notas.push('Directo: impacta sin tirada de Precisión');
  } else if (hasAbility(ab, 'Errática')) {
    const d = rng.d6();
    umbralImpacto = capThreshold(d);
    notas.push(`Errática: la Precisión de este ataque es ${umbralImpacto}+ (1D6=${d})`);
  } else if (umbralImpacto !== null) {
    if (ctx.precisionMejorada) {
      umbralImpacto -= ctx.precisionMejorada;
      notas.push(`Precisión mejorada en ${ctx.precisionMejorada} por habilidad de unidad`);
    }
    umbralImpacto = capThreshold(umbralImpacto);
  }

  // --- Crítico: Brutal X+ lo rebaja ---
  let umbralCritico = CRIT_BASE;
  const brutal = getAbility(ab, 'Brutal X+');
  if (brutal?.x !== undefined) {
    umbralCritico = capThreshold(brutal.x);
    notas.push(`Brutal ${umbralCritico}+: crítico con ${umbralCritico} o más`);
  }

  // --- Paso 3: tirada de precisión ---
  let dados: number[] = [];
  let repetidos: number[] = [];
  let impactos = 0;
  let criticos = 0;

  if (umbralImpacto === null) {
    // Directo: todos los dados impactan; el crítico sigue siendo posible si
    // el arma tiene Brutal, pero sin tirada no hay resultado natural.
    impactos = numeroDeAtaques;
  } else {
    dados = rng.roll(numeroDeAtaques);
    if (ctx.repetirFallos) {
      const fallidos = dados.filter((d) => d < umbralImpacto!).length;
      repetidos = rng.roll(fallidos);
      notas.push(`Se repiten ${fallidos} tiradas fallidas de Precisión`);
    }
    const finales = [
      ...dados.filter((d) => d >= umbralImpacto),
      ...repetidos.filter((d) => d >= umbralImpacto),
    ];
    for (const d of finales) {
      // Un 6 natural siempre impacta, y es crítico salvo regla en contra.
      if (d >= umbralCritico) criticos++;
      else impactos++;
    }
  }

  // --- Paso 4: salvaciones ---
  let umbralSalvacion = target.salvacion;
  if (ctx.enCobertura) {
    umbralSalvacion -= 1;
    notas.push('Cobertura: Salvación mejorada en 1');
  }
  if (hasAbility(ab, 'Perforante')) {
    umbralSalvacion += 1;
    notas.push('Perforante: Salvación empeorada en 1');
  }
  umbralSalvacion = capThreshold(umbralSalvacion);

  const dadosSalvacion = rng.roll(impactos + criticos);
  let bloqueadosNormales = 0;
  let bloqueadosCriticos = 0;
  dadosSalvacion.forEach((d, i) => {
    // Un 1 natural siempre falla la salvación.
    if (d === 1 || d < umbralSalvacion) return;
    if (i < impactos) bloqueadosNormales++;
    else bloqueadosCriticos++;
  });

  // --- Paso 5: daño ---
  const danioBase = (impactos - bloqueadosNormales) * weapon.danio;
  const danioCrit = (criticos - bloqueadosCriticos) * weapon.danioCritico;
  const bruto = danioBase + danioCrit;

  const anti = bonusAnti(rng, ab, target.clase, bruto > 0, notas);
  const ventaja = bonusVentaja(attacker, target, bruto > 0, notas);
  const danioTotal = bruto + anti + ventaja;
  const retroceso = retrocesoInestable(rng, ab, danioTotal, notas);

  const explosiva = getAbility(ab, 'Explosiva X');
  const explosivaObjetivos = explosiva?.x !== undefined && danioTotal > 0 ? explosiva.x : 0;
  if (explosivaObjetivos > 0) {
    notas.push(`Explosiva ${explosivaObjetivos}: hasta ${explosivaObjetivos} miniatura(s) más a 3" sufren ${danioTotal}`);
  }

  return {
    dadosAtaque: dados,
    dadosRepetidos: repetidos,
    numeroDeAtaques,
    impactos,
    criticos,
    dadosSalvacion,
    impactosBloqueados: bloqueadosNormales + bloqueadosCriticos,
    danioBase,
    danioCritico: danioCrit,
    bonusAntiX: anti,
    bonusVentajaClase: ventaja,
    danioTotal,
    danioRetroceso: retroceso,
    explosivaObjetivos,
    umbralImpacto,
    umbralSalvacion,
    salvacionBase: target.salvacion,
    enCobertura: ctx.enCobertura,
    umbralCritico,
    notas,
  };
}

/** Resolución de cuerpo a cuerpo: 1 y 2 fallan, 6 es crítico. */
export function resolveMeleeAttack(
  rng: Rng,
  weapon: MeleeWeapon,
  attacker: UnitProfile,
  target: UnitProfile,
  ctx: AttackContext,
): AttackResult {
  const notas: string[] = [];
  const conHabilidades = ctx.habilidadesArma ?? true;
  const ab = conHabilidades ? weapon.habilidades : SIN_MODIFICADORES(weapon.habilidades);

  let umbralImpacto = MELEE_HIT;
  if (ctx.enCobertura) {
    umbralImpacto = MELEE_HIT_COVER;
    notas.push('Objetivo en cobertura: el atacante falla con 1, 2 y 3');
  }
  if (ctx.defensorBerserker) {
    umbralImpacto = Math.max(umbralImpacto, MELEE_HIT_COVER);
    notas.push('Berserker del defensor: el atacante falla con 1, 2 y 3');
  }

  let umbralCritico = CRIT_BASE;
  const brutal = getAbility(ab, 'Brutal X+');
  if (brutal?.x !== undefined) {
    umbralCritico = capThreshold(brutal.x);
    notas.push(`Brutal ${umbralCritico}+: crítico con ${umbralCritico} o más`);
  }

  const numeroDeAtaques = resolverCantidad(rng, weapon.ataques) + (ctx.dadosExtra ?? 0);
  if (typeof weapon.ataques !== 'number') {
    notas.push(`Ataques variables: se tiran ${numeroDeAtaques} dados`);
  }
  if (ctx.dadosExtra) notas.push(`+${ctx.dadosExtra} dado(s) de ataque por habilidad de unidad`);

  const dados = rng.roll(numeroDeAtaques);
  let repetidos: number[] = [];
  if (ctx.repetirFallos) {
    const fallidos = dados.filter((d) => d < umbralImpacto).length;
    repetidos = rng.roll(fallidos);
  }

  let impactos = 0;
  let criticos = 0;
  for (const d of [...dados, ...repetidos]) {
    if (d < umbralImpacto) continue;
    if (d >= umbralCritico) criticos++;
    else impactos++;
  }

  let umbralSalvacion = target.salvacion;
  if (hasAbility(ab, 'Perforante')) {
    umbralSalvacion += 1;
    notas.push('Perforante: Salvación empeorada en 1');
  }
  umbralSalvacion = capThreshold(umbralSalvacion);

  const dadosSalvacion = rng.roll(impactos + criticos);
  let bloqueadosNormales = 0;
  let bloqueadosCriticos = 0;
  dadosSalvacion.forEach((d, i) => {
    if (d === 1 || d < umbralSalvacion) return;
    if (i < impactos) bloqueadosNormales++;
    else bloqueadosCriticos++;
  });

  const danioBase = (impactos - bloqueadosNormales) * weapon.danio;
  const danioCrit = (criticos - bloqueadosCriticos) * weapon.danioCritico;
  const bruto = danioBase + danioCrit;

  const anti = bonusAnti(rng, ab, target.clase, bruto > 0, notas);
  const ventaja = bonusVentaja(attacker, target, bruto > 0, notas);
  const danioTotal = bruto + anti + ventaja;
  const retroceso = retrocesoInestable(rng, ab, danioTotal, notas);

  const explosiva = getAbility(ab, 'Explosiva X');
  const explosivaObjetivos = explosiva?.x !== undefined && danioTotal > 0 ? explosiva.x : 0;

  return {
    dadosAtaque: dados,
    dadosRepetidos: repetidos,
    numeroDeAtaques,
    impactos,
    criticos,
    dadosSalvacion,
    impactosBloqueados: bloqueadosNormales + bloqueadosCriticos,
    danioBase,
    danioCritico: danioCrit,
    bonusAntiX: anti,
    bonusVentajaClase: ventaja,
    danioTotal,
    danioRetroceso: retroceso,
    explosivaObjetivos,
    umbralImpacto,
    umbralSalvacion,
    salvacionBase: target.salvacion,
    enCobertura: ctx.enCobertura,
    umbralCritico,
    notas,
  };
}

/** Ángulo muerto: el arma no puede disparar por debajo de la mitad de su rango. */
export function anguloMuertoBloquea(weapon: RangedWeapon, distancia: number): boolean {
  return hasAbility(weapon.habilidades, 'Angulo Muerto') && distancia < weapon.distancia / 2;
}
