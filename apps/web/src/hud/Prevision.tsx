import { formatCantidad, type GameState, type Prevision as PrevisionMotor, type Unidad } from '@zerolore/core';
import { CSS_JUGADOR, NOMBRE_JUGADOR, iconoDe } from '../partida.ts';
import { colorVida } from '../vida.ts';
import { rotulo, vidaDe } from './nombres.ts';

/**
 * Previsión del enfrentamiento, como en Fire Emblem: quién ataca a quién y qué
 * cabe esperar, con las cuentas hechas antes de tocar los dados. Los números
 * salen del motor, con los mismos parámetros que la tirada de verdad.
 */
export interface PrevisionProps {
  readonly estado: GameState;
  readonly atacante: Unidad;
  readonly objetivo: Unidad;
  readonly modo: 'disparo' | 'cac' | 'carga';
  readonly prevision: PrevisionMotor;
  /** `null` mientras solo se pasa el ratón: aún no hay nada que confirmar. */
  readonly onConfirmar: (() => void) | null;
  readonly onCancelar: () => void;
}

const pct = (p: number): string => `${Math.round(p * 100)}%`;
const cifra = (n: number): string => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

export function Prevision({ estado, atacante, objetivo, modo, prevision, onConfirmar, onCancelar }: PrevisionProps) {
  const p = prevision;
  const verbo = modo === 'disparo' ? 'Disparar' : modo === 'carga' ? 'Cargar' : 'Atacar';
  return (
    <div className="prevision">
      <Lado estado={estado} u={atacante} />
      <div className="cuentas">
        {modo === 'carga' && <div className="aviso-carga">Carga: prende con 3+ <b>67%</b></div>}
        <div className="titular">
          <span className="etiqueta">daño previsto</span>
          <b className="grande">{cifra(p.danioMedio)}</b>
          {p.minisObjetivo > 1 && <span className="rango">caen ~{cifra(p.bajasMedias)} de {p.minisObjetivo}</span>}
        </div>
        <div className="probabilidades">
          <span>la toca <b>{pct(p.pTocar)}</b></span>
          <span className={p.pDestruir > 0.5 ? 'mata' : ''}>la destruye <b>{pct(p.pDestruir)}</b></span>
        </div>
        <div className="partes">
          {p.partes.map((parte, i) => (
            <div className="parte" key={i}>
              <span className="quien">{p.partes.length > 1 ? (i === 0 ? 'Tropa' : 'Comandante') : ''}</span>
              <span>
                {parte.dados.min === parte.dados.max ? parte.dados.min : `${parte.dados.min}–${parte.dados.max}`}
                <i> dados</i>
              </span>
              <span>
                {parte.parametros.umbralImpacto === null ? 'auto' : `${parte.parametros.umbralImpacto}+`}
                <i> {pct(parte.pImpacto)}</i>
              </span>
              <span>salva {parte.parametros.salvacion}+</span>
              <span className="media">~{cifra(parte.danioMedio)}</span>
            </div>
          ))}
        </div>
        <div className="chapas">
          {[...new Set(p.partes.flatMap((x) => x.parametros.notas))].map((n) => (
            <span key={n} className={claseNota(n)}>{n}</span>
          ))}
        </div>
        {onConfirmar && (
          <div className="botones">
            <button className="confirmar" onClick={onConfirmar}>✓ {verbo}</button>
            <button className="cancelar" onClick={onCancelar} title="Elegir otra cosa">↩</button>
          </div>
        )}
      </div>
      <Lado estado={estado} u={objetivo} derecha />
    </div>
  );
}

function claseNota(n: string): string {
  if (n.startsWith('Ventaja') || n.startsWith('Disparo certero') || n.startsWith('Carga brutal') || n.startsWith('Atrincherado')) return 'favor';
  if (n.startsWith('Cobertura') || n.startsWith('En cobertura') || n.startsWith('Berserker')) return 'contra';
  return '';
}

function Lado({ estado, u, derecha }: { estado: GameState; u: Unidad; derecha?: boolean }) {
  const r = rotulo(u);
  const v = vidaDe(estado, u);
  const f = v.maximas > 0 ? v.actuales / v.maximas : 0;
  return (
    <div className={`bando ${derecha ? 'derecha' : ''}`} style={{ ['--equipo' as string]: CSS_JUGADOR[u.owner] }}>
      <img className="retrato" src={iconoDe(r.tipoId)} alt="" draggable={false} />
      <div className="datos">
        <span className="quien"><i>{NOMBRE_JUGADOR[u.owner]}</i> <b>{r.titulo}</b></span>
        {r.detalle && <span className="detalle">{r.detalle}</span>}
        <div className="vida">
          <div className="barra"><div style={{ width: `${f * 100}%`, background: colorVida(v.actuales, v.maximas) }} /></div>
          <span className="cifras">{v.actuales}<i>/{v.maximas}</i></span>
        </div>
      </div>
    </div>
  );
}

export { formatCantidad };
