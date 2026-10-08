import { useEffect, useRef, useState } from 'react';
import { Dado } from './Dado.tsx';

/**
 * Un dado que rueda antes de enseñar su resultado.
 *
 * El resultado lo decide el MOTOR —con su semilla, para que deshacer
 * reproduzca las tiradas—; esto es solo el espectáculo. Las caras que pasan
 * mientras rueda son de adorno y por eso pueden salir de `Math.random`: no
 * tocan el estado de la partida.
 *
 * Frena como un dado de verdad: los cambios de cara empiezan rapidísimos y se
 * van espaciando hasta que se clava en el valor.
 */
export interface DadoRodandoProps {
  readonly valor: number;
  readonly color: string;
  readonly tam?: number;
  /** Cuánto dura la tirada, en milisegundos. */
  readonly duracion?: number;
  readonly alParar?: () => void;
}

export function DadoRodando({ valor, color, tam = 64, duracion = 1100, alParar }: DadoRodandoProps) {
  const [cara, setCara] = useState(() => 1 + Math.floor(Math.random() * 6));
  const [rodando, setRodando] = useState(true);
  // Se guarda en un ref para no reiniciar la tirada si el padre re-renderiza.
  const alPararRef = useRef(alParar);
  alPararRef.current = alParar;

  useEffect(() => {
    let cancelado = false;
    let transcurrido = 0;
    let espera = 45;
    let timer: ReturnType<typeof setTimeout>;

    const paso = (): void => {
      if (cancelado) return;
      if (transcurrido >= duracion) {
        setCara(valor);
        setRodando(false);
        alPararRef.current?.();
        return;
      }
      setCara((anterior) => {
        let nueva = anterior;
        while (nueva === anterior) nueva = 1 + Math.floor(Math.random() * 6);
        return nueva;
      });
      transcurrido += espera;
      espera *= 1.16; // cada cambio tarda un poco más: el dado va frenando
      timer = setTimeout(paso, espera);
    };

    timer = setTimeout(paso, espera);
    return () => { cancelado = true; clearTimeout(timer); };
  }, [valor, duracion]);

  return (
    // "rodando" y no "rueda": esa clase es la de la rueda de acciones y le robaba el estilo.
    <span className={`dado-rodando ${rodando ? 'rodando' : 'parado'}`}>
      <Dado valor={cara} color={color} tam={tam} />
    </span>
  );
}
