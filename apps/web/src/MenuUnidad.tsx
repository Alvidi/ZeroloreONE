import type { ActionKind, GameState, Unit, UnitProfile } from '@zerolore/core';
import { HABILIDADES_ACTIVAS } from './setup.ts';
import type { AccionDisponible } from './acciones.ts';

/**
 * Acciones de la unidad seleccionada. Se pinta junto a la miniatura, abriéndose
 * hacia el lado con sitio para no salirse del tablero, y SOLO enseña lo que esa
 * unidad puede hacer ahora mismo: una lista con la mitad en gris se lee peor
 * que una lista corta. De momento solo
 * acciones de ataque volverán cuando el movimiento esté cerrado.
 */
export interface MenuUnidadProps {
  readonly state: GameState;
  readonly unidad: Unit;
  readonly perfil: UnitProfile;
  /** Posición en porcentaje del tablero. */

  readonly onActivar: () => void;
  readonly onTerminar: () => void;
  readonly onCerrar: () => void;
  /**
   * Solo se pasa cuando lo último que hizo ESTA unidad fue moverse. Colocar
   * una miniatura deja así de ser definitivo: se puede probar una posición y
   * devolverla a donde estaba.
   */
  readonly onDeshacerMovimiento?: (() => void) | undefined;
  /** Confirma la posición y retira la opción de deshacer. */
  readonly onConfirmarPosicion?: (() => void) | undefined;
  /** Distancia del movimiento que se desharía, para decirlo en el botón. */
  readonly distanciaDeshacer?: number | undefined;
  /** Las seis acciones con su disponibilidad real. */
  readonly acciones: readonly AccionDisponible[];
  /** Acción elegida: filtra los anillos del tablero. */
  readonly accionElegida: ActionKind | null;
  readonly onElegirAccion: (kind: ActionKind | null) => void;
  /** El ratón sobre una acción enseña su aura sin llegar a elegirla. */
  readonly onResaltarAccion: (kind: ActionKind | null) => void;
  /**
   * Mientras se coloca la unidad el panel se ancla a una esquina: flotando
   * junto a la miniatura tapaba justo la zona a la que se quiere mover.
   */
  /**
   * Dónde se pinta. `null` = fijo en la banda del bando. Con posición, sale
   * flotando junto a la miniatura, abriéndose hacia el lado donde hay sitio.
   */
  readonly anclaje: { readonly x: number; readonly y: number; readonly lado: 'izq' | 'der' } | null;
  /** Armas a distancia con sus objetivos válidos, al elegir Disparar. */
  readonly armaElegida: string | null;
  readonly onElegirArma: (nombre: string | null) => void;
  readonly objetivosPorArma: Readonly<Record<string, readonly string[]>>;
  /** Objetivo marcado en el tablero, pendiente de confirmar el disparo. */
  readonly objetivoElegido: string | null;
  readonly onDisparar: () => void;
  readonly onCargar: () => void;
  readonly onAtacarCaC: () => void;
  readonly onDestrabarse: () => void;
}

