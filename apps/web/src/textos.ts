import type { ActionKind, HabilidadArma } from '@zerolore/core';

/**
 * Los textos de reglas que se enseñan al pasar el ratón. Salen del reglamento
 * y de la tabla de unidades de Notion, resumidos para caber en una línea.
 */
export const HABILIDAD_UNIDAD: Record<string, string> = {
  Alimañas: 'No tiene habilidad especial.',
  Atrincherado: 'En cobertura, mejora en 1 la Precisión de sus disparos.',
  'Carga brutal': 'Al cargar, +1 dado en el ataque gratuito.',
  Resistente: 'La primera vez cada turno que recibe daño, lo reduce en 1D3.',
  Berserker: 'Quien le ataque en CaC falla con 1, 2 y 3.',
  Avanzadilla: 'Puede desplegarse a 9" de un puesto propio.',
  Brinco: 'Sube obstáculos en diagonal al moverse.',
  Anclado: 'Quien esté trabado con ella no puede destrabarse.',
  Transporte: 'Una unidad aliada puede desplegarse pegada a este vehículo.',
  'Fuego de apoyo': 'Puede disparar aunque esté trabado.',
  'Fuego indirecto': 'Dispara sin línea de visión si el objetivo no está en cobertura. No se mueve.',
  Emplazado: 'Si no se ha movido en la activación, +1 dado al disparar.',
  Regeneración: 'Si muere, vuelve a la Reserva con todas sus Vidas.',
  'Poder mental': 'Ignora la cobertura. Puede disparar sin visión arriesgándose a 1D3 de daño.',
  Superioridad: 'Solo otro Titán puede cargarle y trabarle.',
  Refuerzos: 'En el despliegue recibe una miniatura más del tipo que comanda.',
};

export const HABILIDAD_ARMA: Record<HabilidadArma, string> = {
  Fiable: 'Sin reglas especiales.',
  Brutal: 'Crítico con 5+.',
  Perforante: 'Empeora en 1 la Salvación del objetivo.',
  'Golpe crítico': 'Los críticos no se pueden salvar.',
  Directo: 'Todos los dados impactan sin tirar Precisión.',
  Implacable: 'Repite los dados de ataque que fallen.',
  Explosiva: 'Las miniaturas enemigas a 3" de la impactada sufren el daño base sin salvación.',
  'Disparo certero': 'A la mitad del alcance o menos, +1 dado.',
};

export const NOMBRE_ACCION: Record<ActionKind, string> = {
  Mover: 'Mover',
  Correr: 'Correr',
  Disparar: 'Disparar',
  Cargar: 'Cargar',
  AtacarCaC: 'Atacar',
  Destrabarse: 'Destrabarse',
};

/** Iconos de la rueda, en trazos de 24×24. */
export const ICONO_ACCION: Record<ActionKind | 'Terminar', string> = {
  Mover: 'M5 12h11M12 6l6 6-6 6',
  Correr: 'M3 12h7M7 6l6 6-6 6M12 12h7M16 6l6 6-6 6',
  Disparar: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  Cargar: 'M4 20l8-8M12 12l3-9 6 6-9 3M14 6l4 4',
  AtacarCaC: 'M5 19L19 5M15 5h4v4M5 5l14 14M5 15v4h4',
  Destrabarse: 'M9 15l-4 4M15 9l4-4M7 7l4 4M13 13l4 4M4 12a8 8 0 0 1 8-8M20 12a8 8 0 0 1-8 8',
  Terminar: 'M5 12l5 5L20 7',
};
