import {
  parseCantidad,
  type Cantidad,
  type MeleeWeapon,
  type RangedWeapon,
  type UnitAbility,
  type UnitClass,
  type UnitProfile,
  type Weapon,
  type WeaponAbility,
  type WeaponSet,
} from '@zerolore/core';

/**
 * Convierte la instantánea de Notion (data/notion/*.json) en perfiles que el
 * motor puede usar. Cualquier valor que no encaje se reporta como incidencia
 * en lugar de sustituirse en silencio por un valor por defecto.
 */

export interface SyncIssue {
  readonly donde: string;
  readonly campo: string;
  readonly valor: string;
  readonly problema: string;
}

export interface SyncReport {
  readonly profiles: readonly UnitProfile[];
  readonly issues: readonly SyncIssue[];
}

const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const CLASES: Record<string, UnitClass> = {
  choque: 'Choque',
  elite: 'Elite',
  especialista: 'Especialista',
  especialistas: 'Especialista',
  comando: 'Comando',
  asaltante: 'Asaltante',
  armaspesadas: 'ArmasPesadas',
  'armas pesadas': 'ArmasPesadas',
  monstruo: 'Monstruo',
  monstruos: 'Monstruo',
  vehiculo: 'Vehiculo',
  vehiculos: 'Vehiculo',
  artilleria: 'Artilleria',
  heroe: 'Heroe',
  linea: 'Choque',
};

const SETS: Record<string, WeaponSet> = {
  equilibrado: 'Equilibrado',
  equilibrada: 'Equilibrado',
  disparo: 'Disparo',
  asalto: 'Asalto',
};

