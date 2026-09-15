/**
 * Prototipo jugable sin gráficos: enfrenta dos facciones y narra la batalla
 * por consola. Sirve para comprobar que las reglas funcionan de verdad antes
 * de invertir un solo píxel en la interfaz.
 *
 *   node --experimental-strip-types scripts/sim.ts [semilla] [facciónA] [facciónB]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine, baseDistance, vec } from '../packages/core/src/index.ts';
import type { GameState, Unit, UnitProfile, Vec2 } from '../packages/core/src/index.ts';

const profiles: UnitProfile[] = JSON.parse(
  readFileSync(resolve('packages/data/profiles.json'), 'utf8'),
);

const semilla = Number(process.argv[2] ?? 2024);
const setA = process.argv[3] ?? 'Disparo';
const setB = process.argv[4] ?? 'Asalto';

/**
 * Lista de escaramuza: el Héroe obligatorio más infantería del set indicado.
 * Vehículos, Monstruos y Artillería no juegan en Escaramuza.
 */
function roster(set: string, heroeId: string): UnitProfile[] {
  const heroe = profiles.find((p) => p.id === heroeId);
  const tropa = profiles.filter(
    (p) => p.set === set && ['Choque', 'Elite', 'Especialista'].includes(p.clase),
  );
  return [...(heroe ? [heroe] : []), ...tropa];
}

const listaA = roster(setA, 'heroe_heroe1');
const listaB = roster(setB, 'heroe_heroe2');
if (listaA.length < 2 || listaB.length < 2) {
  console.error('Set no válido. Usa: Equilibrado, Disparo o Asalto');
  process.exit(1);
}

const units: Record<string, Unit> = {};
const profileMap: Record<string, UnitProfile> = {};
const despliegue = (lista: UnitProfile[], owner: string, y: number): void => {
  lista.forEach((p, i) => {
    profileMap[p.id] = p;
    const id = `${owner}${i + 1}`;
    units[id] = {
      id,
      profileId: p.id,
      owner,
      position: vec(6 + i * 6, y),
      vidas: p.vidas,
      activated: false,
      accionesRestantes: 0,
      accionesUsadas: [],
      trabadaCon: [],
      seMovio: false,
      corrio: false,
      cargo: false,
      destruidaEnTurno: null,
      ataqueGratuitoContra: null,
    };
  });
};
despliegue(listaA, 'A', 0);
despliegue(listaB, 'B', 24); // Mesa de 24" de fondo entre despliegues.

const initial: GameState = {
  mode: 'Escaramuza',
  turno: 1,
  fase: 'Iniciativa',
  jugadores: ['A', 'B'],
  ordenIniciativa: [],
  jugadorActivo: null,
  unidadActiva: null,
  units,
  profiles: profileMap,
  terrain: [
    // Un muro central que corta la línea de tiro por el medio de la mesa.
    { id: 'muro', rect: { x: 10, y: 11, width: 8, height: 1.5 }, altura: 2, bloqueaVision: true },
  ],
  rngState: semilla,
};

const engine = new Engine(initial);

const nombre = (id: string): string => {
  const u = engine.getState().units[id]!;
  return `${id} (${engine.getState().profiles[u.profileId]!.nombre})`;
};

/** Mueve `distancia` pulgadas desde `desde` en dirección a `hacia`. */
function stepToward(desde: Vec2, hacia: Vec2, distancia: number): Vec2 {
  const dx = hacia.x - desde.x;
  const dy = hacia.y - desde.y;
  const l = Math.hypot(dx, dy) || 1;
  return vec(desde.x + (dx / l) * distancia, desde.y + (dy / l) * distancia);
}

/**
 * IA mínima: dispara si puede, si no carga si tiene el enemigo a tiro de
 * carga, y si no avanza hacia el enemigo más cercano. No pretende jugar bien,
 * solo ejercitar todas las ramas del reglamento.
 */
function playUnit(unitId: string): void {
  const s = engine.getState();
  const u = s.units[unitId]!;
  const p = s.profiles[u.profileId]!;

  const enemigos = Object.values(s.units).filter((o) => o.owner !== u.owner && o.vidas > 0);
  if (enemigos.length === 0) return;

  const cercano = enemigos.reduce((best, e) => {
    const ep = s.profiles[e.profileId]!;
    const bp = s.profiles[best.profileId]!;
    return baseDistance(u.position, p.radioPeana, e.position, ep.radioPeana) <
      baseDistance(u.position, p.radioPeana, best.position, bp.radioPeana)
      ? e
      : best;
  });

  // Trabada: pega o intenta soltarse.
  if (u.trabadaCon.length > 0) {
    const arma = p.armas.find((w) => w.kind === 'cuerpo_a_cuerpo');
    const objetivo = u.trabadaCon[0]!;
    if (arma) engine.execute({ type: 'AtacarCaC', unitId, targetId: objetivo, armaNombre: arma.nombre });
    else engine.execute({ type: 'Destrabarse', unitId });
    return;
  }

  // Disparar con la mejor arma que tenga alcance y visión.
  for (const arma of p.armas) {
    if (arma.kind !== 'disparo') continue;
    const r = engine.execute({ type: 'Disparar', unitId, targetId: cercano.id, armaNombre: arma.nombre });
    if (r.ok) break;
  }

  const tras = engine.getState().units[unitId]!;
  if (tras.accionesRestantes >= 2) {
    // Sin disparo posible: intentar carga, y si no, avanzar.
    const carga = engine.execute({ type: 'Cargar', unitId, targetId: cercano.id });
    if (carga.ok) return;
  }
  const actual = engine.getState().units[unitId]!;
  if (actual.accionesRestantes >= 1) {
    const destino = stepToward(actual.position, cercano.position, p.movimiento);
    engine.execute({ type: 'Mover', unitId, destino });
  }
  engine.execute({ type: 'TerminarActivacion', unitId });
}

