import { describe, expect, it } from 'vitest';
import {
  Engine,
  crearPartida,
  formar,
  piniaAlrededor,
  restriccionesPara,
  vec,
  type GameEvent,
  type GameState,
  type Puesto,
  type Vec2,
} from '@zerolore/core';
import { TIPOS, activada, conAlgunaSemilla, desplazada, enMesa, escuadra } from './ayuda.ts';

const CG_A: Puesto = { id: 'cg-a', centro: vec(10, 15), radio: 3, esCuartelGeneral: true, duenio: 'A' };
const CG_B: Puesto = { id: 'cg-b', centro: vec(50, 15), radio: 3, esCuartelGeneral: true, duenio: 'B' };

function partidaNueva(semilla = 3): Engine {
  return new Engine(
    crearPartida({
      tipos: TIPOS,
      jugadores: ['A', 'B'],
      listas: {
        A: [
          { tipoId: 'comandante-disparo', escuadra: { tipoId: 'tirador', cantidad: 3 } },
          { tipoId: 'tirador' },
        ],
        B: [{ tipoId: 'juggernaut' }, { tipoId: 'milicia' }],
      },
      terreno: [],
      puestos: [CG_A, CG_B],
      mesa: { ancho: 60, alto: 30 },
      turnosTotales: 5,
      semilla,
    }),
  );
}

/** Posiciones de despliegue: el ancla en el centro del puesto y el resto en piña. */
function posicionesEn(state: GameState, reservaId: string, puesto: Puesto): Vec2[] {
  const e = state.reserva.find((r) => r.id === reservaId)!;
  const iAncla = Math.max(0, e.minis.findIndex((m) => m.esComandante));
  const radios = e.minis.map((m) => TIPOS[m.tipoId]!.radioPeana);
  const otros = radios.filter((_, i) => i !== iAncla);
  const off = piniaAlrededor(radios[iAncla]!, otros, vec(puesto.centro.x < 30 ? -1 : 1, 0));
  let k = 0;
  return e.minis.map((_, i) => {
    if (i === iAncla) return puesto.centro;
    const o = off[k++]!;
    return vec(puesto.centro.x + o.x, puesto.centro.y + o.y);
  });
}

const tipos = (r: { ok: boolean; events?: readonly GameEvent[] }): string[] =>
  r.ok && 'events' in r ? r.events!.map((e) => e.type) : [];

describe('el turno', () => {
  it('empieza tirando Iniciativa y abre el despliegue', () => {
    const e = partidaNueva();
    expect(e.getState().fase).toBe('Iniciativa');
    expect(e.execute({ type: 'TirarIniciativa' }).ok).toBe(true);
    const s = e.getState();
    expect(s.fase).toBe('Despliegue');
    expect(s.jugadorActivo).toBe(s.ordenIniciativa[0]);
  });

  it('una unidad por puesto: con el Cuartel General solo entra una por turno', () => {
    const e = partidaNueva();
    e.execute({ type: 'TirarIniciativa' });
    // Se despliega en el orden que marque la iniciativa.
    for (let i = 0; i < 2; i++) {
      const s = e.getState();
      const j = s.jugadorActivo!;
      const puesto = j === 'A' ? CG_A : CG_B;
      const entrada = s.reserva.find((r) => r.owner === j)!;
      const r = e.execute({ type: 'Desplegar', reservaId: entrada.id, puestoId: puesto.id, posiciones: posicionesEn(s, entrada.id, puesto) });
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    }
    // Por el Cuartel General ya no entra nadie más este turno.
    const s = e.getState();
    if (s.jugadorActivo === 'A') {
      const otra = e.execute({ type: 'Desplegar', reservaId: 'A2', puestoId: 'cg-a', posiciones: [CG_A.centro] });
      expect(otra.ok).toBe(false);
      if (!otra.ok) expect(otra.reason).toContain('ya ha entrado');
      // Lo único que le queda a A es reforzar a su Comandante con la Tirador suelta;
      // si pasa, nadie puede desplegar nada y se juega sin botón de por medio.
      e.execute({ type: 'PasarDespliegue', jugador: 'A' });
    }
    expect(e.getState().fase).toBe('Activaciones');
  });

  it('la escuadra entra entera, como una sola unidad', () => {
    const e = partidaNueva();
    e.execute({ type: 'TirarIniciativa' });
    if (e.getState().jugadorActivo !== 'A') {
      const s = e.getState();
      e.execute({ type: 'Desplegar', reservaId: 'B1', puestoId: 'cg-b', posiciones: posicionesEn(s, 'B1', CG_B) });
    }
    const s = e.getState();
    const r = e.execute({ type: 'Desplegar', reservaId: 'A1', puestoId: 'cg-a', posiciones: posicionesEn(s, 'A1', CG_A) });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    expect(e.getState().unidades.A1!.minis).toHaveLength(4);
  });

  it('el Comandante tiene que tocar el puesto', () => {
    const e = partidaNueva();
    e.execute({ type: 'TirarIniciativa' });
    if (e.getState().jugadorActivo !== 'A') {
      e.execute({ type: 'PasarDespliegue', jugador: e.getState().jugadorActivo! });
    }
    const s = e.getState();
    const lejos = posicionesEn(s, 'A1', { ...CG_A, centro: vec(20, 15) });
    const r = e.execute({ type: 'Desplegar', reservaId: 'A1', puestoId: 'cg-a', posiciones: lejos });
    expect(r.ok).toBe(false);
  });

  it('al acabar el turno se cuentan los puestos y se vuelve a tirar Iniciativa', () => {
    const e = new Engine(enMesa({
      unidades: [
        { id: 'A1', owner: 'A', minis: [{ tipo: 'tirador', x: 10, y: 15 }] },
        { id: 'B1', owner: 'B', minis: [{ tipo: 'tirador', x: 50, y: 25 }] },
      ],
      puestos: [CG_A, CG_B],
    }));
    for (const id of ['A1', 'B1']) {
      e.execute({ type: 'ActivarUnidad', unidadId: id });
      e.execute({ type: 'TerminarActivacion', unidadId: id });
    }
    expect(e.getState().fase).toBe('FinDeTurno');
    e.execute({ type: 'TerminarTurno' });
    const s = e.getState();
    expect(s.puntos).toEqual({ A: 5, B: 5 });
    expect(s.turno).toBe(2);
    expect(s.fase).toBe('Iniciativa');
  });
});

