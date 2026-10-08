import type { WeaponAbility } from '@zerolore/core';

/**
 * Nombre visible y regla de cada habilidad de arma. La ficha enseña solo el
 * nombre para no cargarla de texto; la regla sale al pasar el ratón por encima,
 * que es cuando hace falta.
 *
 * Los textos resumen el reglamento de Notion. Si una regla cambia allí, se
 * cambia aquí: el motor no lee estos textos, solo la interfaz.
 */
const REGLAS: Record<string, (h: WeaponAbility) => string> = {
  'Fiable': () => 'Sin reglas especiales.',
  'Angulo Muerto': () => 'No puede disparar a objetivos por debajo de la mitad de su alcance.',
  'Brutal X+': (h) => `Sus impactos son críticos con un resultado natural de ${h.x ?? 'X'} o más.`,
  'Perforante': () => 'Empeora en 1 la Salvación del objetivo.',
  'Inestable': () => 'Tras atacar se tira 1D6: con 1 o 2, el portador sufre el mismo daño que hizo.',
  'Multiuso': () => 'Puede disparar aunque la unidad esté trabada en cuerpo a cuerpo.',
  'Directo': () => 'Impacta siempre, sin tirada de Precisión.',
  'Explosiva X': (h) =>
    `Si hace daño, hasta ${h.x ?? 'X'} miniatura(s) enemiga(s) a 3" del objetivo sufren el mismo daño, sin salvación.`,
  'Parabólica': () => 'Puede disparar sin línea de visión, siempre que el objetivo esté a su alcance.',
  'Alcance': () => 'Arma de cuerpo a cuerpo que golpea a cualquier enemigo a 3", trabado o no.',
  'Errática': () => 'Antes de atacar se tira 1D6: ese resultado es su Precisión en este ataque.',
  'Barrido': () => 'Ataca a todos los enemigos trabados con ella, uno por uno.',
  'Anti-X': (h) => `+1D3 de daño contra ${h.objetivo ?? 'esa clase'}, si el ataque hace daño.`,
};

export function nombreHabilidad(h: WeaponAbility): string {
  if (h.nombre === 'Brutal X+' && h.x !== undefined) return `Brutal ${h.x}+`;
  if (h.nombre === 'Explosiva X' && h.x !== undefined) return `Explosiva ${h.x}`;
  if (h.nombre === 'Anti-X') return h.objetivo ? `Anti-${h.objetivo}` : 'Anti-X';
  if (h.nombre === 'Angulo Muerto') return 'Ángulo muerto';
  return h.nombre;
}

export function reglaHabilidad(h: WeaponAbility): string {
  return REGLAS[h.nombre]?.(h) ?? 'Habilidad sin descripción.';
}
