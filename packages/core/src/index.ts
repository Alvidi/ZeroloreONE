export { Rng } from './rng.ts';
export * from './geometry.ts';
export * from './types.ts';
export { Engine, type Command } from './engine.ts';
export type { GameEvent, CommandResult, RuleViolation } from './events.ts';
export {
  resolveRangedAttack,
  resolveMeleeAttack,
  hasClassAdvantage,
  hasAbility,
  getAbility,
  anguloMuertoBloquea,
  type AttackContext,
  type AttackResult,
} from './rules/combat.ts';
export * from './dados.ts';
export { lineOfSight, hasCover, coberturasDeTiro, type LosResult } from './rules/los.ts';
export { poligonoDeVision, puntoEnPoligono } from './rules/vision.ts';
export * from './rules/puestos.ts';
export { caminoMasCorto, recortarCamino, type Camino } from './rules/camino.ts';
export { preverAtaque, type Prevision, type PrevisionCtx } from './rules/prevision.ts';