console.log(`\n=== ZeroLore — Escaramuza ===`);
console.log(`Semilla ${semilla}  |  set ${setA} vs set ${setB}\n`);
for (const [id, u] of Object.entries(units)) {
  const p = profileMap[u.profileId]!;
  console.log(`  ${id}  ${p.nombre.padEnd(26)} ${p.clase.padEnd(14)} Mv${p.movimiento}" V${p.vidas} Sv${p.salvacion}+`);
}

const MAX_TURNOS = 12;
let cursor = 0;

for (let turno = 1; turno <= MAX_TURNOS; turno++) {
  const ini = engine.execute({ type: 'TirarIniciativa' });
  if (!ini.ok) break;
  const ev = ini.events.find((e) => e.type === 'IniciativaTirada');
  if (ev && ev.type === 'IniciativaTirada') {
    console.log(`\n--- Turno ${turno} --- Iniciativa: ${Object.entries(ev.tiradas).map(([p, d]) => `${p}=${d}`).join(' ')} -> activa primero ${ev.orden[0]}`);
  }

  // Activaciones alternas hasta que no quede nadie por activar.
  for (let guard = 0; guard < 100; guard++) {
    const s = engine.getState();
    if (s.fase !== 'Activaciones') break;
    const jugador = s.jugadorActivo;
    if (!jugador) break;
    const pendiente = Object.values(s.units).find(
      (u) => u.owner === jugador && !u.activated && u.vidas > 0,
    );
    if (!pendiente) break;
    engine.execute({ type: 'ActivarUnidad', unitId: pendiente.id });
    playUnit(pendiente.id);
  }

  // Narrar lo ocurrido en este turno.
  const log = engine.getLog();
  for (const e of log.slice(cursor)) {
    switch (e.type) {
      case 'UnidadMovida':
        console.log(`   ${nombre(e.unitId)} avanza ${e.distancia.toFixed(1)}"`);
        break;
      case 'DisparoResuelto': {
        const r = e.resultado;
        console.log(
          `   ${nombre(e.attackerId)} dispara ${e.arma} a ${nombre(e.targetId)}: ` +
            `[${r.dadosAtaque.join(',')}] impacta ${r.impactos}+${r.criticos}cr vs ${r.umbralImpacto}+ | ` +
            `salva [${r.dadosSalvacion.join(',')}] vs ${r.umbralSalvacion}+ | daño ${r.danioTotal}`,
        );
        for (const n of r.notas) console.log(`      · ${n}`);
        break;
      }
      case 'CargaResuelta':
        console.log(`   ${nombre(e.unitId)} carga contra ${nombre(e.targetId)}: 1D6=${e.dado} ${e.exito ? 'CARGA' : 'se frena'}`);
        break;
      case 'CaCResuelto': {
        const r = e.resultado;
        console.log(
          `   ${nombre(e.attackerId)} ataca con ${e.arma}: [${r.dadosAtaque.join(',')}] ` +
            `${r.impactos}+${r.criticos}cr | salva [${r.dadosSalvacion.join(',')}] | daño ${r.danioTotal}`,
        );
        break;
      }
      case 'DestrabeResuelto':
        console.log(`   ${nombre(e.unitId)} intenta destrabarse: 1D6=${e.dado} ${e.exito ? 'libre' : 'atrapada'}`);
        break;
      case 'DanioAplicado':
        console.log(`      -> ${nombre(e.unitId)} pierde ${e.danio}, le quedan ${e.vidasRestantes}`);
        break;
      case 'UnidadDestruida':
        console.log(`      *** ${nombre(e.unitId)} DESTRUIDA ***`);
        break;
      default:
        break;
    }
  }
  cursor = log.length;

  const fin = engine.execute({ type: 'TerminarTurno' });
  if (fin.ok) {
    const acabada = fin.events.find((e) => e.type === 'PartidaTerminada');
    if (acabada && acabada.type === 'PartidaTerminada') {
      console.log(`\n=== FIN: gana ${acabada.ganador ?? 'nadie (aniquilación mutua)'} en el turno ${turno} ===\n`);
      break;
    }
  }
}

const vivos = Object.values(engine.getState().units).filter((u) => u.vidas > 0);
console.log('Supervivientes:');
for (const u of vivos) console.log(`  ${u.owner} ${nombre(u.id)} con ${u.vidas} vidas`);
console.log(`\nEventos registrados: ${engine.getLog().length}\n`);
