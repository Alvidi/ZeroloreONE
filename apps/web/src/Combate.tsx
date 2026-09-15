import { useEffect, useState } from 'react';
import type { AttackResult, GameState } from '@zerolore/core';
import { Dado } from './Dado.tsx';
import { colorVida } from './vida.ts';

/** Datos de un ataque ya resuelto por el motor, para narrarlo en pantalla. */
export interface CombateEnCurso {
  readonly attackerId: string;
  readonly targetId: string;
  readonly arma: string;
  /** Tirada de carga previa, si el combate viene de una Carga. */
  readonly carga?: { readonly dado: number; readonly exito: boolean } | undefined;
  /** Ausente si la carga se frenó: no llega a haber ataque. */
  readonly resultado: AttackResult | undefined;
  /** Vidas del objetivo antes y después, para animar la barra. */
  readonly vidasAntes: number;
  readonly vidasDespues: number;
  readonly destruida: boolean;
}

type Fase = 'intro' | 'carga' | 'ataque' | 'salvacion' | 'resultado';

const MS_INTRO = 550;
const MS_DADO = 260;
const MS_ENTRE_FASES = 550;
/**
 * Pausa larga tras la tirada de carga: ahí se decide si hay combate o si la
 * unidad se frena, y conviene ver el resultado antes de que empiecen a caer
 * los dados del cuerpo a cuerpo.
 */
const MS_TRAS_CARGA = 1500;

/**
 * Reproduce el ataque paso a paso. El motor ya resolvió todo: esto solo va
 * destapando los dados que ya están tirados, para que se vea cómo se llegó
 * al resultado en vez de soltar un número seco.
 */
function useRevelado(combate: CombateEnCurso) {
  const { resultado } = combate;
  const dadosAtaque = resultado ? [...resultado.dadosAtaque, ...resultado.dadosRepetidos] : [];
  const [fase, setFase] = useState<Fase>('intro');
  const [visiblesAtaque, setVisiblesAtaque] = useState(0);
  const [visiblesSalvacion, setVisiblesSalvacion] = useState(0);

  useEffect(() => {
    const temporizadores: ReturnType<typeof setTimeout>[] = [];
    let t = MS_INTRO;

    if (combate.carga) {
      temporizadores.push(setTimeout(() => setFase('carga'), t));
      t += MS_TRAS_CARGA;
    }
    // Carga frenada: no hay ataque que enseñar.
    if (!resultado) {
      temporizadores.push(setTimeout(() => setFase('resultado'), t));
      return () => temporizadores.forEach(clearTimeout);
    }

    temporizadores.push(setTimeout(() => setFase('ataque'), t));
    dadosAtaque.forEach((_, i) => {
      t += MS_DADO;
      temporizadores.push(setTimeout(() => setVisiblesAtaque(i + 1), t));
    });

    t += MS_ENTRE_FASES;
    temporizadores.push(setTimeout(() => setFase('salvacion'), t));
    resultado.dadosSalvacion.forEach((_, i) => {
      t += MS_DADO;
      temporizadores.push(setTimeout(() => setVisiblesSalvacion(i + 1), t));
    });

    t += MS_ENTRE_FASES;
    temporizadores.push(setTimeout(() => setFase('resultado'), t));

    return () => temporizadores.forEach(clearTimeout);
    // Un combate es inmutable: se reproduce una sola vez.
  }, []);

  /** Salta la animación y enseña el desenlace. */
  const acelerar = (): void => {
    setVisiblesAtaque(dadosAtaque.length);
    setVisiblesSalvacion(resultado?.dadosSalvacion.length ?? 0);
    setFase('resultado');
  };

  return { fase, visiblesAtaque, visiblesSalvacion, dadosAtaque, acelerar };
}

