/**
 * Partidas IA contra IA por consola, sin gráficos. Sirve para ver si las reglas
 * y los ejércitos se sostienen antes de tocar un píxel: quién gana, cómo y en
 * cuántos turnos.
 *
 *   npm run sim -- [partidas] [semilla inicial]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine, crearPartida, leerCatalogo, siguienteJugada, vec } from '../packages/core/src/index.ts';
import type { EntradaLista, GameEvent, Puesto, Terrain } from '../packages/core/src/index.ts';

const tipos = leerCatalogo(JSON.parse(readFileSync(resolve('packages/data/catalogo.json'), 'utf8')));
const partidas = Number(process.argv[2] ?? 20);
const semilla0 = Number(process.argv[3] ?? 1);

const LISTAS: Record<string, EntradaLista[]> = {
  A: [
    { tipoId: 'comandante-disparo', escuadra: { tipoId: 'tirador', cantidad: 3 } },
    { tipoId: 'comandante-cac', escuadra: { tipoId: 'choque', cantidad: 3 } },
    { tipoId: 'juggernaut' },
    { tipoId: 'tirador' },
    { tipoId: 'choque' },
  ],
  B: [
    { tipoId: 'comandante-cac', escuadra: { tipoId: 'milicia', cantidad: 6 } },
    { tipoId: 'exterminador' },
    { tipoId: 'comandante-disparo', escuadra: { tipoId: 'tirador', cantidad: 3 } },
    { tipoId: 'milicia' },
    { tipoId: 'milicia' },
  ],
};

const TERRENO: Terrain[] = [
  { id: 'edificio-oeste', rect: { x: 8, y: 19, width: 6, height: 5 }, altura: 4, tipo: 'bloqueo' },
  { id: 'edificio-este', rect: { x: 46, y: 6, width: 6, height: 5 }, altura: 4, tipo: 'bloqueo' },
  { id: 'murete-norte', rect: { x: 21, y: 10.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' },
  { id: 'murete-sur', rect: { x: 33, y: 18.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' },
];

const PUESTOS: Puesto[] = [
  { id: 'cg-azul', centro: vec(30, 4), radio: 3, esCuartelGeneral: true, duenio: 'A' },
  { id: 'cg-rojo', centro: vec(30, 26), radio: 3, esCuartelGeneral: true, duenio: 'B' },
  { id: 'oeste', centro: vec(10, 13), radio: 2.5, esCuartelGeneral: false, duenio: null },
  { id: 'centro', centro: vec(30, 15), radio: 2.5, esCuartelGeneral: false, duenio: null },
  { id: 'este', centro: vec(50, 17), radio: 2.5, esCuartelGeneral: false, duenio: null },
];

const victorias: Record<string, number> = { A: 0, B: 0, empate: 0 };
const motivos: Record<string, number> = {};
let rechazos = 0;

for (let i = 0; i < partidas; i++) {
  const e = new Engine(crearPartida({
    tipos, jugadores: ['A', 'B'], listas: LISTAS, terreno: TERRENO, puestos: PUESTOS,
    mesa: { ancho: 60, alto: 30 }, turnosTotales: 5, semilla: semilla0 + i,
  }));
  for (let paso = 0; paso < 4000 && e.getState().fase !== 'Terminada'; paso++) {
    const s = e.getState();
    const j = siguienteJugada(s, s.jugadorActivo ?? 'A');
    if (!j) {
      if (s.unidadActiva) e.execute({ type: 'TerminarActivacion', unidadId: s.unidadActiva });
      else break;
      continue;
    }
    if (!e.execute(j.cmd).ok) {
      rechazos++;
      if (s.unidadActiva) e.execute({ type: 'TerminarActivacion', unidadId: s.unidadActiva });
      else if (s.fase === 'Despliegue') e.execute({ type: 'PasarDespliegue', jugador: s.jugadorActivo! });
    }
  }
  const s = e.getState();
  const fin = e.getLog().find((x): x is Extract<GameEvent, { type: 'PartidaTerminada' }> => x.type === 'PartidaTerminada');
  victorias[s.ganador ?? 'empate'] = (victorias[s.ganador ?? 'empate'] ?? 0) + 1;
  const motivo = (fin?.motivo ?? 'sin terminar').replace(/^[AB] /, '').replace(/cg-\w+/, 'CG');
  motivos[motivo] = (motivos[motivo] ?? 0) + 1;
  console.log(`#${semilla0 + i}  turno ${s.turno}  gana ${s.ganador ?? '—'}  ${JSON.stringify(s.puntos)}  (${fin?.motivo ?? 'sin terminar'})`);
}

console.log('\nVictorias:', victorias);
console.log('Cómo acaban:', motivos);
console.log('Órdenes rechazadas:', rechazos);