/** '5"' -> 5 ; '+2"' -> 2 ; '-' -> null */
function pulgadas(raw: string): number | null {
  const t = raw.replace(/[”"\s+]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** '4+' -> 4 ; '-' -> null ; '1D6' -> null (lo resuelve Errática) */
function umbral(raw: string): number | null {
  const t = raw.replace(/[+\s]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** '2 / 3' -> [2, 3] */
function danios(raw: string): [number, number] | null {
  const partes = raw.split('/').map((p) => Number(p.trim()));
  if (partes.length !== 2 || partes.some((n) => !Number.isFinite(n))) return null;
  return [partes[0]!, partes[1]!];
}

/**
 * 'nD' significa n dados fijos; '1D6', '1D3+2' son tiradas para saber cuántos
 * dados se lanzan. La distinción viene de la Guía de Armas del reglamento.
 */
export function parseAtaques(raw: string): Cantidad | null {
  const t = raw.trim();
  const fijos = /^(\d+)[Dd]$/.exec(t);
  if (fijos) return Number(fijos[1]);
  return parseCantidad(t);
}

/**
 * 'Brutal 5+' -> { nombre: 'Brutal X+', x: 5 }
 * 'Explosiva 2' -> { nombre: 'Explosiva X', x: 2 }
 * 'Anti-Vehículo' -> { nombre: 'Anti-X', objetivo: 'Vehiculo' }
 */
export function parseHabilidadArma(raw: string): WeaponAbility | null {
  const t = raw.trim();
  if (t === '' || t === '-') return null;

  const brutal = /^Brutal\s*(\d)\+?$/i.exec(t);
  if (brutal) return { nombre: 'Brutal X+', x: Number(brutal[1]) };

  const explosiva = /^Explosiva\s*\(?(\d)\)?$/i.exec(t);
  if (explosiva) return { nombre: 'Explosiva X', x: Number(explosiva[1]) };

  const anti = /^Anti\s*-\s*(.+)$/i.exec(t);
  if (anti) {
    const clase = CLASES[fold(anti[1]!)];
    return clase ? { nombre: 'Anti-X', objetivo: clase } : { nombre: 'Anti-X' };
  }

  // Nombres canónicos del reglamento, tolerando tildes y mayúsculas.
  const CANON: Record<string, string> = {
    fiable: 'Fiable',
    'angulo muerto': 'Angulo Muerto',
    perforante: 'Perforante',
    inestable: 'Inestable',
    multiuso: 'Multiuso',
    directo: 'Directo',
    parabolica: 'Parabólica',
    alcance: 'Alcance',
    erratica: 'Errática',
    barrido: 'Barrido',
  };
  const canon = CANON[fold(t)];
  return canon ? { nombre: canon } : { nombre: t };
}

const listaHabilidades = (raw: string | string[]): WeaponAbility[] => {
  const partes = Array.isArray(raw) ? raw : raw.split(',');
  return partes.map((h) => parseHabilidadArma(String(h))).filter((h): h is WeaponAbility => h !== null);
};

/** Radios de peana en pulgadas, del cuadro de tamaños recomendados. */
const RADIO: Record<UnitClass, number> = {
  Choque: 0.63,        // 32 mm
  Elite: 0.63,
  Especialista: 0.63,
  Comando: 0.63,
  Asaltante: 0.63,
  ArmasPesadas: 0.79,  // 40 mm
  Heroe: 0.63,
  Monstruo: 1.1,       // 56 mm
  Vehiculo: 1.57,      // 80 mm
  Artilleria: 1.1,
};

interface RawUnidad {
  clase: string; set: string; movimiento: string; vidas: number;
  velocidad: string; salvacion: string; escuadra_min: number;
  escuadra_max: number; habilidad: string; valor: number;
}
interface RawHeroe {
  id: string; rol: string; movimiento: string; vidas: number;
  velocidad: string; salvacion: string; valor: number; habilidad: string;
}
interface RawArmasUnidad {
  clase: string; set: string; rol: string;
  cac: { ataques: string; danio: string; habilidad: string };
  distancia: { ataques: string; alcance: string; precision: string; danio: string; habilidad: string };
}
interface RawHabilidadUnidad {
  clase: string; set: string; nombre: string; descripcion: string;
}

export function buildProfiles(raw: {
  unidades: RawUnidad[];
  heroes: RawHeroe[];
  armasUnidad: RawArmasUnidad[];
  habilidadesUnidad: RawHabilidadUnidad[];
}): SyncReport {
  const issues: SyncIssue[] = [];
  const profiles: UnitProfile[] = [];

  const armasPorClave = new Map<string, RawArmasUnidad>();
  for (const a of raw.armasUnidad) armasPorClave.set(`${fold(a.clase)}|${fold(a.set)}`, a);

  const habPorClave = new Map<string, RawHabilidadUnidad>();
  for (const h of raw.habilidadesUnidad) habPorClave.set(`${fold(h.clase)}|${fold(h.set)}`, h);

  const construirArmas = (
    donde: string,
    a: RawArmasUnidad | undefined,
  ): Weapon[] => {
    if (!a) {
      issues.push({ donde, campo: 'armas', valor: '', problema: 'Sin fila de armas en la tabla' });
      return [];
    }
    const armas: Weapon[] = [];

    const cacAtaques = parseAtaques(a.cac.ataques);
    const cacDanio = danios(a.cac.danio);
    if (cacAtaques === null) {
      issues.push({ donde, campo: 'cac.ataques', valor: a.cac.ataques, problema: 'Formato de ataques no reconocido' });
    } else if (cacDanio === null) {
      issues.push({ donde, campo: 'cac.danio', valor: a.cac.danio, problema: 'Formato daño/crítico no reconocido' });
    } else {
      const melee: MeleeWeapon = {
        kind: 'cuerpo_a_cuerpo',
        // La tabla de unidades no da nombre de arma: solo el rol de la unidad
        // y las cifras. Se nombra por su tipo hasta enlazarla con la base de
        // armas, que sí tiene nombres propios (Espada, Maza, Fusil…).
        nombre: 'Cuerpo a cuerpo',
        ataques: cacAtaques,
        danio: cacDanio[0],
        danioCritico: cacDanio[1],
        habilidades: listaHabilidades(a.cac.habilidad),
      };
      armas.push(melee);
    }

    const dAtaques = parseAtaques(a.distancia.ataques);
    const dDanio = danios(a.distancia.danio);
    const alcance = pulgadas(a.distancia.alcance);
    if (dAtaques === null) {
      issues.push({ donde, campo: 'distancia.ataques', valor: a.distancia.ataques, problema: 'Formato de ataques no reconocido' });
    } else if (dDanio === null) {
      issues.push({ donde, campo: 'distancia.danio', valor: a.distancia.danio, problema: 'Formato daño/crítico no reconocido' });
    } else if (alcance === null) {
      issues.push({ donde, campo: 'distancia.alcance', valor: a.distancia.alcance, problema: 'Alcance no numérico' });
    } else {
      const habs = listaHabilidades(a.distancia.habilidad);
      const prec = umbral(a.distancia.precision);
      // Precisión '-' o '1D6' es correcta si el arma es Directo o Errática.
      if (prec === null && !habs.some((h) => h.nombre === 'Directo' || h.nombre === 'Errática')) {
        issues.push({
          donde, campo: 'distancia.precision', valor: a.distancia.precision,
          problema: 'Sin Precisión y el arma no tiene Directo ni Errática',
        });
      }
      const ranged: RangedWeapon = {
        kind: 'disparo',
        nombre: 'A distancia',
        ataques: dAtaques,
        distancia: alcance,
        precision: prec,
        danio: dDanio[0],
        danioCritico: dDanio[1],
        habilidades: habs,
      };
      armas.push(ranged);
    }
    return armas;
  };

  for (const u of raw.unidades) {
    const clase = CLASES[fold(u.clase)];
    const set = SETS[fold(u.set)];
    const donde = `${u.clase} ${u.set}`;
    if (!clase) {
      issues.push({ donde, campo: 'clase', valor: u.clase, problema: 'Clase desconocida' });
      continue;
    }
    if (!set) {
      issues.push({ donde, campo: 'set', valor: u.set, problema: 'Set desconocido' });
      continue;
    }

    const mov = pulgadas(u.movimiento);
    const vel = pulgadas(u.velocidad);
    const salv = umbral(u.salvacion);
    if (mov === null && clase !== 'Artilleria') {
      issues.push({ donde, campo: 'movimiento', valor: u.movimiento, problema: 'No numérico y no es Artillería' });
    }
    if (salv === null) {
      issues.push({ donde, campo: 'salvacion', valor: u.salvacion, problema: 'No numérica' });
    }

    const habRaw = habPorClave.get(`${fold(u.clase)}|${fold(u.set)}`);
    const habilidad: UnitAbility | null = habRaw
      ? { nombre: habRaw.nombre, descripcion: habRaw.descripcion }
      : null;
    if (!habRaw) {
      issues.push({ donde, campo: 'habilidad', valor: u.habilidad, problema: 'Sin descripción en la tabla de habilidades de unidad' });
    }

    profiles.push({
      id: `${fold(u.clase)}_${fold(u.set)}`,
      nombre: `${clase} ${set}`,
      rol: armasPorClave.get(`${fold(u.clase)}|${fold(u.set)}`)?.rol ?? null,
      clase,
      set,
      movimiento: mov ?? 0,
      vidas: u.vidas,
      salvacion: salv ?? 6,
      velocidad: vel ?? 0,
      escuadraMin: u.escuadra_min,
      escuadraMax: u.escuadra_max,
      valor: u.valor,
      habilidad,
      armas: construirArmas(donde, armasPorClave.get(`${fold(u.clase)}|${fold(u.set)}`)),
      radioPeana: RADIO[clase],
    });
  }

  for (const h of raw.heroes) {
    const donde = `${h.id} (${h.rol})`;
    const mov = pulgadas(h.movimiento);
    const vel = pulgadas(h.velocidad);
    const salv = umbral(h.salvacion);
    profiles.push({
      id: `heroe_${fold(h.id).replace(/\s+/g, '')}`,
      nombre: h.rol,
      rol: h.rol,
      clase: 'Heroe',
      set: null,
      movimiento: mov ?? 0,
      vidas: h.vidas,
      salvacion: salv ?? 6,
      velocidad: vel ?? 0,
      escuadraMin: 1,
      escuadraMax: 1,
      valor: h.valor,
      habilidad: { nombre: h.rol, descripcion: h.habilidad },
      armas: construirArmas(donde, armasPorClave.get(`${fold(h.id)}|${fold('-')}`)),
      radioPeana: RADIO.Heroe,
    });
  }

  return { profiles, issues };
}
