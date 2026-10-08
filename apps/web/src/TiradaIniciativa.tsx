import { useState } from 'react';
import { DadoRodando } from './DadoRodando.tsx';
import { Hoja } from './Hoja.tsx';

/**
 * Ventana de la tirada de Iniciativa. Los dados ruedan y NADA delata al
 * ganador hasta que han parado los dos: ni el subtítulo, ni el resaltado, ni
 * el orden en pantalla, que es siempre azul a la izquierda y rojo a la
 * derecha. Antes se pintaba primero al ganador y la posición ya lo cantaba.
 */
export interface TiradaIniciativaProps {
  readonly tiradas: Readonly<Record<string, number>>;
  readonly orden: readonly string[];
  readonly jugadores: readonly string[];
  readonly ritmo?: number;
  readonly onContinuar: () => void;
}

const NOMBRE: Record<string, string> = { A: 'AZUL', B: 'ROJO' };
const COLOR: Record<string, string> = { A: '#3b82f6', B: '#ef4444' };

export function TiradaIniciativa({ tiradas, orden, jugadores, ritmo = 1, onContinuar }: TiradaIniciativaProps) {
  const [parados, setParados] = useState(0);
  const revelada = parados >= jugadores.length;
  const ganador = orden[0];

  return (
    <Hoja
      titulo="Iniciativa"
      subtitulo={revelada && ganador ? `Empieza ${NOMBRE[ganador] ?? ganador}` : 'Tirando los dados…'}
      onCerrar={onContinuar}
    >
      <div className="dados">
        {jugadores.map((j, i) => {
          const gana = revelada && j === ganador;
          return (
            <div key={j} className={`tirada p${j} ${gana ? 'gana revelada' : ''} ${revelada ? '' : 'pendiente'}`}>
              <span className="jugador">{NOMBRE[j] ?? j}</span>
              <DadoRodando
                valor={tiradas[j] ?? 1}
                color={COLOR[j] ?? '#e5e7eb'}
                // El segundo dado tarda un poco más: una tirada a la vez se lee mejor.
                duracion={(1000 + i * 350) * ritmo}
                alParar={() => setParados((n) => n + 1)}
              />
              <span className="etiqueta">{gana ? 'activa primero' : ' '}</span>
            </div>
          );
        })}
      </div>
      <button className="grande" onClick={onContinuar}>{revelada ? 'Continuar' : 'Saltar'}</button>
    </Hoja>
  );
}
