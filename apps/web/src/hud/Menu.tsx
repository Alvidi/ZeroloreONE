/**
 * Pantalla de inicio: jugar contra la máquina o mirar cómo juegan dos
 * máquinas. Lo segundo sirve para ver qué hace la IA y si las reglas se
 * sostienen sin tocar nada.
 */
export type Modalidad = 'humano-maquina' | 'maquina-maquina';

export interface MenuProps {
  readonly rapido: boolean;
  readonly onRapido: (v: boolean) => void;
  readonly onEmpezar: (m: Modalidad) => void;
  /** Si hay una partida a medias, se puede volver a ella. */
  readonly onSeguir: (() => void) | null;
}

export function Menu({ rapido, onRapido, onEmpezar, onSeguir }: MenuProps) {
  return (
    <div className="menu">
      <div className="menu-caja">
        <img className="menu-logo" src="logo.svg" alt="ZeroLore" draggable={false} />
        <span className="menu-modo">Guerra Total · prototipo</span>

        <div className="menu-opciones">
          <button className="menu-boton principal" onClick={() => onEmpezar('humano-maquina')}>
            <span className="icono">
              <svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </span>
            <span className="texto">
              <b>Tú contra la máquina</b>
              <i>Llevas a Azul; la IA lleva a Rojo</i>
            </span>
          </button>

          <button className="menu-boton" onClick={() => onEmpezar('maquina-maquina')}>
            <span className="icono">
              <svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 4h8v6H8zM5 14h14v6H5zM12 10v4M9 7h.01M15 7h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="texto">
              <b>Máquina contra máquina</b>
              <i>Mira qué hace la IA, sin tocar nada</i>
            </span>
          </button>

          {onSeguir && (
            <button className="menu-boton secundario" onClick={onSeguir}>
              <span className="texto"><b>Volver a la partida</b></span>
            </button>
          )}
        </div>

        <label className="menu-ritmo">
          <input type="checkbox" checked={rapido} onChange={(e) => onRapido(e.target.checked)} />
          <span>Ritmo rápido <i>animaciones y turnos de la IA más cortos</i></span>
        </label>
      </div>
    </div>
  );
}