export function MenuUnidad({
  state, unidad, perfil, onActivar, onTerminar, onCerrar,
  onDeshacerMovimiento, onConfirmarPosicion, distanciaDeshacer,
  acciones, accionElegida, onElegirAccion, onResaltarAccion, anclaje,
  armaElegida, onElegirArma, objetivosPorArma, objetivoElegido, onDisparar, onCargar, onAtacarCaC, onDestrabarse,
}: MenuUnidadProps) {
  const esActiva = state.unidadActiva === unidad.id;
  const suTurno = unidad.owner === state.jugadorActivo;
  const accionEnCurso = accionElegida === 'Mover' || accionElegida === 'Correr';
  const objetivosArma = (armaElegida ? objetivosPorArma[armaElegida] : undefined) ?? [];
  /** Resumen del arma a distancia, para verlo mientras se apunta. */
  const armaRanged = perfil.armas.find((w) => w.kind === 'disparo');
  const perfilArma =
    armaRanged?.kind === 'disparo'
      ? `${armaRanged.distancia}" · ${armaRanged.precision === null ? 'auto' : `${armaRanged.precision}+`} · ${armaRanged.danio}/${armaRanged.danioCritico}`
      : null;

  return (
    <div
      className={`menu-unidad bando-${unidad.owner}${anclaje ? ` junto-a ${anclaje.lado}` : ' fijo'}`}
      style={anclaje ? { left: `${anclaje.x}%`, top: `${anclaje.y}%` } : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header>
        <b>{unidad.id}</b> {perfil.nombre}
        {/* Sin cerrar mientras está activada: la activación se termina con
            "Terminar", no cerrando el panel. */}
        {!esActiva && (
          <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        )}
      </header>

      {esActiva ? (
        <>
          <p className="acciones-restantes">
            {unidad.accionesRestantes} {unidad.accionesRestantes === 1 ? 'acción' : 'acciones'}
          </p>

          {/*
            Tres estados durante la activación, uno cada vez:
            1. Acaba de moverse  -> solo Posicionado / Deshacer.
            2. Acción en curso   -> el desplegable se aparta para dejar mover.
            3. En reposo         -> la lista de las seis acciones.
          */}
          {onDeshacerMovimiento ? (
            <>
              {distanciaDeshacer !== undefined && (
                <p className="nota">Movida {distanciaDeshacer.toFixed(1)}". ¿La dejas ahí?</p>
              )}
              <div className="par">
                <button className="accion confirmar" onClick={onConfirmarPosicion}>
                  ✓ Posicionado
                </button>
                <button className="accion deshacer" onClick={onDeshacerMovimiento}>
                  ↶ Deshacer
                </button>
              </div>
            </>
          ) : accionElegida === 'Disparar' ? (
            <>
              {/* Un solo botón: el título "Disparar" ya lo lleva él mismo. */}
              {armaElegida && (
                <p className="nota">
                  <b>{armaElegida}</b>
                  {perfilArma && ` · ${perfilArma}`}
                </p>
              )}
              <button
                className="accion principal"
                disabled={!objetivoElegido}
                onClick={onDisparar}
              >
                {objetivoElegido
                  ? `Disparar a ${objetivoElegido}`
                  : `Elige objetivo: ${objetivosArma.join(', ')}`}
              </button>
              <button className="accion" onClick={() => onElegirAccion(null)}>
                Cancelar
                <span className="perfil">o clic derecho en el tablero</span>
              </button>
            </>
          ) : accionElegida === 'Cargar' ? (
            <>
              <p className="nota">
                Alcance de carga <b>{perfil.movimiento + perfil.velocidad}"</b> · éxito con 3+
              </p>
              <button className="accion principal" disabled={!objetivoElegido} onClick={onCargar}>
                {objetivoElegido ? `Cargar contra ${objetivoElegido}` : 'Elige a quién cargar'}
              </button>
              <button className="accion" onClick={() => onElegirAccion(null)}>
                Cancelar
                <span className="perfil">o clic derecho en el tablero</span>
              </button>
            </>
          ) : accionElegida === 'AtacarCaC' ? (
            <>
              <p className="nota">
                {unidad.ataqueGratuitoContra
                  ? 'Ataque gratuito de la carga · no consume acciones'
                  : `Trabada con ${unidad.trabadaCon.join(', ')}`}
              </p>
              <button className="accion principal" disabled={!objetivoElegido} onClick={onAtacarCaC}>
                {objetivoElegido ? `Atacar a ${objetivoElegido}` : 'Elige a quién atacar'}
              </button>
              <button className="accion" onClick={() => onElegirAccion(null)}>
                Cancelar
                <span className="perfil">o clic derecho en el tablero</span>
              </button>
            </>
          ) : accionElegida === 'Destrabarse' ? (
            <>
              <p className="nota">
                Trabada con {unidad.trabadaCon.join(', ')}. Con <b>4+</b> se libera y conserva
                su acción restante; con 1, 2 o 3 pierde la activación.
              </p>
              <button className="accion principal" onClick={onDestrabarse}>
                Intentar destrabarse
              </button>
              <button className="accion" onClick={() => onElegirAccion(null)}>
                Cancelar
                <span className="perfil">o clic derecho en el tablero</span>
              </button>
            </>
          ) : accionEnCurso ? (
            <>
              <p className="en-curso">
                <b>{accionElegida === 'Correr' ? 'Correr' : 'Mover'}</b>
                <span>
                  {accionElegida === 'Correr'
                    ? 'Haz clic dentro de la corona turquesa para colocarla.'
                    : 'Haz clic donde quieras colocarla.'}
                </span>
              </p>
              <button className="accion" onClick={() => onElegirAccion(null)}>
                Cancelar
                <span className="perfil">o clic derecho en el tablero</span>
              </button>
            </>
          ) : (
            <>
              <ul className="lista-acciones">
                {acciones.filter((a) => a.disponible).map((a) => (
                  <li key={a.kind}>
                    <button
                      className="accion-item"
                      onClick={() => onElegirAccion(a.kind)}
                      onMouseEnter={() => onResaltarAccion(a.kind)}
                      onMouseLeave={() => onResaltarAccion(null)}
                      onFocus={() => onResaltarAccion(a.kind)}
                      onBlur={() => onResaltarAccion(null)}
                    >
                      <span className="nombre">{a.etiqueta}</span>
                      <span className="coste">{a.coste}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button className="accion terminar" onClick={onTerminar}>Terminar</button>
            </>
          )}
        </>
      ) : (
        <>
          {unidad.activated && <p className="nota">Ya se activó este turno.</p>}
          {/* Sin jugador activo aún es que falta tirar iniciativa, no que le toque a otro. */}
          {!unidad.activated && !suTurno && (
            <p className="nota">
              {state.jugadorActivo ? `Le toca a ${state.jugadorActivo}.` : 'El turno aún no ha empezado.'}
            </p>
          )}
          <button
            className="accion principal"
            disabled={unidad.activated || !suTurno || state.fase !== 'Activaciones'}
            onClick={onActivar}
          >
            Activar
          </button>
        </>
      )}
    </div>
  );
}
