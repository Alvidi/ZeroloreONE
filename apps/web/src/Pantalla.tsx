import type { ReactNode } from 'react';

/**
 * Pantalla superpuesta al tablero. Las fases del turno se presentan aquí en
 * lugar de en el panel lateral, para que el juego ocurra en la pantalla y no
 * en una barra de herramientas.
 */
export function Pantalla({
  titulo,
  subtitulo,
  children,
  acciones,
  lateral = false,
}: {
  titulo: string;
  subtitulo?: string;
  children?: ReactNode;
  acciones?: ReactNode;
  /**
   * Panel lateral en vez de pantalla completa. La Fase de Iniciativa lo usa:
   * ahí hay que poder mirar las unidades y sus fichas antes de tirar, y una
   * pantalla que tapa el tablero lo impide.
   */
  lateral?: boolean;
}) {
  return (
    <div className={lateral ? 'pantalla lateral' : 'pantalla'}>
      <div className="pantalla-caja">
        <h2>{titulo}</h2>
        {subtitulo && <p className="sub">{subtitulo}</p>}
        {children}
        <div className="pantalla-acciones">{acciones}</div>
      </div>
    </div>
  );
}
