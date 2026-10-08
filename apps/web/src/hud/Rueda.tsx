import { useState } from 'react';
import type { ActionKind } from '@zerolore/core';
import type { AccionUI } from '../juego.ts';
import { ICONO_ACCION, NOMBRE_ACCION } from '../textos.ts';

/**
 * La rueda de acciones alrededor de la miniatura, como en Zero Company. Las
 * acciones que no se pueden hacer salen apagadas, no escondidas: así se ve qué
 * existe y, al pasar por encima, por qué no se puede.
 *
 * Sin texto fijo: solo iconos, y el nombre al pasar el ratón.
 */
export interface RuedaProps {
  readonly x: number;
  readonly y: number;
  /** Radio de la miniatura en píxeles, para abrir la rueda justo por fuera. */
  readonly radio: number;
  readonly acciones: readonly AccionUI[];
  readonly puedeTerminar: boolean;
  readonly restantes: number;
  readonly onElegir: (a: ActionKind) => void;
  readonly onTerminar: () => void;
}

export function Rueda({ x, y, radio, acciones, puedeTerminar, restantes, onElegir, onTerminar }: RuedaProps) {
  const [encima, setEncima] = useState<string | null>(null);
  const items: { clave: string; icono: string; nombre: string; disponible: boolean; motivo: string | null; coste: number; hacer: () => void }[] = [
    ...acciones.map((a) => ({
      clave: a.kind,
      icono: ICONO_ACCION[a.kind],
      nombre: NOMBRE_ACCION[a.kind],
      disponible: a.disponible,
      motivo: a.motivo,
      coste: a.coste,
      hacer: () => onElegir(a.kind),
    })),
    {
      clave: 'Terminar',
      icono: ICONO_ACCION.Terminar,
      nombre: 'Terminar',
      disponible: puedeTerminar,
      motivo: puedeTerminar ? null : 'aún no ha empezado',
      coste: 0,
      hacer: onTerminar,
    },
  ];
  const r = Math.max(46, radio + 34);
  const elegido = items.find((i) => i.clave === encima);

  return (
    <div className="rueda" style={{ left: x, top: y }}>
      {items.map((it, i) => {
        const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
        return (
          <button
            key={it.clave}
            className={`rueda-boton ${it.disponible ? '' : 'apagada'} ${it.clave === 'Terminar' ? 'terminar' : ''}`}
            style={{ left: Math.cos(a) * r, top: Math.sin(a) * r, animationDelay: `${i * 28}ms` }}
            onPointerEnter={() => setEncima(it.clave)}
            onPointerLeave={() => setEncima(null)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disponible) it.hacer();
            }}
            aria-label={it.nombre}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d={it.icono} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {it.coste === 2 && <span className="coste">2</span>}
          </button>
        );
      })}
      {elegido && (
        <div className="rueda-rotulo" style={{ top: r + 30 }}>
          <b>{elegido.nombre}</b>
          {!elegido.disponible && elegido.motivo && <span>{elegido.motivo}</span>}
        </div>
      )}
      <div className="rueda-acciones" title="Acciones que le quedan">
        {Array.from({ length: 2 }, (_, i) => <i key={i} className={i < restantes ? 'llena' : ''} />)}
      </div>
    </div>
  );
}
