import { puedeDesplegarEn, type GameState, type Unit } from '@zerolore/core';
import { Ficha } from './Ficha.tsx';

/**
 * Banda lateral de un bando: sus puntos los lleva el marcador, y aquí van sus
 * reservas y la unidad que tenga seleccionada. Cada jugador mira siempre al
 * mismo lado de la pantalla, que es lo que hace legible una partida en local.
 */
export interface RailProps {
  readonly jugador: string;
  readonly state: GameState;
  readonly deTurno: boolean;
  /** En la Fase de Iniciativa las reservas se pueden sacar; el resto del turno no. */
  readonly enDespliegue: boolean;
  readonly refuerzo: string | null;
  readonly onElegirRefuerzo: (id: string | null) => void;
  /** Unidad seleccionada, solo si es de este bando. Sus acciones se pintan
   *  junto a la miniatura, no aquí: en la banda solo va la ficha. */
  readonly unidad: Unit | null;
}

export function Rail({
  jugador, state, deTurno, enDespliegue, refuerzo, onElegirRefuerzo, unidad,
}: RailProps) {
  const reservas = state.reserva.filter((r) => r.owner === jugador);
  const puertas = state.puestos.filter((pm) => puedeDesplegarEn(state, pm, jugador));
  const puestos = state.puestos.filter((pm) => pm.duenio === jugador).length;

  return (
    <aside className={`rail p${jugador} ${deTurno ? 'de-turno' : ''}`}>
      <div className="rail-cabecera">
        <span className="equipo">{jugador === 'A' ? 'AZUL' : 'ROJO'}</span>
        <span className="dato">{puestos} puestos</span>
      </div>

      <section className="rail-reservas">
        <h3>Reservas · {reservas.length}</h3>
        {reservas.length === 0 && <p className="vacio">Todo en mesa</p>}
        {reservas.length > 0 && !enDespliegue && (
          <p className="vacio">Entran en la Fase de Iniciativa</p>
        )}
        {reservas.length > 0 && enDespliegue && puertas.length === 0 && (
          <p className="vacio">Sin puestos libres que controles</p>
        )}
        <div className="fichas">
          {reservas.map((r) => (
            <button
              key={r.id}
              className={`refuerzo ${refuerzo === r.id ? 'elegida' : ''}`}
              disabled={!enDespliegue || !deTurno || puertas.length === 0}
              /*
                pointerDown y no click: así vale tanto arrastrar la ficha hasta
                el puesto como pulsarla y luego tocar el sitio.

                Al tocar, el navegador captura el puntero en el botón y el
                tablero dejaría de enterarse del movimiento: hay que soltarlo
                para que el arrastre llegue hasta la mesa.
              */
              onPointerDown={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                /*
                  Siempre selecciona, nunca alterna: alternando, el segundo
                  intento de arrastrar la MISMA ficha la deseleccionaba y el
                  arrastre no llegaba a ningún sitio. Para soltarla está el
                  botón Cancelar.
                */
                onElegirRefuerzo(r.id);
              }}
            >
              {state.profiles[r.profileId]?.nombre ?? r.profileId}
            </button>
          ))}
        </div>
      </section>

      {unidad && (
        <section className="rail-unidad">
          <Ficha state={state} unidad={unidad} />
        </section>
      )}
    </aside>
  );
}
