import { describe, expect, it } from 'vitest';
import { Engine, crearPartida, siguienteJugada, vec, type GameEvent, type Puesto } from '@zerolore/core';
import { TIPOS } from './ayuda.ts';

const PUESTOS: Puesto[] = [
  { id: 'cg-a', centro: vec(30, 6), radio: 3, esCuartelGeneral: true, duenio: 'A' },
  { id: 'cg-b', centro: vec(30, 24), radio: 3, esCuartelGeneral: true, duenio: 'B' },
  { id: 'centro', centro: vec(30, 15), radio: 2, esCuartelGeneral: false, duenio: null },
];

function partida(semilla: number): Engine {
  return new Engine(crearPartida({
    tipos: TIPOS,
    jugadores: ['A', 'B'],
    listas: {
      A: [
        { tipoId: 'comandante-disparo', escuadra: { tipoId: 'tirador', cantidad: 3 } },
        { tipoId: 'juggernaut' },
        { tipoId: 'tirador' },
      ],
      B: [
        { tipoId: 'comandante-cac', escuadra: { tipoId: 'choque', cantidad: 3 } },
        { tipoId: 'exterminador' },
        { tipoId: 'choque' },
      ],
    },
    terreno: [{ id: 'murete', rect: { x: 33, y: 14.4, width: 6, height: 1.2 }, altura: 1.6, tipo: 'cobertura' }],
    puestos: PUESTOS,
    mesa: { ancho: 60, alto: 30 },
    turnosTotales: 5,
    semilla,
  }));
}

/** Juega una partida entera con las dos IAs. */
function jugar(semilla: number): { e: Engine; pasos: number; rechazos: string[] } {
  const e = partida(semilla);
  const rechazos: string[] = [];
  let pasos = 0;
  while (e.getState().fase !== 'Terminada' && pasos < 3000) {
    pasos++;
    const s = e.getState();
    const quien = s.jugadorActivo ?? 'A';
    const j = siguienteJugada(s, quien);
    if (!j) {
      // Nadie con jugada: o se cierra la activación o algo se ha atascado.
      if (s.unidadActiva) e.execute({ type: 'TerminarActivacion', unidadId: s.unidadActiva });
      else break;
      continue;
    }
    const r = e.execute(j.cmd);
    if (!r.ok) {
      rechazos.push(`${j.cmd.type}: ${r.reason}`);
      if (s.unidadActiva) e.execute({ type: 'TerminarActivacion', unidadId: s.unidadActiva });
      else if (s.fase === 'Despliegue') e.execute({ type: 'PasarDespliegue', jugador: quien });
    }
  }
  return { e, pasos, rechazos };
}

describe('IA contra IA', () => {
  it('la partida llega al final sin atascarse', () => {
    for (const semilla of [1, 2, 3, 4, 5]) {
      const { e, pasos } = jugar(semilla);
      expect(e.getState().fase, `semilla ${semilla}`).toBe('Terminada');
      expect(pasos).toBeLessThan(3000);
    }
  });

  it('casi nunca pide algo ilegal', () => {
    let total = 0;
    let malas = 0;
    for (const semilla of [1, 2, 3, 4, 5]) {
      const { pasos, rechazos } = jugar(semilla);
      total += pasos;
      malas += rechazos.length;
    }
    expect(malas / total).toBeLessThan(0.02);
  });

  it('se dispara, se carga y se pelea', () => {
    const vistos = new Set<string>();
    for (const semilla of [1, 2, 3, 4, 5]) {
      for (const ev of jugar(semilla).e.getLog() as GameEvent[]) {
        if (ev.type === 'AtaqueResuelto') vistos.add(ev.arma);
        if (ev.type === 'CargaResuelta') vistos.add('carga');
        if (ev.type === 'MiniaturaReforzada') vistos.add('refuerzo');
      }
    }
    expect(vistos).toContain('disparo');
    expect(vistos).toContain('carga');
    expect(vistos).toContain('cac');
  });
});

describe('la máquina forma sus escuadras en la mesa', () => {
  it('saca primero al Comandante y le arrastra la tropa de la que más sueltas tiene', () => {
    const e = new Engine(crearPartida({
      tipos: TIPOS,
      jugadores: ['A', 'B'],
      listas: {
        A: [{ tipoId: 'milicia' }, { tipoId: 'tirador' }, { tipoId: 'tirador' }, { tipoId: 'comandante-disparo' }],
        B: [{ tipoId: 'juggernaut' }],
      },
      terreno: [],
      puestos: PUESTOS,
      mesa: { ancho: 60, alto: 30 },
      turnosTotales: 5,
      semilla: 5,
    }));
    e.execute({ type: 'TirarIniciativa' });
    const deA: string[] = [];
    for (let i = 0; i < 40 && e.getState().fase === 'Despliegue'; i++) {
      const j = e.getState().jugadorActivo!;
      const jugada = siguienteJugada(e.getState(), j);
      if (!jugada) break;
      if (j === 'A') deA.push(jugada.cmd.type === 'Desplegar' || jugada.cmd.type === 'Reforzar' ? `${jugada.cmd.type}:${jugada.cmd.reservaId}` : jugada.cmd.type);
      const r = e.execute(jugada.cmd);
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    }
    // A4 es el Comandante; A2 y A3, los Tiradores.
    expect(deA.slice(0, 3)).toEqual(['Desplegar:A4', 'Reforzar:A2', 'Reforzar:A3']);
    const comandante = e.getState().unidades.A4!;
    expect(comandante.minis.map((m) => m.tipoId)).toEqual(['comandante-disparo', 'tirador', 'tirador']);
  });
});

