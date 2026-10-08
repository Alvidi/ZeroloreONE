import { puedeDesplegarEn, type GameState, type PlayerId, type Unit } from '@zerolore/core';

/** Icono de clase, el mismo que lleva la miniatura en el tablero. */
const ICONO_CLASE: Record<string, string> = {
  Choque: 'choque.png',
  Elite: 'elite.png',
  Especialista: 'especialista.png',
  Comando: 'comando.png',
  Asaltante: 'asaltante.png',
  ArmasPesadas: 'arma_pesada.png',
  Monstruo: 'mosntruo.png',
  Vehiculo: 'vehiculo.png',
  Artilleria: 'artilleria.png',
  Heroe: 'heroe.png',
};

export interface CompaniaProps {
  readonly jugador: PlayerId;
  readonly state: GameState;
  readonly deTurno: boolean;
  readonly seleccionada: string | null;
  readonly onSeleccionar: (id: string) => void;
  /** Si ahora mismo este jugador puede sacar una unidad de Reserva. */
  readonly puedeDesplegar: boolean;
  readonly refuerzo: string | null;
  readonly onElegirRefuerzo: (id: string | null) => void;
  readonly esMaquina: boolean;
}

/**
 * La compañía de un bando: una fila de fichas, una por unidad, con sus vidas
 * debajo. Es el único sitio donde se ve de un vistazo con qué cuentas, qué has
 * gastado ya este turno y qué te queda en reserva.
 *
 * Va abajo y no en una banda lateral porque las bandas se comían el ancho de
 * la mesa, que es lo único que de verdad hay que mirar.
 */
export function Compania({
  jugador, state, deTurno, seleccionada, onSeleccionar,
  puedeDesplegar, refuerzo, onElegirRefuerzo, esMaquina,
}: CompaniaProps) {
  const enMesa = Object.values(state.units).filter((u) => u.owner === jugador);
  const reservas = state.reserva.filter((r) => r.owner === jugador);
  /** Mientras el Héroe no haya salido, es la única ficha que se puede sacar. */
  const heroe = reservas.find((r) => state.profiles[r.profileId]?.clase === 'Heroe');
  const hayPuerta = state.puestos.some((pm) => puedeDesplegarEn(state, pm, jugador));
  const puestos = state.puestos.filter((pm) => pm.duenio === jugador).length;

  const icono = (profileId: string): string =>
    `/clases/${ICONO_CLASE[state.profiles[profileId]?.clase ?? ''] ?? 'choque.png'}`;

  return (
    <section className={`compania p${jugador} ${deTurno ? 'de-turno' : ''}`}>
      <header>
        <span className="equipo">{jugador === 'A' ? 'AZUL' : 'ROJO'}</span>
        {esMaquina && <span className="maquina">CPU</span>}
        <span className="dato">{puestos} {puestos === 1 ? 'puesto' : 'puestos'}</span>
      </header>

      <div className="tropas">
        {enMesa.map((u) => (
          <FichaTropa
            key={u.id}
            state={state}
            unidad={u}
            icono={icono(u.profileId)}
            seleccionada={seleccionada === u.id}
            activa={state.unidadActiva === u.id}
            onClick={() => onSeleccionar(u.id)}
          />
        ))}

        {reservas.map((r) => {
          const p = state.profiles[r.profileId];
          /*
            Una reserva solo se puede sacar en tu turno, en la Fase de
            Iniciativa, con algún puesto tuyo libre, y empezando por el Héroe.
          */
          const sacable =
            puedeDesplegar && deTurno && hayPuerta && (!heroe || heroe.id === r.id);
          return (
            <button
              key={r.id}
              className={`tropa reserva ${refuerzo === r.id ? 'elegida' : ''} ${sacable ? '' : 'bloqueada'}`}
              title={`${p?.nombre ?? r.profileId} · en reserva`}
              disabled={!sacable}
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
                  arrastre no llegaba a ningún sitio.
                */
                onElegirRefuerzo(r.id);
              }}
            >
              <img src={icono(r.profileId)} alt="" draggable={false} />
              <span className="galones">{Array.from({ length: p?.vidas ?? 0 }, (_, i) => <i key={i} />)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Una ficha de la fila: retrato, vidas y el estado en que está la unidad. */
function FichaTropa({
  state, unidad, icono, seleccionada, activa, onClick,
}: {
  state: GameState;
  unidad: Unit;
  icono: string;
  seleccionada: boolean;
  activa: boolean;
  onClick: () => void;
}) {
  const p = state.profiles[unidad.profileId];
  const muerta = unidad.vidas <= 0;
  const clases = [
    'tropa',
    seleccionada ? 'sel' : '',
    activa ? 'activa' : '',
    muerta ? 'muerta' : '',
    // `activated` es "ya jugó este turno": la que duerme se ve apagada.
    !muerta && unidad.activated ? 'dormida' : '',
    unidad.trabadaCon.length > 0 ? 'trabada' : '',
  ].filter(Boolean).join(' ');

  return (
    <button className={clases} onClick={onClick} title={`${unidad.id} · ${p?.nombre ?? ''}`}>
      <img src={icono} alt="" draggable={false} />
      <span className="galones">
        {Array.from({ length: p?.vidas ?? 0 }, (_, i) => (
          <i key={i} className={i < unidad.vidas ? 'lleno' : ''} />
        ))}
      </span>
      {muerta && <span className="marca">✕</span>}
      {!muerta && unidad.activated && <span className="marca zz">z</span>}
      {!muerta && unidad.trabadaCon.length > 0 && <span className="marca cac">⚔</span>}
    </button>
  );
}
