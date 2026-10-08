import { parseCantidad } from './dados.ts';
import type { ArmaCaC, ArmaDisparo, HabilidadArma, TipoUnidad, Ventaja } from './types.ts';

/**
 * Lee el catálogo de unidades que publica la web y lo convierte en perfiles
 * con números. La web escribe `5"`, `+2"`, `4+`, `2D`, `1 / 2`; aquí todo eso
 * se queda en pulgadas, umbrales y cantidades de dados.
 *
 * Si algo no se entiende, se lanza un error con el id de la unidad: es mejor
 * enterarse al arrancar que a mitad de partida.
 */

const MM = 25.4;

/**
 * Peana recomendada por tipo, en milímetros de diámetro. Sale de la tabla del
 * reglamento, tomando un valor central de cada rango.
 */
const PEANA_MM: Record<string, number> = {
  milicia: 28,
  tirador: 28,
  choque: 28,
  explorador: 28,
  psiquico: 28,
  asaltante: 36,
  juggernaut: 45,
  exterminador: 45,
  demonio: 45,
  'armas-pesadas': 45,
  monstruo: 80,
  'vehiculo-ligero': 64,
  'vehiculo-pesado': 120,
  artilleria: 120,
  titan: 150,
};
const PEANA_COMANDANTE_MM = 36;

/** Alturas aproximadas: solo sirven para decidir si un murete cubre. */
const ALTURA: Record<string, number> = {
  juggernaut: 1.9,
  exterminador: 1.9,
  demonio: 1.9,
  'armas-pesadas': 1.7,
  monstruo: 3.5,
  'vehiculo-ligero': 2.2,
  'vehiculo-pesado': 3,
  artilleria: 2.5,
  titan: 6,
};
const ALTURA_INFANTERIA = 1.3;

const HABILIDADES_ARMA: readonly HabilidadArma[] = [
  'Fiable', 'Brutal', 'Perforante', 'Golpe crítico', 'Directo', 'Implacable', 'Explosiva', 'Disparo certero',
];

interface ArmaJson {
  ataques?: unknown;
  distancia?: unknown;
  precision?: unknown;
  danio?: unknown;
  danio_critico?: unknown;
  habilidades_arma?: unknown;
}

interface UnidadJson {
  id?: unknown;
  nombre?: unknown;
  descripcion?: unknown;
  perfil?: Record<string, unknown>;
  habilidad?: unknown;
  fuerte_contra?: unknown;
  armas?: { disparo?: ArmaJson | null; cuerpo_a_cuerpo?: ArmaJson | null };
}

/** `5"` → 5, `+2"` → 2, `—` → null. */
function pulgadas(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return null;
  const m = /^\s*\+?(\d+(?:[.,]\d+)?)\s*["”″]?\s*$/.exec(raw);
  return m ? Number(m[1]!.replace(',', '.')) : null;
}

/** `4+` → 4, `—` → null. */
function umbral(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return null;
  const m = /^\s*(\d)\s*\+\s*$/.exec(raw);
  return m ? Number(m[1]) : null;
}

function numero(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) return Number(raw);
  return null;
}

/** Normaliza para comparar nombres: "Vehículo ligero" y "vehiculo-ligero" son lo mismo. */
export function claveTipo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
}

function habilidades(id: string, raw: unknown): HabilidadArma[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((h) => {
    const encontrada = HABILIDADES_ARMA.find((x) => claveTipo(x) === claveTipo(String(h)));
    if (!encontrada) throw new Error(`${id}: habilidad de arma desconocida "${String(h)}"`);
    return encontrada;
  });
}

function armaDisparo(id: string, a: ArmaJson | null | undefined): ArmaDisparo | null {
  if (!a) return null;
  const ataques = parseCantidad(a.ataques);
  const distancia = pulgadas(a.distancia);
  const danio = numero(a.danio);
  const critico = numero(a.danio_critico);
  if (ataques === null || distancia === null || danio === null || critico === null) {
    throw new Error(`${id}: arma a distancia ilegible ${JSON.stringify(a)}`);
  }
  const habs = habilidades(id, a.habilidades_arma);
  const precision = umbral(a.precision);
  if (precision === null && !habs.includes('Directo')) {
    throw new Error(`${id}: arma a distancia sin Precisión y sin Directo`);
  }
  return { kind: 'disparo', ataques, distancia, precision, danio, danioCritico: critico, habilidades: habs };
}

function armaCaC(id: string, a: ArmaJson | null | undefined): ArmaCaC | null {
  if (!a) return null;
  const ataques = parseCantidad(a.ataques);
  const danio = numero(a.danio);
  const critico = numero(a.danio_critico);
  if (ataques === null || danio === null || critico === null) {
    throw new Error(`${id}: arma de cuerpo a cuerpo ilegible ${JSON.stringify(a)}`);
  }
  return { kind: 'cac', ataques, danio, danioCritico: critico, habilidades: habilidades(id, a.habilidades_arma) };
}

/** Convierte el JSON del catálogo en tipos de unidad, indexados por id. */
export function leerCatalogo(json: unknown): Record<string, TipoUnidad> {
  const lista = (json as { unidades?: unknown })?.unidades;
  if (!Array.isArray(lista)) throw new Error('El catálogo no tiene la lista "unidades"');

  const crudas = lista as UnidadJson[];
  // Las ventajas vienen por nombre ("Vehículo ligero"); se traducen a id.
  const idPorNombre = new Map<string, string>();
  for (const u of crudas) idPorNombre.set(claveTipo(String(u.nombre)), String(u.id));

  const tipos: Record<string, TipoUnidad> = {};
  for (const u of crudas) {
    const id = String(u.id);
    const p = u.perfil ?? {};
    const esComandante = id.startsWith('comandante');

    const vidas = numero(p.vidas);
    const salvacion = umbral(p.salvacion);
    const valor = numero(p.valor);
    if (vidas === null || salvacion === null || valor === null) {
      throw new Error(`${id}: perfil ilegible ${JSON.stringify(p)}`);
    }

    const ventajas: Ventaja[] = Array.isArray(u.fuerte_contra)
      ? (u.fuerte_contra as { tipo?: unknown; bonus?: unknown }[]).map((v) => {
          const tipoId = idPorNombre.get(claveTipo(String(v.tipo)));
          if (!tipoId) throw new Error(`${id}: ventaja contra tipo desconocido "${String(v.tipo)}"`);
          return { tipoId, bonus: Number(v.bonus) };
        })
      : [];

    const diametro = esComandante ? PEANA_COMANDANTE_MM : (PEANA_MM[id] ?? 28);

    tipos[id] = {
      id,
      nombre: String(u.nombre),
      descripcion: String(u.descripcion ?? ''),
      esComandante,
      movimiento: pulgadas(p.movimiento),
      velocidad: pulgadas(p.velocidad) ?? 0,
      vidas,
      salvacion,
      escuadra: numero(p.escuadra),
      valor,
      habilidad: String(u.habilidad ?? ''),
      ventajas,
      disparo: armaDisparo(id, u.armas?.disparo),
      cac: armaCaC(id, u.armas?.cuerpo_a_cuerpo),
      radioPeana: diametro / MM / 2,
      altura: ALTURA[id] ?? ALTURA_INFANTERIA,
    };
  }
  return tipos;
}
