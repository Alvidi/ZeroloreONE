import { describe, expect, it } from 'vitest';
import { Engine, vec, type GameState, type Unit, type UnitProfile } from '@zerolore/core';

const perfil: UnitProfile = {
  id: 'p', nombre: 'Choque Asalto', rol: null, clase: 'Choque', set: 'Asalto',
  movimiento: 5, vidas: 8, salvacion: 5, velocidad: 2,
  escuadraMin: 1, escuadraMax: 1, valor: 2, habilidad: null, radioPeana: 0.63,
  armas: [
    { kind: 'cuerpo_a_cuerpo', nombre: 'Bárbaro', ataques: 2, danio: 1, danioCritico: 2, habilidades: [] },
    { kind: 'disparo', nombre: 'Corta', ataques: 1, distancia: 6, precision: 4, danio: 1, danioCritico: 1, habilidades: [] },
  ],
};

const unit = (id: string, owner: string, x: number, y: number): Unit => ({
  id, profileId: 'p', owner, position: vec(x, y), vidas: 8,
  activated: false, accionesRestantes: 0, accionesUsadas: [],
  trabadaCon: [], seMovio: false, corrio: false, cargo: false,
  destruidaEnTurno: null, ataqueGratuitoContra: null,
});

const estado = (semilla: number): GameState => ({
  mode: 'Escaramuza', turno: 1, fase: 'Despliegue',
  jugadores: ['A', 'B'], ordenIniciativa: [], jugadorActivo: null, unidadActiva: null,
  units: { a1: unit('a1', 'A', 10, 10), b1: unit('b1', 'B', 10, 15) },
  profiles: { p: perfil }, terrain: [], puestos: [], reserva: [], puntos: {}, refuerzosUsados: {}, desplieguePasado: {}, turnosTotales: 6, rngState: semilla,
});

/** Activa a la unidad que le toque y devuelve su id. */
function activarPrimera(e: Engine): string {
  e.execute({ type: 'TirarIniciativa' });
  const s = e.getState();
  const u = Object.values(s.units).find((x) => x.owner === s.jugadorActivo)!;
  e.execute({ type: 'ActivarUnidad', unitId: u.id });
  return u.id;
}

describe('Carga y ataque gratuito', () => {
  it('la carga con éxito traba y deja el ataque gratuito pendiente, sin resolverlo', () => {
    // Se buscan semillas hasta dar con una carga exitosa.
    for (let semilla = 0; semilla < 40; semilla++) {
      const e = new Engine(estado(semilla));
      const atacante = activarPrimera(e);
      const objetivo = atacante === 'a1' ? 'b1' : 'a1';
      const r = e.execute({ type: 'Cargar', unitId: atacante, targetId: objetivo });
      if (!r.ok) continue;
      const carga = r.events.find((ev) => ev.type === 'CargaResuelta');
      if (!carga || carga.type !== 'CargaResuelta' || !carga.exito) continue;

      // Traba sí, ataque no: no debe haberse resuelto ningún CaC todavía.
      expect(r.events.some((ev) => ev.type === 'UnidadesTrabadas')).toBe(true);
      expect(r.events.some((ev) => ev.type === 'CaCResuelto')).toBe(false);
      expect(r.events.some((ev) => ev.type === 'AtaqueGratuitoPendiente')).toBe(true);
      // La activación sigue viva para poder lanzarlo.
      expect(e.getState().unidadActiva).toBe(atacante);
      expect(e.getState().units[atacante]!.ataqueGratuitoContra).toBe(objetivo);
      return;
    }
    throw new Error('Ninguna semilla produjo una carga con éxito');
  });

  it('el ataque gratuito no consume acciones y solo puede usarse una vez', () => {
    for (let semilla = 0; semilla < 40; semilla++) {
      const e = new Engine(estado(semilla));
      const atacante = activarPrimera(e);
      const objetivo = atacante === 'a1' ? 'b1' : 'a1';
      const r = e.execute({ type: 'Cargar', unitId: atacante, targetId: objetivo });
      if (!r.ok) continue;
      const carga = r.events.find((ev) => ev.type === 'CargaResuelta');
      if (!carga || carga.type !== 'CargaResuelta' || !carga.exito) continue;

      // Cargar cuesta 2 acciones, así que no queda ninguna.
      expect(e.getState().units[atacante]!.accionesRestantes).toBe(0);

      const ataque = e.execute({
        type: 'AtacarCaC', unitId: atacante, targetId: objetivo, armaNombre: 'Bárbaro',
      });
      // Aun con 0 acciones, el gratuito se permite.
      expect(ataque.ok).toBe(true);
      if (ataque.ok) {
        expect(ataque.events.some((ev) => ev.type === 'CaCResuelto')).toBe(true);
        const usada = ataque.events.find((ev) => ev.type === 'AccionUsada');
        expect(usada?.type === 'AccionUsada' && usada.coste).toBe(0);
      }
      return;
    }
    throw new Error('Ninguna semilla produjo una carga con éxito');
  });

  it('la carga frenada termina la activación y no deja ataque pendiente', () => {
    for (let semilla = 0; semilla < 40; semilla++) {
      const e = new Engine(estado(semilla));
      const atacante = activarPrimera(e);
      const objetivo = atacante === 'a1' ? 'b1' : 'a1';
      const r = e.execute({ type: 'Cargar', unitId: atacante, targetId: objetivo });
      if (!r.ok) continue;
      const carga = r.events.find((ev) => ev.type === 'CargaResuelta');
      if (!carga || carga.type !== 'CargaResuelta' || carga.exito) continue;

      expect(r.events.some((ev) => ev.type === 'ActivacionTerminada')).toBe(true);
      expect(e.getState().units[atacante]!.ataqueGratuitoContra).toBeNull();
      expect(e.getState().units[atacante]!.trabadaCon).toHaveLength(0);
      return;
    }
    throw new Error('Ninguna semilla produjo una carga frenada');
  });
});