describe('moverse', () => {
  const def = escuadra('A1', 'A', 'comandante-disparo', 'tirador', 3, 10, 10);

  it('la escuadra se mueve entera hasta su Movimiento', () => {
    const e = activada({ unidades: [def] }, 'A1');
    const u = e.getState().unidades.A1!;
    const r = e.execute({ type: 'Mover', unidadId: 'A1', posiciones: desplazada(u, 5, 0) });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    expect(tipos(r)).toContain('UnidadMovida');
  });

  it('no puede pasarse de Movimiento', () => {
    const e = activada({ unidades: [def] }, 'A1');
    const u = e.getState().unidades.A1!;
    expect(e.execute({ type: 'Mover', unidadId: 'A1', posiciones: desplazada(u, 5.5, 0) }).ok).toBe(false);
  });

  it('no puede acabar a menos de 1" de un enemigo', () => {
    const enemigo = { id: 'B1', owner: 'B', minis: [{ tipo: 'milicia', x: 18.5, y: 14.2 }] };
    const e = activada({ unidades: [def, enemigo] }, 'A1');
    const u = e.getState().unidades.A1!;
    // La última Tirador acabaría en (17.9, 13): a 0,24" de la Milicia.
    const r = e.execute({ type: 'Mover', unidadId: 'A1', posiciones: desplazada(u, 4, 3) });
    expect(r.ok).toBe(false);
  });

  it('no puede romper la coherencia', () => {
    const e = activada({ unidades: [def] }, 'A1');
    const u = e.getState().unidades.A1!;
    const pos = desplazada(u, 2, 0);
    pos[u.minis[3]!.id] = vec(u.minis[3]!.posicion.x + 2, u.minis[3]!.posicion.y + 4);
    const r = e.execute({ type: 'Mover', unidadId: 'A1', posiciones: pos });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('coherencia');
  });

  it('una misma acción no se repite', () => {
    const e = activada({ unidades: [def] }, 'A1');
    const u = e.getState().unidades.A1!;
    e.execute({ type: 'Mover', unidadId: 'A1', posiciones: desplazada(u, 2, 0) });
    const u2 = e.getState().unidades.A1!;
    expect(e.execute({ type: 'Mover', unidadId: 'A1', posiciones: desplazada(u2, 2, 0) }).ok).toBe(false);
  });
});

