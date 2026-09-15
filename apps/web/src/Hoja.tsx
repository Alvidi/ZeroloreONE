import type { ReactNode } from 'react';

/**
 * Panel que se abre encima del tablero, se lee y se cierra. En móvil sube
 * desde el borde de abajo ocupando el ancho; en escritorio se queda centrado.
 *
 * Todo lo que no es "mirar la mesa" o "mover la unidad de turno" vive aquí:
 * así no hay paneles permanentes robándole sitio al tablero, que es lo que no
 * aguanta una pantalla de móvil.
 */
export interface HojaProps {
  readonly titulo: string;
  readonly subtitulo?: string;
  /** Sin `onCerrar` la hoja no se puede descartar: para finales de partida. */
  readonly onCerrar?: () => void;
  readonly children: ReactNode;
}

export function Hoja({ titulo, subtitulo, onCerrar, children }: HojaProps) {
  return (
    <div className="hoja-fondo" onClick={onCerrar}>
      <div className="hoja" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>{titulo}</h2>
            {subtitulo && <p className="sub">{subtitulo}</p>}
          </div>
          {onCerrar && (
            <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
          )}
        </header>
        <div className="hoja-cuerpo">{children}</div>
      </div>
    </div>
  );
}
