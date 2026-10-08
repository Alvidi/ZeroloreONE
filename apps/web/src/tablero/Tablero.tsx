import { useEffect, useRef } from 'react';
import { Escena, type DatosEscena, type EventosEscena } from './escena.ts';

/**
 * Monta la escena de PixiJS en un div y le pasa los datos en cada render.
 * La escena se crea una sola vez; los manejadores van por ref para que siempre
 * vean el estado actual sin tener que rehacer el lienzo.
 */
export interface TableroProps {
  readonly datos: DatosEscena;
  readonly eventos: EventosEscena;
  readonly alMontar?: (escena: Escena) => void;
}

export function Tablero({ datos, eventos, alMontar }: TableroProps) {
  const caja = useRef<HTMLDivElement>(null);
  const escena = useRef<Escena | null>(null);
  const eventosRef = useRef(eventos);
  eventosRef.current = eventos;
  const datosRef = useRef(datos);
  datosRef.current = datos;

  useEffect(() => {
    let cancelado = false;
    const el = caja.current;
    if (!el) return undefined;
    // React en modo estricto monta dos veces: la primera escena se tira si llega tarde.
    void Escena.crear(el, {
      alPulsar: (...a) => eventosRef.current.alPulsar(...a),
      alMover: (...a) => eventosRef.current.alMover(...a),
      alSoltar: (...a) => eventosRef.current.alSoltar(...a),
    }).then((e) => {
      if (cancelado) {
        e.destruir();
        return;
      }
      escena.current = e;
      e.actualizar(datosRef.current);
      alMontar?.(e);
    });
    return () => {
      cancelado = true;
      escena.current?.destruir();
      escena.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    escena.current?.actualizar(datos);
  }, [datos]);

  return <div ref={caja} className="tablero" />;
}