describe('disparar con una escuadra', () => {
  it('ataca dos veces: la tropa y después el Comandante', () => {
    const e = activada({
      unidades: [
        escuadra('A1', 'A', 'comandante-disparo', 'tirador', 3, 10, 10),
        { id: 'B1', owner: 'B', minis: [{ tipo: 'juggernaut', x: 25, y: 10 }] },
      ],
    }, 'A1');
    const r = e.execute({ type: 'Disparar', unidadId: 'A1', objetivoId: 'B1' });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    const ataques = r.ok ? r.events.filter((x) => x.type === 'AtaqueResuelto') : [];
    expect(ataques.map((a) => a.type === 'AtaqueResuelto' && a.parte)).toEqual(['tropa', 'comandante']);
  });

  it('solo tiran las miniaturas que llegan al objetivo', () => {
    // Fila hacia atrás desde el Comandante. Con el objetivo en x=53,5 y 24" de
    // alcance, solo la primera Tirador queda dentro midiendo desde su peana.
    const e = activada({
      unidades: [
        { id: 'A1', owner: 'A', minis: [
          { tipo: 'comandante-disparo', x: 30, y: 10, comandante: true },
          { tipo: 'tirador', x: 28.7, y: 10 },
          { tipo: 'tirador', x: 27.4, y: 10 },
          { tipo: 'tirador', x: 26.1, y: 10 },
        ] },
        { id: 'B1', owner: 'B', minis: [{ tipo: 'milicia', x: 53.5, y: 10 }] },
      ],
    }, 'A1');
    const r = e.execute({ type: 'Disparar', unidadId: 'A1', objetivoId: 'B1' });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    const tropa = r.ok ? r.events.find((x) => x.type === 'AtaqueResuelto' && x.parte === 'tropa') : undefined;
    expect(tropa && tropa.type === 'AtaqueResuelto' ? tropa.minis : 0).toBe(1);
  });

  it('no se dispara a una unidad trabada', () => {
    const e = activada({
      unidades: [
        { id: 'A1', owner: 'A', minis: [{ tipo: 'tirador', x: 10, y: 10 }] },
        { id: 'B1', owner: 'B', minis: [{ tipo: 'milicia', x: 25, y: 10 }], trabadaCon: ['A2'] },
        { id: 'A2', owner: 'A', minis: [{ tipo: 'choque', x: 26.12, y: 10 }], trabadaCon: ['B1'] },
      ],
    }, 'A1');
    expect(e.execute({ type: 'Disparar', unidadId: 'A1', objetivoId: 'B1' }).ok).toBe(false);
  });

  it('destruir miniaturas da su Valor, una a una', () => {
    const r = conAlgunaSemilla((semilla) => {
      const e = new Engine(enMesa({
        semilla,
        unidades: [
          { id: 'A1', owner: 'A', minis: [{ tipo: 'juggernaut', x: 10, y: 10 }] },
          { id: 'B1', owner: 'B', minis: [
            { tipo: 'comandante-cac', x: 20, y: 10, comandante: true },
            { tipo: 'milicia', x: 21.3, y: 10, vidas: 1 },
            { tipo: 'milicia', x: 22.6, y: 10 },
          ] },
        ],
      }));
      e.execute({ type: 'ActivarUnidad', unidadId: 'A1' });
      e.execute({ type: 'Disparar', unidadId: 'A1', objetivoId: 'B1' });
      const s = e.getState();
      const muertas = 3 - (s.unidades.B1?.minis.length ?? 0);
      return muertas >= 1 && muertas < 3 ? { s, muertas } : null;
    });
    const valorMilicia = TIPOS.milicia!.valor;
    expect(r.s.puntos.A).toBe(r.muertas * valorMilicia);
  });
});

