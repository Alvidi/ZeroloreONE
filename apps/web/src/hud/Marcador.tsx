import type { GameState, PlayerId } from '@zerolore/core';
import { NOMBRE_JUGADOR } from '../partida.ts';

/**
 * Marcador: un solo bloque centrado con el tanteo de los dos bandos y el turno
 * en medio. A quién le toca se dice encendiendo su mitad, sin palabras.
 */
const FASE: Record<GameState['fase'], string> = {
  Iniciativa: 'iniciativa',
  Despliegue: 'despliegue',
  Activaciones: 'batalla',
  FinDeTurno: 'fin del turno',
  Terminada: 'terminada',
};

export function Marcador({ estado, maquinas, onAjustes }: {
  estado: GameState;
  maquinas: Readonly<Record<PlayerId, boolean>>;
  onAjustes: () => void;
}) {
  const juega = estado.jugadorActivo;
  return (
    <header className="marcador">
      <div className="tanteo">
        <div className={`equipo pA ${juega === 'A' ? 'juega' : ''}`}>
          <span className="nombre">{NOMBRE_JUGADOR.A}</span>
          <b className="puntos">{estado.puntos.A ?? 0}</b>
          {maquinas.A && <span className="maquina">CPU</span>}
        </div>
        <div className="centro">
          <span className="turno">Turno {estado.turno}<i>/{estado.turnosTotales}</i></span>
          <span className="fase">{FASE[estado.fase]}</span>
        </div>
        <div className={`equipo pB derecha ${juega === 'B' ? 'juega' : ''}`}>
          {maquinas.B && <span className="maquina">CPU</span>}
          <b className="puntos">{estado.puntos.B ?? 0}</b>
          <span className="nombre">{NOMBRE_JUGADOR.B}</span>
        </div>
      </div>
      <button className="ajustes" onClick={onAjustes} title="Partida">⚙</button>
    </header>
  );
}
