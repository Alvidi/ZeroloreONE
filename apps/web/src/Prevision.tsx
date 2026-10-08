import {
  preverAtaque,
  type GameState,
  type MeleeWeapon,
  type RangedWeapon,
  type Unit,
} from '@zerolore/core';
import { HABILIDADES_ARMA } from './setup.ts';
import { nombreHabilidad, reglaHabilidad } from './habilidades.ts';
import { colorVida } from './vida.ts';

/** Icono de clase, el mismo que lleva la miniatura en el tablero. */
const ICONO_CLASE: Record<string, string> = {
  Choque: 'choque.png',
  Elite: 'elite.png',
  Especialista: 'especialista.png',
  Comando: 'comando.png',
  Asaltante: 'asaltante.png',
  ArmasPesadas: 'arma_pesada.png',
  Monstruo: 'mosntruo.png',
  Vehiculo: 'vehiculo.png',
  Artilleria: 'artilleria.png',
  Heroe: 'heroe.png',
};

const pct = (p: number): string => `${Math.round(p * 100)}%`;
/** Un decimal, pero sin el ",0" cuando sale redondo. */
const cifra = (n: number): string => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

export interface PrevisionProps {
  readonly state: GameState;
  readonly atacante: Unit;
  readonly objetivo: Unit;
  readonly arma: RangedWeapon | MeleeWeapon;
  readonly enCobertura: boolean;
  readonly onConfirmar: () => void;
  readonly onCancelar: () => void;
}

/**
 * Previsión del enfrentamiento: quién ataca a quién y qué cabe esperar, con las
 * cuentas hechas antes de tocar los dados.
 *
 * Los números salen del motor (`preverAtaque`), no de una fórmula aparte: si la
 * previsión y la resolución dijeran cosas distintas, el jugador dejaría de
 * fiarse de las dos.
 */
export function Prevision({
  state, atacante, objetivo, arma, enCobertura, onConfirmar, onCancelar,
}: PrevisionProps) {
  const pa = state.profiles[atacante.profileId];
  const po = state.profiles[objetivo.profileId];
  if (!pa || !po) return null;

  const p = preverAtaque(arma, pa, po, {
    enCobertura,
    vidasObjetivo: objetivo.vidas,
    habilidadesArma: HABILIDADES_ARMA,
  });

  const icono = (clase: string): string => `/clases/${ICONO_CLASE[clase] ?? 'choque.png'}`;
  const precision = p.directo ? 'auto' : p.erratica ? '1D6' : `${p.umbralImpacto}+`;

  return (
    <div className="prevision">
      <Bando
        lado="atacante"
        unidad={atacante}
        nombre={pa.nombre}
        clase={pa.clase}
        vidasMax={pa.vidas}
        icono={icono(pa.clase)}
        pie={arma.nombre}
      />

      <div className="cuentas">
        <div className="titular">
          <span className="etiqueta">daño previsto</span>
          <b className="grande">{cifra(p.danioMedio)}</b>
          <span className="rango">de {objetivo.vidas} vidas</span>
        </div>

        <dl>
          <div>
            <dt>Impacta</dt>
            <dd>{pct(p.pImpacto)} <i>{precision}</i></dd>
          </div>
          <div>
            <dt>Salva</dt>
            <dd>
              {pct(p.pSalvacion)} <i>{p.umbralSalvacion}+</i>
            </dd>
          </div>
          <div className={p.pMatar > 0.5 ? 'mata' : ''}>
            <dt>La tumba</dt>
            <dd>{pct(p.pMatar)}</dd>
          </div>
        </dl>

        <div className="modificadores">
          <span className="ataques">
            {p.ataques.min === p.ataques.max ? p.ataques.min : `${p.ataques.min}–${p.ataques.max}`} ataques
          </span>
          {enCobertura && (
            <span className="mod contra" title={
              arma.kind === 'disparo'
                ? 'El objetivo está en cobertura: mejora su Salvación en 1'
                : 'El objetivo está en cobertura: fallas también con 3'
            }>
              cobertura
            </span>
          )}
          {p.ventajaClase && (
            <span className="mod favor" title={`Ventaja de clase de ${pa.clase} sobre ${po.clase}: +1 al daño`}>
              ventaja
            </span>
          )}
          {p.anti && (
            <span className="mod favor" title={`Anti-${po.clase}: +1D3 de daño si hieres`}>
              anti-{po.clase.toLowerCase()}
            </span>
          )}
          {HABILIDADES_ARMA && arma.habilidades.map((h, i) => (
            <span key={h.nombre + i} className="mod" title={reglaHabilidad(h)}>
              {nombreHabilidad(h)}
            </span>
          ))}
        </div>

        <div className="botones">
          <button className="confirmar" onClick={onConfirmar}>✓ {arma.nombre}</button>
          <button className="cancelar" onClick={onCancelar} title="Elegir otra cosa">↩</button>
        </div>
      </div>

      <Bando
        lado="defensor"
        unidad={objetivo}
        nombre={po.nombre}
        clase={po.clase}
        vidasMax={po.vidas}
        icono={icono(po.clase)}
        pie={`Salvación ${po.salvacion}+`}
        aviso={enCobertura ? 'en cobertura' : null}
      />
    </div>
  );
}

/** Una de las dos mitades: quién es, cómo está de vidas y su dato de pie. */
function Bando({
  lado, unidad, nombre, clase, vidasMax, icono, pie, aviso,
}: {
  lado: 'atacante' | 'defensor';
  unidad: Unit;
  nombre: string;
  clase: string;
  vidasMax: number;
  icono: string;
  pie: string;
  aviso?: string | null;
}) {
  const fraccion = vidasMax > 0 ? Math.max(0, unidad.vidas / vidasMax) : 0;
  return (
    <div className={`bando ${lado} p${unidad.owner}`}>
      <img className="retrato" src={icono} alt="" draggable={false} />
      <div className="datos">
        <span className="quien">
          <b>{nombre}</b>
          <i>{unidad.id} · {clase}</i>
        </span>
        <div className="vida">
          <div className="barra">
            <div style={{ width: `${fraccion * 100}%`, background: colorVida(unidad.vidas, vidasMax) }} />
          </div>
          <span className="cifras">{unidad.vidas}<i>/{vidasMax}</i></span>
        </div>
        <span className="pie">{pie}</span>
        {aviso && <span className="aviso-cobertura">{aviso}</span>}
      </div>
    </div>
  );
}
