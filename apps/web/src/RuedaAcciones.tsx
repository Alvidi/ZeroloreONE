import type { ReactElement } from 'react';
import type { ActionKind } from '@zerolore/core';
import type { AccionDisponible } from './acciones.ts';

/**
 * Rueda de acciones alrededor de la miniatura activada.
 *
 * Se dibuja DENTRO del SVG del tablero, en coordenadas relativas al centro de
 * la unidad, para que acompañe a la miniatura al moverse o al escalar la
 * ventana. Los iconos aparecen escalonados, de ahí la sensación de que la
 * rueda "se despliega".
 *
 * Las acciones que no se pueden hacer se pintan apagadas en vez de
 * desaparecer: así los iconos no bailan de sitio entre activación y
 * activación, y al pasar el ratón se lee el motivo.
 */
export interface RuedaAccionesProps {
  readonly acciones: readonly AccionDisponible[];
  /** Radio de la peana en píxeles, para separar la rueda de la miniatura. */
  readonly radio: number;
  readonly onElegir: (kind: ActionKind) => void;
  readonly onResaltar: (kind: ActionKind | null) => void;
  /** Acción bajo el puntero ahora mismo, para pintar su nombre. */
  readonly resaltada: ActionKind | null;
  /** Cerrar la activación: va en la rueda como una acción más. */
  readonly onTerminar: () => void;
  /**
   * Cuánto hay que correr la rueda para que quepa dentro del tablero. Pegada a
   * un borde, el anillo se salía y los iconos quedaban cortados.
   */
  readonly desplazamiento: { readonly x: number; readonly y: number };
  /**
   * Movimiento hecho pero sin confirmar: en vez de las acciones, la rueda
   * enseña aceptar y deshacer. Es la misma pregunta de antes, sin cuadro ni
   * botones.
   */
  readonly confirmacion: { readonly onAceptar: () => void; readonly onDeshacer: () => void } | null;
}

/** Dibujo de cada acción, en una caja de 24×24 centrada en el origen. */
const ICONOS: Record<ActionKind, ReactElement> = {
  // Bota: un paso.
  Mover: (
    <g>
      <path d="M-5 6 L-5 -3 a3 3 0 0 1 6 0 L1 3 L5 3 L5 6 Z" />
      <circle cx={3.4} cy={-4.6} r={1.5} />
      <circle cx={5.6} cy={-1.8} r={1.4} />
    </g>
  ),
  // Dos galones: velocidad.
  Correr: (
    <g fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M-6 -5 L0 0 L-6 5" />
      <path d="M0 -5 L6 0 L0 5" />
    </g>
  ),
  // Retícula.
  Disparar: (
    <g fill="none" strokeWidth={1.8}>
      <circle cx={0} cy={0} r={5.2} />
      <path d="M0 -8 L0 -5.5 M0 5.5 L0 8 M-8 0 L-5.5 0 M5.5 0 L8 0" strokeLinecap="round" />
      <circle cx={0} cy={0} r={1.1} strokeWidth={0} />
    </g>
  ),
  // Flecha de embestida.
  Cargar: (
    <g fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M-7 0 L4 0" />
      <path d="M0 -4.5 L5.5 0 L0 4.5" />
      <path d="M-7 -4 L-7 4" />
    </g>
  ),
  // Espadas cruzadas, las mismas del combate en el tablero.
  AtacarCaC: (
    <g fill="none" strokeWidth={2} strokeLinecap="round">
      <path d="M-6 6 L6 -6" />
      <path d="M6 6 L-6 -6" />
      <path d="M-6 2 L-2 6 M6 2 L2 6" strokeWidth={2.4} />
    </g>
  ),
  // Cadena rota: salir del combate.
  Destrabarse: (
    <g fill="none" strokeWidth={2} strokeLinecap="round">
      <path d="M-6 -2 a3 3 0 0 0 0 6 L-3 4" />
      <path d="M6 2 a3 3 0 0 0 0 -6 L3 -4" />
      <path d="M-1 -6 L1 -4 M-1 6 L1 4" />
    </g>
  ),
};

/** La rueda arranca arriba y reparte los iconos por todo el círculo. */
const INICIO = -Math.PI / 2;

/** Terminar no es una acción del reglamento, pero se elige igual: va en la rueda. */
const ICONO_TERMINAR = (
  <g fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M-5.5 0 L-1.5 4.5 L6 -4.5" />
  </g>
);

