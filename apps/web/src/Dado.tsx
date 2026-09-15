/** Cara de un D6 dibujada con puntos, para mostrar tiradas en pantalla. */
const PUNTOS: Record<number, readonly (readonly [number, number])[]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

export function Dado({ valor, tam = 64, color = '#e5e7eb' }: {
  valor: number;
  tam?: number;
  color?: string;
}) {
  const puntos = PUNTOS[valor] ?? [];
  return (
    <svg width={tam} height={tam} viewBox="0 0 100 100" className="dado" aria-label={`Dado: ${valor}`}>
      <rect x={4} y={4} width={92} height={92} rx={16} fill="#0f151d" stroke={color} strokeWidth={3} />
      {puntos.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={9} fill={color} />
      ))}
    </svg>
  );
}
