import { useEffect, useRef, useState } from 'react';
import { DadoRodando } from '../DadoRodando.tsx';

/**
 * Una tirada suelta de un dado —carga, destrabarse— en mitad de la mesa. Rueda,
 * se para, dice si sale y se va sola.
 */
export function TiradaRapida({ titulo, valor, necesita, color, ritmo = 1, onTerminar }: {
  titulo: string;
  valor: number;
  necesita: number;
  color: string;
  ritmo?: number;
  onTerminar: () => void;
}) {
  const [parado, setParado] = useState(false);
  const terminar = useRef(onTerminar);
  terminar.current = onTerminar;
  const exito = valor >= necesita;

  useEffect(() => {
    if (!parado) return undefined;
    const t = setTimeout(() => terminar.current(), 900 * ritmo);
    return () => clearTimeout(t);
  }, [parado, ritmo]);

  return (
    <div className="tirada-rapida" onClick={() => terminar.current()}>
      <div className={`caja ${parado ? (exito ? 'exito' : 'fallo') : ''}`}>
        <span className="titulo">{titulo}</span>
        <DadoRodando valor={valor} color={color} tam={72} duracion={800 * ritmo} alParar={() => setParado(true)} />
        <span className="necesita">{necesita}+</span>
        <b className="resultado">{parado ? (exito ? '¡Sale!' : 'Falla') : ' '}</b>
      </div>
    </div>
  );
}
