import { useState } from 'react';
import { formatCantidad, type TipoUnidad } from '@zerolore/core';
import { TIPOS, iconoDe } from '../partida.ts';
import { HABILIDAD_UNIDAD } from '../textos.ts';
import {
  ESTILOS,
  HABILIDAD_PENDIENTE,
  PRESUPUESTOS,
  anadir,
  avisos,
  listaAleatoria,
  ordenar,
  problemas,
  valorDe,
  valorFila,
  type Fila,
} from '../ejercito.ts';

/**
 * La armería: aquí se elige qué te llevas a la batalla, nada más. Las
 * escuadras se forman en la mesa: despliegas un Comandante y le arrastras
 * soldados sueltos hasta el máximo de su tipo.
 */
/** 'espejo' (tu misma lista), 'azar', o el id de un estilo. */
export type Rival = 'espejo' | 'azar' | string;

export interface ArmeriaProps {
  readonly filas: readonly Fila[];
  readonly presupuesto: number;
  readonly rival: Rival;
  readonly onCambiar: (filas: Fila[], presupuesto: number, rival: Rival) => void;
  readonly onVolver: () => void;
  readonly onJugar: () => void;
}

export function Armeria({ filas, presupuesto, rival, onCambiar, onVolver, onJugar }: ArmeriaProps) {
  const [detalle, setDetalle] = useState<string | null>(null);
  const valor = valorDe(filas);
  const fallos = problemas(filas, presupuesto);
  const comandantes = Object.values(TIPOS).filter((t) => t.esComandante);
  const tropas = Object.values(TIPOS).filter((t) => !t.esComandante);

  const notas = avisos(filas);
  const poner = (f: Fila[]): void => onCambiar(ordenar(f), presupuesto, rival);
  const cambiarCantidad = (id: string, cantidad: number): void =>
    poner(filas.map((f) => (f.id === id ? { ...f, cantidad } : f)));
  const quitar = (id: string): void => poner(filas.filter((f) => f.id !== id));

  const mirado = detalle ? TIPOS[detalle] : undefined;

  return (
    <div className="armeria">
      <header className="armeria-cabecera">
        <button className="volver" onClick={onVolver}>← Menú</button>
        <h1>Prepara tu ejército</h1>
        <div className="derecha">
          <button className="aleatorio" onClick={() => poner(listaAleatoria(presupuesto))} title="Una lista al azar que tenga sentido: Comandantes con su tropa">
            🎲 Aleatorio
          </button>
          <div className={`valor ${valor > presupuesto ? 'pasado' : ''}`}>
            <b>{valor}</b>
            <span>/</span>
            <select value={presupuesto} onChange={(e) => onCambiar([...filas], Number(e.target.value), rival)}>
              {PRESUPUESTOS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <i>Valor</i>
          </div>
        </div>
      </header>

      <div className="armeria-cuerpo">
        <section className="catalogo">
          <h3>Comandantes <i>lideran escuadras</i></h3>
          <div className="cartas-catalogo">
            {comandantes.map((t) => (
              <CartaCatalogo key={t.id} t={t} onAnadir={() => poner(anadir(filas, t.id))} onMirar={() => setDetalle(t.id)} />
            ))}
          </div>
          <h3>Unidades <i>van solas o se unen a un Comandante en la mesa</i></h3>
          <div className="cartas-catalogo">
            {tropas.map((t) => (
              <CartaCatalogo key={t.id} t={t} onAnadir={() => poner(anadir(filas, t.id))} onMirar={() => setDetalle(t.id)} />
            ))}
          </div>
          {mirado && <PerfilMirado t={mirado} />}
        </section>

        <section className="lista">
          <h3>Tu lista <i>{filas.length === 0 ? 'añade algo del catálogo' : `${valor} de Valor`}</i></h3>
          <div className="filas">
            {filas.map((f) => {
              const t = TIPOS[f.tipoId]!;
              const detalleFila = t.esComandante
                ? 'lidera una escuadra de un solo tipo'
                : t.escuadra !== null
                  ? `escuadras de hasta ${t.escuadra} · ${t.valor} cada una`
                  : `va siempre sola · ${t.valor} cada una`;
              return (
                <div key={f.id} className={`fila ${t.esComandante ? 'comandante' : ''}`}>
                  {t.esComandante && <span className="corona">★</span>}
                  <img src={iconoDe(f.tipoId)} alt="" />
                  <div className="nombre">
                    <b>{t.nombre}</b>
                    <i>{detalleFila}</i>
                  </div>
                  <Contador valor={f.cantidad} min={1} max={t.esComandante ? 4 : 24} onCambiar={(n) => cambiarCantidad(f.id, n)} />
                  <span className="subtotal">{valorFila(f)}</span>
                  <button className="quitar" onClick={() => quitar(f.id)} aria-label="Quitar">✕</button>
                </div>
              );
            })}
          </div>

          <p className="como-escuadras">
            <b>Las escuadras se forman en la mesa.</b> En el despliegue pones un Comandante en tu puesto y le
            arrastras soldados de la Reserva, todos del mismo tipo y hasta su máximo.
          </p>
          {notas.map((n) => <p key={n} className="nota">{n}</p>)}

          <div className="rival">
            <h3>Rival <i>lo lleva la máquina</i></h3>
            <div className="opciones-rival">
              <button className={rival === 'espejo' ? 'elegido' : ''} onClick={() => onCambiar([...filas], presupuesto, 'espejo')}
                title="La misma lista que la tuya: lo más justo para probar">
                Espejo
              </button>
              <button className={rival === 'azar' ? 'elegido' : ''} onClick={() => onCambiar([...filas], presupuesto, 'azar')}
                title="Una lista aleatoria con sentido, distinta cada partida">
                Al azar
              </button>
              {ESTILOS.map((e) => (
                <button key={e.id} className={rival === e.id ? 'elegido' : ''} onClick={() => onCambiar([...filas], presupuesto, e.id)} title={e.descripcion}>
                  {e.nombre}
                </button>
              ))}
            </div>
          </div>

          {fallos.length > 0 && (
            <ul className="fallos">{fallos.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <button className="jugar" disabled={fallos.length > 0} onClick={onJugar}>¡A la batalla!</button>
        </section>
      </div>
    </div>
  );
}

function CartaCatalogo({ t, onAnadir, onMirar }: { t: TipoUnidad; onAnadir: () => void; onMirar: () => void }) {
  const pendiente = HABILIDAD_PENDIENTE.has(t.habilidad);
  return (
    <button className="carta-catalogo" onClick={onAnadir} onPointerEnter={onMirar} title={`Añadir ${t.nombre}`}>
      <img src={iconoDe(t.id)} alt="" />
      <b>{t.nombre}</b>
      <span className="valor">{t.valor}</span>
      {t.escuadra !== null && !t.esComandante && <span className="esc">esc. {t.escuadra}</span>}
      {pendiente && <span className="pendiente" title="Su habilidad aún no está programada">●</span>}
      <span className="mas">+</span>
    </button>
  );
}

function Contador({ valor, min, max, onCambiar }: { valor: number; min: number; max: number; onCambiar: (n: number) => void }) {
  return (
    <span className="contador">
      <button disabled={valor <= min} onClick={() => onCambiar(valor - 1)}>−</button>
      <b>{valor}</b>
      <button disabled={valor >= max} onClick={() => onCambiar(valor + 1)}>+</button>
    </span>
  );
}

/** El perfil del tipo bajo el ratón, para decidir sin abrir el reglamento. */
function PerfilMirado({ t }: { t: TipoUnidad }) {
  return (
    <div className="perfil-mirado">
      <img src={iconoDe(t.id)} alt="" />
      <div>
        <b>{t.nombre}</b> <i>{t.descripcion}</i>
        <div className="valores">
          <span>Mov <b>{t.movimiento === null ? '—' : `${t.movimiento}"`}</b></span>
          <span>Vel <b>+{t.velocidad}"</b></span>
          <span>Vidas <b>{t.vidas}</b></span>
          <span>Salv <b>{t.salvacion}+</b></span>
          {t.escuadra !== null && <span>Escuadra <b>{t.escuadra}</b></span>}
          <span>Valor <b>{t.valor}</b></span>
        </div>
        <div className="armas">
          {t.disparo && <span>➳ {formatCantidad(t.disparo.ataques)} · {t.disparo.distancia}" · {t.disparo.precision === null ? 'auto' : `${t.disparo.precision}+`} · {t.disparo.danio}/{t.disparo.danioCritico} {t.disparo.habilidades.filter((h) => h !== 'Fiable').join(', ')}</span>}
          {t.cac && <span>⚔ {formatCantidad(t.cac.ataques)} · {t.cac.danio}/{t.cac.danioCritico} {t.cac.habilidades.filter((h) => h !== 'Fiable').join(', ')}</span>}
        </div>
        <div className="habilidad">
          <b>{t.habilidad}</b> {HABILIDAD_UNIDAD[t.habilidad] ?? ''}
          {HABILIDAD_PENDIENTE.has(t.habilidad) && <em> (aún sin programar)</em>}
        </div>
        {t.ventajas.length > 0 && (
          <div className="ventajas">
            Ventaja: {t.ventajas.map((v) => `+${v.bonus} contra ${TIPOS[v.tipoId]?.nombre ?? v.tipoId}`).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