describe('cargar y pelear', () => {
  const choques = escuadra('A1', 'A', 'comandante-cac', 'choque', 3, 10, 10);
  const blanco = { id: 'B1', owner: 'B', minis: [{ tipo: 'tirador', x: 16, y: 10 }] };

  it('con 3+ traba a las dos y deja el ataque gratuito pendiente', () => {
    const { e, r } = conAlgunaSemilla((semilla) => {
      const e = activada({ unidades: [choques, blanco], semilla }, 'A1');
      const r = e.execute({ type: 'Cargar', unidadId: 'A1', objetivoId: 'B1' });
      const carga = r.ok ? r.events.find((x) => x.type === 'CargaResuelta') : undefined;
      return carga && carga.type === 'CargaResuelta' && carga.exito ? { e, r } : null;
    });
    expect(tipos(r)).toContain('AtaqueGratuitoPendiente');
    const s = e.getState();
    expect(s.unidades.A1!.trabadaCon).toContain('B1');
    expect(s.unidades.B1!.trabadaCon).toContain('A1');
    expect(s.unidades.A1!.ataqueGratuitoContra).toBe('B1');
  });

  it('el ataque gratuito no gasta acciones y lleva Carga brutal', () => {
    const { e } = conAlgunaSemilla((semilla) => {
      const e = activada({ unidades: [choques, blanco], semilla }, 'A1');
      const r = e.execute({ type: 'Cargar', unidadId: 'A1', objetivoId: 'B1' });
      const carga = r.ok ? r.events.find((x) => x.type === 'CargaResuelta') : undefined;
      return carga && carga.type === 'CargaResuelta' && carga.exito ? { e } : null;
    });
    const r = e.execute({ type: 'AtacarCaC', unidadId: 'A1', objetivoId: 'B1' });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    const tropa = r.ok ? r.events.find((x) => x.type === 'AtaqueResuelto' && x.parte === 'tropa') : undefined;
    expect(tropa && tropa.type === 'AtaqueResuelto' ? tropa.tirada.parametros.notas : []).toContain('Carga brutal +1 dado');
    expect(tipos(r)).not.toContain('AccionUsada');
  });

  it('con 1 o 2 se frena a 1" y la activación termina', () => {
    const { e } = conAlgunaSemilla((semilla) => {
      const e = activada({ unidades: [choques, blanco], semilla }, 'A1');
      const r = e.execute({ type: 'Cargar', unidadId: 'A1', objetivoId: 'B1' });
      const carga = r.ok ? r.events.find((x) => x.type === 'CargaResuelta') : undefined;
      return carga && carga.type === 'CargaResuelta' && !carga.exito ? { e } : null;
    });
    const s = e.getState();
    expect(s.unidades.A1!.trabadaCon).toEqual([]);
    expect(s.unidades.A1!.activada).toBe(true);
  });

  it('fuera de Movimiento + Velocidad no hay carga', () => {
    const lejos = { id: 'B1', owner: 'B', minis: [{ tipo: 'tirador', x: 30, y: 10 }] };
    const e = activada({ unidades: [choques, lejos] }, 'A1');
    expect(e.execute({ type: 'Cargar', unidadId: 'A1', objetivoId: 'B1' }).ok).toBe(false);
  });

  it('trabada, solo puede atacar o destrabarse', () => {
    const e = activada({
      unidades: [
        { id: 'A1', owner: 'A', minis: [{ tipo: 'tirador', x: 10, y: 10 }], trabadaCon: ['B1'] },
        { id: 'B1', owner: 'B', minis: [{ tipo: 'choque', x: 11.12, y: 10 }], trabadaCon: ['A1'] },
      ],
    }, 'A1');
    expect(e.execute({ type: 'Disparar', unidadId: 'A1', objetivoId: 'B1' }).ok).toBe(false);
    expect(e.execute({ type: 'AtacarCaC', unidadId: 'A1', objetivoId: 'B1' }).ok).toBe(true);
  });

  it('destrabarse sale con 3+', () => {
    const resultados = new Set<boolean>();
    for (let semilla = 1; semilla < 30; semilla++) {
      const e = activada({
        semilla,
        unidades: [
          { id: 'A1', owner: 'A', minis: [{ tipo: 'tirador', x: 10, y: 10 }], trabadaCon: ['B1'] },
          { id: 'B1', owner: 'B', minis: [{ tipo: 'choque', x: 11.12, y: 10 }], trabadaCon: ['A1'] },
        ],
      }, 'A1');
      const r = e.execute({ type: 'Destrabarse', unidadId: 'A1' });
      const d = r.ok ? r.events.find((x) => x.type === 'DestrabeResuelto') : undefined;
      if (!d || d.type !== 'DestrabeResuelto') continue;
      expect(d.exito).toBe(d.dado >= 3);
      expect(e.getState().unidades.A1!.trabadaCon.length === 0).toBe(d.exito);
      resultados.add(d.exito);
    }
    expect(resultados.size).toBe(2);
  });
});