/** Flecha que vuelve sobre sus pasos: deshacer. */
const ICONO_DESHACER = (
  <g fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M-6 -1 a5 5 0 1 1 2 4" />
    <path d="M-6 -5 L-6 -1 L-2 -1" />
  </g>
);

export function RuedaAcciones({
  acciones, radio, onElegir, onResaltar, resaltada, onTerminar, desplazamiento, confirmacion,
}: RuedaAccionesProps) {
  if (acciones.length === 0) return null;
  const distancia = radio + 28;

  /*
    Con un movimiento sin confirmar, la rueda se convierte en la pregunta:
    aceptar o deshacer. Nada más, porque nada más se puede hacer hasta
    responderla.
  */
  if (confirmacion) {
    return (
      <g className="rueda-acciones" transform={`translate(${desplazamiento.x}, ${desplazamiento.y})`}>
        {[
          { clave: 'ok', x: -distancia * 0.72, icono: ICONO_TERMINAR, hacer: confirmacion.onAceptar, clase: 'aceptar' },
          { clave: 'undo', x: distancia * 0.72, icono: ICONO_DESHACER, hacer: confirmacion.onDeshacer, clase: 'deshacer' },
        ].map((b, i) => (
          <g
            key={b.clave}
            className={`rueda-item ${b.clase}`}
            transform={`translate(${b.x}, ${-distancia * 0.72})`}
            style={{ animationDelay: `${i * 50}ms` }}
            onClick={(e) => { e.stopPropagation(); b.hacer(); }}
          >
            <circle className="fondo" cx={0} cy={0} r={14} />
            <g className="icono">{b.icono}</g>
          </g>
        ))}
      </g>
    );
  }

  const total = acciones.length + 1; // las acciones más Terminar
  const separacion = (2 * Math.PI) / total;

  const sitio = (i: number): { x: number; y: number } => {
    const ang = INICIO + i * separacion;
    return { x: Math.cos(ang) * distancia, y: Math.sin(ang) * distancia };
  };

  const señalada = acciones.find((a) => a.kind === resaltada);

  return (
    <g className="rueda-acciones" transform={`translate(${desplazamiento.x}, ${desplazamiento.y})`}>
      {/* Si la rueda se ha corrido, una línea la ata a su miniatura. */}
      {(desplazamiento.x !== 0 || desplazamiento.y !== 0) && (
        <line className="rueda-hilo" x1={-desplazamiento.x} y1={-desplazamiento.y} x2={0} y2={0} />
      )}
      {acciones.map((a, i) => {
        const { x, y } = sitio(i);
        return (
          <g
            key={a.kind}
            className={`rueda-item ${a.disponible ? '' : 'apagada'} ${resaltada === a.kind ? 'resaltada' : ''}`}
            transform={`translate(${x}, ${y})`}
            style={{ animationDelay: `${i * 40}ms` }}
            /*
              El clic no puede subir al grupo de la miniatura: allí se maneja
              "has pulsado una unidad", que reinicia la acción elegida y dejaba
              la rueda sin efecto.
            */
            onClick={(e) => { e.stopPropagation(); if (a.disponible) onElegir(a.kind); }}
            onMouseEnter={() => onResaltar(a.kind)}
            onMouseLeave={() => onResaltar(null)}
          >
            <circle className="fondo" cx={0} cy={0} r={13} />
            <g className="icono">{ICONOS[a.kind]}</g>
            {/* El coste solo se marca cuando cuesta la activación entera. */}
            {a.coste > 1 && <text className="coste" x={9} y={13}>{a.coste}</text>}
          </g>
        );
      })}

      {/* Terminar, cerrando la rueda. */}
      {(() => {
        const { x, y } = sitio(acciones.length);
        return (
          <g
            className="rueda-item terminar"
            transform={`translate(${x}, ${y})`}
            style={{ animationDelay: `${acciones.length * 40}ms` }}
            onClick={(e) => { e.stopPropagation(); onTerminar(); }}
            onMouseEnter={() => onResaltar(null)}
          >
            <circle className="fondo" cx={0} cy={0} r={13} />
            <g className="icono">{ICONO_TERMINAR}</g>
          </g>
        );
      })()}

      {/* Nombre de la acción señalada, debajo de la rueda. */}
      {señalada && (
        /* Solo el nombre: el coste ya lo marca el número del icono, y lo demás
           era texto de relleno. */
        <g className="rueda-nombre" transform={`translate(0, ${distancia + 28})`}>
          <text className="titulo" textAnchor="middle">{señalada.etiqueta}</text>
        </g>
      )}
    </g>
  );
}