export function Combate({
  state,
  combate,
  onCerrar,
}: {
  state: GameState;
  combate: CombateEnCurso;
  onCerrar: () => void;
}) {
  const { resultado } = combate;
  const { fase, visiblesAtaque, visiblesSalvacion, dadosAtaque, acelerar } = useRevelado(combate);

  const atacante = state.units[combate.attackerId];
  const objetivo = state.units[combate.targetId];
  const pAtacante = atacante ? state.profiles[atacante.profileId] : undefined;
  const pObjetivo = objetivo ? state.profiles[objetivo.profileId] : undefined;
  if (!atacante || !objetivo || !pAtacante || !pObjetivo) return null;

  /** Qué fue cada dado de ataque: crítico, impacto o fallo. */
  const claseDado = (v: number): string => {
    if (!resultado || resultado.umbralImpacto === null) return 'impacto';
    if (v >= resultado.umbralCritico) return 'critico';
    if (v >= resultado.umbralImpacto) return 'impacto';
    return 'fallo';
  };
  /** Un 1 natural siempre falla la salvación, pase lo que pase. */
  const claseSalvacion = (v: number): string =>
    resultado && v !== 1 && v >= resultado.umbralSalvacion ? 'bloqueado' : 'pasa';

  const vidaFraccion = combate.vidasDespues / Math.max(1, pObjetivo.vidas);

  return (
    /*
      Durante la fase de carga el fondo se aclara: la unidad se está
      aproximando en el tablero y hay que poder verlo, no taparlo.
    */
    <div className={`combate fase-${fase}`} onClick={fase === 'resultado' ? onCerrar : acelerar}>
      <div className="combate-caja" onClick={(e) => e.stopPropagation()}>
        <header className="duelo">
          <div className={`lado bando-${atacante.owner}`}>
            <span className="rol">Atacante</span>
            <b>{combate.attackerId}</b>
            <span className="nombre">{pAtacante.nombre}</span>
            <span className="arma">{combate.arma}</span>
          </div>
          <div className="versus">VS</div>
          <div className={`lado derecha bando-${objetivo.owner}`}>
            <span className="rol">Defensor</span>
            <b>{combate.targetId}</b>
            <span className="nombre">{pObjetivo.nombre}</span>
            {/*
              Desglose de la salvación: el valor impreso, qué lo ha cambiado y
              el resultado final. Sin frases: base, causa, resultado.
            */}
            <span className="salvacion">
              {resultado ? (
                <>
                  <span className="base">{resultado.salvacionBase}+</span>
                  {resultado.enCobertura && <span className="mod cobertura">cobertura</span>}
                  {resultado.umbralSalvacion !== resultado.salvacionBase && (
                    <>
                      <span className="flecha">→</span>
                      <span className="final">{resultado.umbralSalvacion}+</span>
                    </>
                  )}
                </>
              ) : (
                <span className="base">{pObjetivo.salvacion}+</span>
              )}
            </span>
          </div>
        </header>

        {combate.carga && fase !== 'intro' && (
          <section className={`tirada${fase === 'carga' ? ' activa' : ''}`}>
            <h4>Carga · 3+ en 1D6</h4>
            <div className="dados-fila">
              <span className={`dado-res ${combate.carga.exito ? 'impacto' : 'fallo'}`}>
                <Dado valor={combate.carga.dado} tam={44} />
              </span>
              <p className="resumen">
                {combate.carga.exito
                  ? 'Carga con éxito: quedan trabadas y ataca gratis'
                  : 'La carga se frena a 1" y termina la activación'}
              </p>
            </div>
          </section>
        )}

        {resultado && (
        <section className={`tirada${fase === 'ataque' ? ' activa' : ''}`}>
          <h4>
            {resultado.umbralImpacto === null
              ? 'Impacto automático'
              : `Precisión ${resultado.umbralImpacto}+ · crítico ${resultado.umbralCritico}+`}
          </h4>
          <div className="dados-fila">
            {dadosAtaque.length === 0 && fase !== 'intro' && (
              <p className="sin-dados">{resultado.numeroDeAtaques} impactos sin tirada</p>
            )}
            {dadosAtaque.slice(0, visiblesAtaque).map((v, i) => (
              <span key={i} className={`dado-res ${claseDado(v)}`}>
                <Dado valor={v} tam={44} />
              </span>
            ))}
          </div>
          {visiblesAtaque === dadosAtaque.length && fase !== 'intro' && fase !== 'ataque' && (
            <p className="resumen">
              {resultado.impactos} impacto{resultado.impactos === 1 ? '' : 's'}
              {resultado.criticos > 0 && ` · ${resultado.criticos} crítico${resultado.criticos === 1 ? '' : 's'}`}
            </p>
          )}
        </section>
        )}

        {resultado && (fase === 'salvacion' || fase === 'resultado') && (
          <section className={`tirada${fase === 'salvacion' ? ' activa' : ''}`}>
            <h4>
              Salvación del defensor {resultado.umbralSalvacion}+
              {resultado.enCobertura && ' (en cobertura)'}
            </h4>
            <div className="dados-fila">
              {resultado.dadosSalvacion.length === 0 && <p className="sin-dados">Sin impactos que salvar</p>}
              {resultado.dadosSalvacion.slice(0, visiblesSalvacion).map((v, i) => (
                <span key={i} className={`dado-res ${claseSalvacion(v)}`}>
                  <Dado valor={v} tam={44} />
                </span>
              ))}
            </div>
            {fase === 'resultado' && resultado.dadosSalvacion.length > 0 && (
              <p className="resumen">{resultado.impactosBloqueados} bloqueado{resultado.impactosBloqueados === 1 ? '' : 's'}</p>
            )}
          </section>
        )}

        {fase === 'resultado' && resultado && (
          <section className="desenlace">
            <div className="danio">
              <span className="cifra">{resultado.danioTotal}</span>
              <span className="etiqueta">de daño</span>
            </div>
            <div className="vidas">
              <span>
                {combate.attackerId === atacante.id && ''}
                {combate.targetId}: {combate.vidasAntes} → <b>{combate.vidasDespues}</b> / {pObjetivo.vidas}
              </span>
              <div className="barra">
                <div
                  style={{
                    width: `${Math.max(0, vidaFraccion) * 100}%`,
                    background: colorVida(combate.vidasDespues, pObjetivo.vidas),
                  }}
                />
              </div>
              {combate.destruida && <span className="destruida">Unidad destruida</span>}
            </div>
          </section>
        )}

        {fase === 'resultado' && resultado &&
          resultado.notas.filter((n) => !n.startsWith('Cobertura:')).length > 0 && (
          <ul className="notas">
            {resultado.notas
              .filter((n) => !n.startsWith('Cobertura:'))
              .map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}

        <footer>
          {fase === 'resultado' ? (
            <button className="grande" onClick={onCerrar}>Continuar</button>
          ) : (
            <button className="saltar" onClick={acelerar}>Saltar animación</button>
          )}
        </footer>
      </div>
    </div>
  );
}