describe('ganar', () => {
  it('quien se queda sin unidades en mesa pierde, aunque tenga reserva', () => {
    const r = conAlgunaSemilla((semilla) => {
      const base = enMesa({
        semilla,
        unidades: [
          { id: 'A1', owner: 'A', minis: [{ tipo: 'juggernaut', x: 10, y: 10 }] },
          { id: 'B1', owner: 'B', minis: [{ tipo: 'milicia', x: 20, y: 10, vidas: 1 }] },
        ],
      });
      const e = new Engine({ ...base, reserva: [{ id: 'B2', owner: 'B', minis: [{ tipoId: 'milicia', esComandante: false }] }] });
      e.execute({ type: 'ActivarUnidad', unidadId: 'A1' });
      const r = e.execute({ type: 'Disparar', unidadId: 'A1', objetivoId: 'B1' });
      return e.getState().fase === 'Terminada' ? { e, r } : null;
    });
    expect(r.e.getState().ganador).toBe('A');
    expect(tipos(r.r)).toContain('PartidaTerminada');
  });

  it('tomar el Cuartel General enemigo gana en el acto', () => {
    const e = new Engine(enMesa({
      unidades: [
        { id: 'A1', owner: 'A', minis: [{ tipo: 'tirador', x: 50, y: 15 }] },
        { id: 'B1', owner: 'B', minis: [{ tipo: 'tirador', x: 30, y: 25 }] },
      ],
      puestos: [CG_A, CG_B],
    }));
    for (const id of ['A1', 'B1']) {
      e.execute({ type: 'ActivarUnidad', unidadId: id });
      e.execute({ type: 'TerminarActivacion', unidadId: id });
    }
    e.execute({ type: 'TerminarTurno' });
    expect(e.getState().fase).toBe('Terminada');
    expect(e.getState().ganador).toBe('A');
  });
});

describe('refuerzos', () => {
  it('un Comandante recibe una miniatura de su tipo en el despliegue', () => {
    const base = enMesa({
      unidades: [escuadra('A1', 'A', 'comandante-disparo', 'tirador', 2, 10, 10)],
      puestos: [CG_A],
    });
    const e = new Engine({
      ...base,
      fase: 'Despliegue',
      ordenIniciativa: ['A', 'B'],
      jugadorActivo: 'A',
      reserva: [{ id: 'A9', owner: 'A', minis: [{ tipoId: 'tirador', esComandante: false }] }],
    });
    const r = e.execute({ type: 'Reforzar', unidadId: 'A1', reservaId: 'A9', posicion: vec(13.9, 10) });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    expect(e.getState().unidades.A1!.minis).toHaveLength(4);
  });

  it('no admite un tipo distinto al de su escuadra', () => {
    const base = enMesa({ unidades: [escuadra('A1', 'A', 'comandante-disparo', 'tirador', 2, 10, 10)] });
    const e = new Engine({
      ...base,
      fase: 'Despliegue',
      ordenIniciativa: ['A', 'B'],
      jugadorActivo: 'A',
      reserva: [{ id: 'A9', owner: 'A', minis: [{ tipoId: 'milicia', esComandante: false }] }],
    });
    const r = e.execute({ type: 'Reforzar', unidadId: 'A1', reservaId: 'A9', posicion: vec(13.9, 10) });
    expect(r.ok).toBe(false);
  });
});

describe('el motor no cambia nada si la orden es ilegal', () => {
  it('ni el estado ni los dados', () => {
    const e = activada({ unidades: [escuadra('A1', 'A', 'comandante-disparo', 'tirador', 3, 10, 10)] }, 'A1');
    const antes = e.getState();
    const u = antes.unidades.A1!;
    expect(e.execute({ type: 'Mover', unidadId: 'A1', posiciones: desplazada(u, 9, 0) }).ok).toBe(false);
    expect(e.getState()).toBe(antes);
  });
});

describe('formar alrededor del Comandante también sirve para mover', () => {
  it('el resultado de formar siempre es una orden legal', () => {
    const def = escuadra('A1', 'A', 'comandante-disparo', 'tirador', 4, 10, 10);
    const e = activada({ unidades: [def] }, 'A1');
    const s = e.getState();
    const u = s.unidades.A1!;
    const piezas = u.minis.map((m, i) => ({ id: m.id, radio: TIPOS[m.tipoId]!.radioPeana, desde: m.posicion, esAncla: i === 0 }));
    const pos = formar(piezas, vec(13, 13), restriccionesPara(s, 'A', 'A1', 1), 5)!;
    const r = e.execute({ type: 'Mover', unidadId: 'A1', posiciones: pos });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  });
});
